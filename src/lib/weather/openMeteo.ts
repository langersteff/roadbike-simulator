import { readJson, writeJson } from '../persist';

export interface WeatherSample {
  time: string;
  windMs: number;
  windFromDeg: number;
  tempC: number;
  precipitationMmH: number;
}

export interface WeatherRequest {
  lat: number;
  lon: number;
  whenMs: number;
}

interface ForecastResponse {
  hourly: {
    time: string[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    temperature_2m: number[];
    precipitation: number[];
  };
  hourly_units?: {
    wind_speed_10m?: string;
  };
}

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

export class WeatherRateLimitError extends Error {
  constructor() {
    super('Open-Meteo request limit reached');
    this.name = 'WeatherRateLimitError';
  }
}

const WEATHER_CACHE_KEY = 'bikecalc.weatherCache.v2';
const DAYLIGHT_CACHE_KEY = 'bikecalc.daylightCache.v1';
const WEATHER_CACHE_LIMIT = 500;
const DAYLIGHT_CACHE_LIMIT = 100;
const WEATHER_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

interface CachedWeather {
  sample: WeatherSample;
  fetchedAt: number;
}

function loadPersistentCache<T>(storageKey: string): Map<string, T> {
  const entries = readJson<Array<[string, T]>>(storageKey);
  return entries ? new Map(entries) : new Map();
}

function persistCache<T>(storageKey: string, map: Map<string, T>): void {
  writeJson(storageKey, Array.from(map.entries()));
}

function trimCache<T>(map: Map<string, T>, limit: number): void {
  while (map.size > limit) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

const cache = loadPersistentCache<CachedWeather>(WEATHER_CACHE_KEY);
const daylightCache = loadPersistentCache<DaylightWindow[]>(DAYLIGHT_CACHE_KEY);

function isFreshWeatherEntry(entry: CachedWeather | undefined): entry is CachedWeather {
  if (!entry || typeof entry.fetchedAt !== 'number' || !entry.sample) return false;
  return Date.now() - entry.fetchedAt < WEATHER_CACHE_TTL_MS;
}

const cacheKey = (request: WeatherRequest, hourBucketIso: string) =>
  `${request.lat.toFixed(2)},${request.lon.toFixed(2)},${hourBucketIso}`;

const daylightCacheKey = (lat: number, lon: number, startMs: number, endMs: number) =>
  `${lat.toFixed(2)},${lon.toFixed(2)},${isoDate(startMs)},${isoDate(endMs)}`;

const hourBucketIso = (whenMs: number) => {
  const date = new Date(whenMs);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 13);
};

const isoDate = (whenMs: number) => new Date(whenMs).toISOString().slice(0, 10);

async function fetchOne(request: WeatherRequest, signal?: AbortSignal): Promise<WeatherSample | null> {
  const day = isoDate(request.whenMs);
  const params = new URLSearchParams({
    latitude: request.lat.toFixed(5),
    longitude: request.lon.toFixed(5),
    hourly: 'wind_speed_10m,wind_direction_10m,temperature_2m,precipitation',
    wind_speed_unit: 'ms',
    timezone: 'UTC',
    start_date: day,
    end_date: day,
  });
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, { signal });
  if (response.status === 429) throw new WeatherRateLimitError();
  if (!response.ok) return null;
  const data = (await response.json()) as ForecastResponse;
  const target = hourBucketIso(request.whenMs);
  const hourIndex = data.hourly.time.findIndex((value) => value.startsWith(target));
  if (hourIndex === -1) return null;
  return {
    time: data.hourly.time[hourIndex],
    windMs: data.hourly.wind_speed_10m[hourIndex],
    windFromDeg: data.hourly.wind_direction_10m[hourIndex],
    tempC: data.hourly.temperature_2m[hourIndex],
    precipitationMmH: data.hourly.precipitation?.[hourIndex] ?? 0,
  };
}

export interface WeatherResult {
  request: WeatherRequest;
  sample: WeatherSample | null;
}

export interface DaylightWindow {
  rise: number;
  set: number;
}

interface DaylightResponse {
  daily?: {
    sunrise?: string[];
    sunset?: string[];
  };
}

export async function fetchDaylightWindows(
  lat: number,
  lon: number,
  startMs: number,
  endMs: number,
  signal?: AbortSignal,
): Promise<DaylightWindow[]> {
  const cacheLookupKey = daylightCacheKey(lat, lon, startMs, endMs);
  const cached = daylightCache.get(cacheLookupKey);
  if (cached && cached.length > 0) return cached;
  const startDay = isoDate(startMs);
  const endDay = isoDate(endMs);
  const params = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    daily: 'sunrise,sunset',
    timezone: 'auto',
    start_date: startDay,
    end_date: endDay,
  });
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, { signal });
  if (response.status === 429) throw new WeatherRateLimitError();
  if (!response.ok) return [];
  const data = (await response.json()) as DaylightResponse;
  const sunrises = data.daily?.sunrise ?? [];
  const sunsets = data.daily?.sunset ?? [];
  const windows = sunrises.map((rise, index) => ({
    rise: new Date(rise).getTime(),
    set: new Date(sunsets[index]).getTime(),
  }));
  if (windows.length > 0) {
    daylightCache.set(cacheLookupKey, windows);
    trimCache(daylightCache, DAYLIGHT_CACHE_LIMIT);
    persistCache(DAYLIGHT_CACHE_KEY, daylightCache);
  }
  return windows;
}

export async function fetchWeatherBatch(
  requests: WeatherRequest[],
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<WeatherResult[]> {
  const concurrency = options.concurrency ?? 8;
  const results: WeatherResult[] = new Array(requests.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < requests.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const request = requests[currentIndex];
      const key = cacheKey(request, hourBucketIso(request.whenMs));
      const cached = cache.get(key);
      if (isFreshWeatherEntry(cached)) {
        results[currentIndex] = { request, sample: cached.sample };
        continue;
      }
      try {
        const sample = await fetchOne(request, options.signal);
        if (sample) {
          cache.set(key, { sample, fetchedAt: Date.now() });
          trimCache(cache, WEATHER_CACHE_LIMIT);
        }
        results[currentIndex] = { request, sample };
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        if ((error as Error).name === 'WeatherRateLimitError') throw error;
        results[currentIndex] = { request, sample: null };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
  persistCache(WEATHER_CACHE_KEY, cache);
  return results;
}
