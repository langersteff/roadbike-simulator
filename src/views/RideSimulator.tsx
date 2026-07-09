import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedGpx, RoutePoint } from '../lib/gpx/parse';
import { reverseRoute } from '../lib/gpx/parse';
import { locationAtKm } from '../lib/gpx/geometry';
import {
  computeCurvyRanges,
  computeUrbanRanges,
  DEFAULT_SPLIT_CONFIG,
  type IndexRange,
  type SplitConfig,
  type UrbanRange,
} from '../lib/chunking/strategies';
import { fetchUrbanPlaces, pointInAnyPlace, type PlaceNode } from '../lib/osm/overpass';
import { fetchRoadSurfaces, surfaceForPoints } from '../lib/osm/surface';
import { getTuning, setTuning, type TuningConfig } from '../lib/tuning';
import type { RawChunkRange } from '../lib/chunking/merge';
import {
  buildChunks,
  cascadeEta,
  dedupeAdjacentChunks,
  evaluateChunk,
  simulate,
} from '../lib/ride/simulate';
import {
  fetchDaylightWindows,
  fetchWeatherBatch,
  WeatherRateLimitError,
  type DaylightWindow,
  type WeatherSample,
} from '../lib/weather/openMeteo';
import type {
  Chunk,
  ChunkOverrides,
  ColorScale,
  RideBreak,
  RideSimulatorState,
  RiderProfile,
} from '../lib/ride/types';
import { loadRideState, saveRideState } from '../lib/ride/storage';
import { computeLoadSummary, totalMovingMinutes } from '../lib/ride/load';
import { deriveFtpW, RIDE_PROFILES } from '../lib/ride/zones';
import { formatMinutes } from '../lib/uiCopy';
import type { Surface } from '../types';
import { GpxUpload } from '../components/ride/GpxUpload';
import { RiderProfileForm } from '../components/ride/RiderProfileForm';
import { StartTimeInput } from '../components/ride/StartTimeInput';
import { SplitStrategyPicker } from '../components/ride/SplitStrategyPicker';
import { TuningPopup } from '../components/ride/TuningPopup';
import { RouteMap, type JumpRequest } from '../components/ride/RouteMap';
import { VelocityChart } from '../components/ride/VelocityChart';
import { ColorScaleToggle } from '../components/ride/ColorScaleToggle';
import { ZoneLegend } from '../components/ride/ZoneLegend';
import { RouteSummary } from '../components/ride/RouteSummary';
import { BreaksPanel } from '../components/ride/BreaksPanel';
import { CollapsibleSection } from '../components/ride/CollapsibleSection';
import { ChunkList } from '../components/ride/ChunkList';
import { InfoTooltip } from '../components/InfoTooltip';
import { ModelInfoButton } from '../components/ModelInfo';

const DEFAULT_PROFILE: RiderProfile = {
  riderWeight: 75,
  bikeWeight: 9,
  bodyHeightCm: 175,
  tire: 'clincher',
  baselinePower: 200,
  defaultPosition: 'hoods',
};

const WEATHER_REFETCH_SHIFT_MIN = 30;
const DAYLIGHT_FETCH_DAYS = 3;
const MS_PER_DAY = 86_400_000;

const KEEP_POWER_TOOLTIP = [
  'When ON: power stays at the rider’s default everywhere.',
  'When OFF (default): power scales with grade — higher on uphills, lower on downhills, matching a constant-effort rider.',
].join('\n');

const HEAT_EFFECT_TOOLTIP = [
  'When ON: models the physiological cost of heat. Above 25 °C the rider sheds power to limit',
  'core temperature — about 3% per °C, ~15% at 30 °C, capped at 30% from 35 °C up',
  '(Périard et al., Sports Med). Below 25 °C there is no penalty.',
  'When OFF (default): only air density applies, so warmer (thinner) air reads slightly faster.',
].join('\n');

const AERO_RULES_TOOLTIP = [
  'Auto-pick aerobar when ALL of these hold for the chunk:',
  '• Length ≥ 0.5 km',
  '• Low turns (bearing variance < 50°)',
  '• Grade between −2% and +3% (flat, light uphill or gentle downhill)',
  '• Not heavy rain (precipitation < 3 mm/h)',
  '• Crosswind under 9 m/s',
  '• Paved surface (never on gravel/cobbles)',
].join('\n');

const SURFACE_FEATURE_TOOLTIP = [
  'Experimental: looks up the road surface for each section from OpenStreetMap and',
  'recomputes rolling resistance for your tire on that surface (a clincher loses far',
  'more on gravel than an MTB does). Runs only when you click — no automatic calls.',
  'Clear to revert every section to plain asphalt. OSM coverage is patchy; correct any',
  'mis-detected section with its per-chunk Surface override.',
].join('\n');

const initialStartDateTime = (): string => {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const initialState = (): RideSimulatorState => {
  const stored = loadRideState();
  if (stored) {
    return {
      ...stored,
      colorScale: (stored.colorScale as string) === 'effort' ? 'speed' : stored.colorScale,
      profile: { ...DEFAULT_PROFILE, ...stored.profile },
      split: {
        ...stored.split,
        urbanArea: stored.split.urbanArea ?? false,
        curvy: stored.split.curvy ?? false,
      },
      autoAerobar: stored.autoAerobar ?? false,
      keepPowerSteady: stored.keepPowerSteady ?? false,
      heatEffect: stored.heatEffect ?? false,
      breaks: stored.breaks ?? [],
    };
  }
  return {
    gpx: null,
    startDateTime: initialStartDateTime(),
    split: DEFAULT_SPLIT_CONFIG,
    profile: DEFAULT_PROFILE,
    chunks: [],
    colorScale: 'speed',
    autoAerobar: false,
    keepPowerSteady: false,
    heatEffect: false,
    breaks: [],
  };
};

export function RideSimulator() {
  const [state, setState] = useState<RideSimulatorState>(initialState);
  const [overridesByChunk, setOverridesByChunk] = useState<Record<number, ChunkOverrides>>(() => {
    const result: Record<number, ChunkOverrides> = {};
    state.chunks.forEach((chunk, listIndex) => {
      if (chunk.overrides && Object.keys(chunk.overrides).length > 0) {
        result[listIndex] = chunk.overrides;
      }
    });
    return result;
  });
  const [ranges, setRanges] = useState<RawChunkRange[]>(() =>
    state.chunks.map((chunk) => ({ startIndex: chunk.startIndex, endIndex: chunk.endIndex })),
  );
  const [weatherByChunk, setWeatherByChunk] = useState<Array<WeatherSample | null>>(() =>
    state.chunks.map((chunk) => chunk.weather ?? null),
  );
  const [weatherFetchedAt, setWeatherFetchedAt] = useState<number[]>(() =>
    state.chunks.map((chunk) => chunk.etaFromStartMin),
  );
  const [hoveredKm, setHoveredKm] = useState<number | null>(null);
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null);
  const [daylightWindows, setDaylightWindows] = useState<DaylightWindow[]>([]);
  const [urbanStatus, setUrbanStatus] = useState<string | null>(null);
  const [urbanError, setUrbanError] = useState<boolean>(false);
  const urbanPlacesRef = useRef<PlaceNode[]>(state.urbanPlaces ?? []);
  useEffect(() => {
    urbanPlacesRef.current = state.urbanPlaces ?? [];
  }, [state.urbanPlaces]);
  const setUrbanPlaces = useCallback((next: PlaceNode[]) => {
    urbanPlacesRef.current = next;
    setState((prev) => (prev.urbanPlaces === next ? prev : { ...prev, urbanPlaces: next }));
  }, []);
  const urbanPlaces = state.urbanPlaces ?? [];
  const [surfaceStatus, setSurfaceStatus] = useState<string | null>(null);
  const surfacesRef = useRef<Surface[]>(state.surfaces ?? []);
  useEffect(() => {
    surfacesRef.current = state.surfaces ?? [];
  }, [state.surfaces]);
  const setSurfaces = useCallback((next: Surface[]) => {
    surfacesRef.current = next;
    setState((prev) => (prev.surfaces === next ? prev : { ...prev, surfaces: next }));
  }, []);
  const hasSurfaces = (state.surfaces?.length ?? 0) > 0;
  const mapSectionRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [tuningOpen, setTuningOpen] = useState(false);
  const tuningTimer = useRef<number | null>(null);

  const orientedPoints = useMemo<RoutePoint[]>(() => {
    if (!state.gpx) return [];
    return state.gpx.reversed ? reverseRoute(state.gpx.points) : state.gpx.points;
  }, [state.gpx]);

  const urbanRanges = useMemo<UrbanRange[]>(() => {
    if (urbanPlaces.length === 0 || orientedPoints.length === 0) return [];
    const flags = orientedPoints.map((point) => pointInAnyPlace(point.lat, point.lon, urbanPlaces));
    return computeUrbanRanges(flags, orientedPoints);
  }, [orientedPoints, urbanPlaces]);

  const curvyRanges = useMemo<IndexRange[]>(() => {
    if (orientedPoints.length === 0) return [];
    return computeCurvyRanges(orientedPoints);
  }, [orientedPoints]);

  const effectiveColorScale: ColorScale =
    state.colorScale === 'curvy' && !state.split.curvy ? 'speed' : state.colorScale;

  useEffect(() => {
    const outcome = saveRideState({ ...state, chunks: state.chunks });
    if (!outcome.saved) {
      const reason = outcome.reason ?? 'unavailable';
      const message =
        reason === 'too-large'
          ? 'Route too large to save — will be lost on reload.'
          : reason === 'quota'
          ? 'Browser storage is full — plan changes will not persist.'
          : null;
      setPersistenceWarning(message);
    } else {
      setPersistenceWarning(null);
    }
  }, [state]);

  const runFullSplitAndSimulate = useCallback(
    async (config: SplitConfig) => {
      if (orientedPoints.length < 2) {
        setRanges([]);
        setWeatherByChunk([]);
        setWeatherFetchedAt([]);
        setState((prev) => ({ ...prev, chunks: [] }));
        return;
      }
      setBusy(true);
      setWeatherError(null);
      const startedAt = Date.now();
      const minBusyMs = 350;
      try {
        const startMs = new Date(state.startDateTime).getTime();
        const urbanFetch = await ensureUrbanPlaces(
          orientedPoints,
          config.urbanArea,
          urbanPlacesRef.current,
          setUrbanPlaces,
          setUrbanStatus,
        );
        const activeUrbanPlaces = urbanFetch.places;
        setUrbanError(urbanFetch.errored);
        const finalSplit: SplitConfig = urbanFetch.errored
          ? { ...config, urbanArea: false }
          : config;
        const activeUrbanRanges: UrbanRange[] = !config.urbanArea || activeUrbanPlaces.length === 0
          ? []
          : computeUrbanRanges(
              orientedPoints.map((point) => pointInAnyPlace(point.lat, point.lon, activeUrbanPlaces)),
              orientedPoints,
            );
        const activeCurvyRanges: IndexRange[] = computeCurvyRanges(orientedPoints);
        const activeSurfaces =
          surfacesRef.current.length === orientedPoints.length ? surfacesRef.current : undefined;
        const nextRanges = buildChunks(orientedPoints, config, startMs, activeUrbanRanges, activeCurvyRanges);

        const autoAerobar = state.autoAerobar ?? false;
        const keepPowerSteady = state.keepPowerSteady ?? false;
        const heatEffect = state.heatEffect ?? false;
        const seedChunks = nextRanges.map((range, index) =>
          evaluateChunk({
            range,
            index,
            points: orientedPoints,
            profile: state.profile,
            overrides: overridesByChunk[index] ?? {},
            weather: null,
            autoAerobar,
            keepPowerSteady,
            heatEffect,
            rideProfile: state.rideProfile ?? 'endurance',
            urbanRanges: activeUrbanRanges,
            curvyRanges: activeCurvyRanges,
            surfaces: activeSurfaces,
          }),
        );
        const seeded = cascadeEta(seedChunks, state.breaks ?? []);

        const requests = seeded.map((chunk) => {
          const midKm = (chunk.startKm + chunk.endKm) / 2;
          const midPointIndex = orientedPoints.findIndex((point) => point.cumKm >= midKm);
          const midPoint = orientedPoints[midPointIndex >= 0 ? midPointIndex : chunk.startIndex];
          return {
            lat: midPoint.lat,
            lon: midPoint.lon,
            whenMs: startMs + (chunk.etaFromStartMin + chunk.durationMin / 2) * 60_000,
          };
        });

        let weatherResults: Array<WeatherSample | null> = new Array(seeded.length).fill(null);
        try {
          const fetched = await fetchWeatherBatch(requests);
          weatherResults = fetched.map((entry) => entry.sample);
        } catch (err) {
          if (err instanceof WeatherRateLimitError) {
            setWeatherError('Open-Meteo request limit reached — weather defaults used. Limit usually resets at UTC midnight.');
          } else {
            setWeatherError('Could not fetch weather (offline?). Using neutral defaults.');
          }
        }

        const finalChunks = simulate({
          points: orientedPoints,
          ranges: nextRanges,
          profile: state.profile,
          overrides: nextRanges.map((_, index) => overridesByChunk[index] ?? {}),
          weather: weatherResults,
          autoAerobar,
          keepPowerSteady,
          heatEffect,
          rideProfile: state.rideProfile ?? 'endurance',
          urbanRanges: activeUrbanRanges,
          curvyRanges: activeCurvyRanges,
          surfaces: activeSurfaces,
          breaks: state.breaks ?? [],
        });

        const dedupe = dedupeAdjacentChunks(finalChunks, nextRanges, weatherResults, {
          points: orientedPoints,
          split: config,
          startTimeMs: startMs,
          urbanRanges: activeUrbanRanges,
        });

        let displayChunks = finalChunks;
        let displayRanges = nextRanges;
        let displayWeather = weatherResults;
        if (dedupe.changed) {
          displayChunks = simulate({
            points: orientedPoints,
            ranges: dedupe.ranges,
            profile: state.profile,
            overrides: dedupe.ranges.map((_, index) => overridesByChunk[index] ?? {}),
            weather: dedupe.weather,
            autoAerobar,
            keepPowerSteady,
            heatEffect,
            rideProfile: state.rideProfile ?? 'endurance',
            urbanRanges: activeUrbanRanges,
            curvyRanges: activeCurvyRanges,
            surfaces: activeSurfaces,
            breaks: state.breaks ?? [],
          });
          displayRanges = dedupe.ranges;
          displayWeather = dedupe.weather;
        }

        setRanges(displayRanges);
        setWeatherByChunk(displayWeather);
        setWeatherFetchedAt(displayChunks.map((chunk) => chunk.etaFromStartMin));
        setState((prev) => ({ ...prev, split: finalSplit, chunks: displayChunks }));
        const elapsed = Date.now() - startedAt;
        if (elapsed < minBusyMs) {
          await new Promise<void>((resolve) => setTimeout(resolve, minBusyMs - elapsed));
        }
      } finally {
        setBusy(false);
      }
    },
    [orientedPoints, overridesByChunk, state.profile, state.startDateTime, state.autoAerobar, state.keepPowerSteady, state.heatEffect, state.rideProfile, state.breaks, setUrbanPlaces],
  );

  const reSimulate = useCallback(
    (nextOverrides: Record<number, ChunkOverrides>, nextRanges: RawChunkRange[], nextWeather: Array<WeatherSample | null>) => {
      if (orientedPoints.length < 2 || nextRanges.length === 0) {
        setState((prev) => ({ ...prev, chunks: [] }));
        return [] as Chunk[];
      }
      const chunks = simulate({
        points: orientedPoints,
        ranges: nextRanges,
        profile: state.profile,
        overrides: nextRanges.map((_, index) => nextOverrides[index] ?? {}),
        weather: nextWeather,
        autoAerobar: state.autoAerobar ?? false,
        keepPowerSteady: state.keepPowerSteady ?? false,
        heatEffect: state.heatEffect ?? false,
        rideProfile: state.rideProfile ?? 'endurance',
        urbanRanges,
        curvyRanges,
        surfaces:
          surfacesRef.current.length === orientedPoints.length ? surfacesRef.current : undefined,
        breaks: state.breaks ?? [],
      });
      setState((prev) => ({ ...prev, chunks }));
      return chunks;
    },
    [orientedPoints, state.profile, state.autoAerobar, state.keepPowerSteady, state.heatEffect, state.rideProfile, state.breaks, urbanRanges, curvyRanges],
  );

  const calculateSurfaceSpeeds = useCallback(async () => {
    if (orientedPoints.length < 2) return;
    setBusy(true);
    setSurfaceStatus('Fetching road surfaces from OpenStreetMap…');
    try {
      const lats = orientedPoints.map((point) => point.lat);
      const lons = orientedPoints.map((point) => point.lon);
      const padding = 0.02;
      const ways = await fetchRoadSurfaces(
        Math.min(...lats) - padding,
        Math.min(...lons) - padding,
        Math.max(...lats) + padding,
        Math.max(...lons) + padding,
      );
      if (ways.length === 0) {
        setSurfaceStatus('No OSM road data found for this route — surface speeds unavailable.');
        return;
      }
      setSurfaces(surfaceForPoints(orientedPoints, ways));
      setSurfaceStatus(`Surface speeds applied from ${ways.length} OSM ways.`);
      await runFullSplitAndSimulate(state.split);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setSurfaceStatus('Could not reach Overpass — surface speeds unavailable.');
    } finally {
      setBusy(false);
    }
  }, [orientedPoints, setSurfaces, runFullSplitAndSimulate, state.split]);

  const clearSurfaceSpeeds = useCallback(async () => {
    setSurfaces([]);
    setSurfaceStatus(null);
    await runFullSplitAndSimulate(state.split);
  }, [setSurfaces, runFullSplitAndSimulate, state.split]);

  useEffect(() => {
    if (!state.gpx) return;
    if (ranges.length === 0) {
      void runFullSplitAndSimulate(state.split);
    }
  }, [state.gpx, ranges.length, runFullSplitAndSimulate, state.split]);

  useEffect(() => {
    if (orientedPoints.length === 0) {
      setDaylightWindows([]);
      return;
    }
    const start = new Date(state.startDateTime);
    if (Number.isNaN(start.getTime())) return;
    const startMs = start.getTime();
    const endMs = startMs + (DAYLIGHT_FETCH_DAYS - 1) * MS_PER_DAY;
    const firstPoint = orientedPoints[0];
    const controller = new AbortController();
    fetchDaylightWindows(firstPoint.lat, firstPoint.lon, startMs, endMs, controller.signal)
      .then(setDaylightWindows)
      .catch((err) => {
        if (err instanceof WeatherRateLimitError) {
          setWeatherError('Open-Meteo request limit reached — daylight data unavailable. Limit usually resets at UTC midnight.');
        }
        /* otherwise ignore — chart will simply omit the daylight line */
      });
    return () => controller.abort();
  }, [orientedPoints, state.startDateTime]);

  const refetchTimer = useRef<number | null>(null);
  useEffect(() => {
    if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    if (state.chunks.length === 0) return;
    const staleIndices: number[] = [];
    state.chunks.forEach((chunk, index) => {
      const fetchedEta = weatherFetchedAt[index];
      if (fetchedEta === undefined) staleIndices.push(index);
      else if (Math.abs(chunk.etaFromStartMin - fetchedEta) >= WEATHER_REFETCH_SHIFT_MIN) {
        staleIndices.push(index);
      }
    });
    if (staleIndices.length === 0) return;

    refetchTimer.current = window.setTimeout(async () => {
      const startMs = new Date(state.startDateTime).getTime();
      const requests = staleIndices.map((index) => {
        const chunk = state.chunks[index];
        const midKm = (chunk.startKm + chunk.endKm) / 2;
        const midPointIndex = orientedPoints.findIndex((point) => point.cumKm >= midKm);
        const midPoint = orientedPoints[midPointIndex >= 0 ? midPointIndex : chunk.startIndex];
        return {
          lat: midPoint.lat,
          lon: midPoint.lon,
          whenMs: startMs + (chunk.etaFromStartMin + chunk.durationMin / 2) * 60_000,
        };
      });
      try {
        const fetched = await fetchWeatherBatch(requests);
        const nextWeather = weatherByChunk.slice();
        const nextFetchedAt = weatherFetchedAt.slice();
        fetched.forEach((entry, position) => {
          const chunkIndex = staleIndices[position];
          nextWeather[chunkIndex] = entry.sample;
          nextFetchedAt[chunkIndex] = state.chunks[chunkIndex].etaFromStartMin;
        });
        setWeatherByChunk(nextWeather);
        setWeatherFetchedAt(nextFetchedAt);
        reSimulate(overridesByChunk, ranges, nextWeather);
      } catch {
        setWeatherError('Weather refresh failed; previous data kept.');
      }
    }, 500);

    return () => {
      if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    };
  }, [state.chunks, weatherFetchedAt, weatherByChunk, ranges, overridesByChunk, orientedPoints, reSimulate, state.startDateTime]);

  const handleUpload = (parsed: ParsedGpx) => {
    setOverridesByChunk({});
    setRanges([]);
    setWeatherByChunk([]);
    setWeatherFetchedAt([]);
    setUrbanStatus(null);
    urbanPlacesRef.current = [];
    setSurfaceStatus(null);
    surfacesRef.current = [];
    setState((prev) => ({
      ...prev,
      gpx: { name: parsed.name, points: parsed.points, reversed: false },
      chunks: [],
      urbanPlaces: [],
      surfaces: [],
    }));
  };

  const handleReverseToggle = () => {
    if (!state.gpx) return;
    setOverridesByChunk({});
    setRanges([]);
    setWeatherByChunk([]);
    setWeatherFetchedAt([]);
    setUrbanStatus(null);
    urbanPlacesRef.current = [];
    setSurfaceStatus(null);
    surfacesRef.current = [];
    setState((prev) => ({
      ...prev,
      gpx: prev.gpx ? { ...prev.gpx, reversed: !prev.gpx.reversed } : null,
      chunks: [],
      urbanPlaces: [],
      surfaces: [],
    }));
  };

  const handleClearRoute = () => {
    setOverridesByChunk({});
    setRanges([]);
    setWeatherByChunk([]);
    setWeatherFetchedAt([]);
    setUrbanStatus(null);
    urbanPlacesRef.current = [];
    setState((prev) => ({ ...prev, gpx: null, chunks: [], urbanPlaces: [] }));
  };

  const handleSplitChange = (next: SplitConfig) => {
    setState((prev) => ({ ...prev, split: next }));
  };

  // Live tuning: re-split as the user drags, debounced so we don't refetch weather on every tick.
  const handleLiveTuning = (nextTuning: TuningConfig, minSectionKm: number, maxSectionKm: number) => {
    if (tuningTimer.current) window.clearTimeout(tuningTimer.current);
    tuningTimer.current = window.setTimeout(() => {
      setTuning(nextTuning);
      setOverridesByChunk({});
      setWeatherByChunk([]);
      setWeatherFetchedAt([]);
      setRanges([]);
      setState((prev) => ({ ...prev, split: { ...prev.split, minSectionKm, maxSectionKm } }));
    }, 250);
  };

  const handleReSplit = () => {
    setOverridesByChunk({});
    setWeatherByChunk([]);
    setWeatherFetchedAt([]);
    setRanges([]);
  };

  const handleRetryUrban = () => {
    setUrbanError(false);
    setUrbanStatus(null);
    urbanPlacesRef.current = [];
    setOverridesByChunk({});
    setWeatherByChunk([]);
    setWeatherFetchedAt([]);
    setState((prev) => ({
      ...prev,
      split: { ...prev.split, urbanArea: true },
      urbanPlaces: [],
    }));
    setRanges([]);
  };

  const handleProfileChange = (next: RiderProfile) => {
    setState((prev) => ({ ...prev, profile: next }));
  };

  const handleBreaksChange = (next: RideBreak[]) => {
    setState((prev) => ({ ...prev, breaks: next }));
  };

  useEffect(() => {
    if (ranges.length > 0) {
      reSimulate(overridesByChunk, ranges, weatherByChunk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profile, state.rideProfile, state.autoAerobar, state.keepPowerSteady, state.heatEffect, state.breaks]);

  const handleOverrideChange = (chunkIndex: number, next: ChunkOverrides) => {
    const nextOverrides = { ...overridesByChunk, [chunkIndex]: next };
    setOverridesByChunk(nextOverrides);
    reSimulate(nextOverrides, ranges, weatherByChunk);
  };

  const handleManualSplit = (chunkIndex: number) => {
    if (orientedPoints.length === 0) return;
    const range = ranges[chunkIndex];
    if (!range) return;
    const mid = Math.floor((range.startIndex + range.endIndex) / 2);
    if (mid <= range.startIndex || mid >= range.endIndex) return;
    const nextRanges = ranges.slice();
    nextRanges.splice(chunkIndex, 1, { startIndex: range.startIndex, endIndex: mid }, { startIndex: mid, endIndex: range.endIndex });

    const nextWeather = weatherByChunk.slice();
    nextWeather.splice(chunkIndex, 1, weatherByChunk[chunkIndex] ?? null, weatherByChunk[chunkIndex] ?? null);
    const nextFetchedAt = weatherFetchedAt.slice();
    const fetched = weatherFetchedAt[chunkIndex] ?? 0;
    nextFetchedAt.splice(chunkIndex, 1, fetched, fetched);

    const nextOverrides = shiftOverridesForSplit(overridesByChunk, chunkIndex);

    setRanges(nextRanges);
    setWeatherByChunk(nextWeather);
    setWeatherFetchedAt(nextFetchedAt);
    setOverridesByChunk(nextOverrides);
    reSimulate(nextOverrides, nextRanges, nextWeather);
  };

  const handleMergeWithNext = (chunkIndex: number) => {
    if (chunkIndex >= ranges.length - 1) return;
    const merged: RawChunkRange = {
      startIndex: ranges[chunkIndex].startIndex,
      endIndex: ranges[chunkIndex + 1].endIndex,
    };
    const nextRanges = ranges.slice();
    nextRanges.splice(chunkIndex, 2, merged);

    const nextWeather = weatherByChunk.slice();
    nextWeather.splice(chunkIndex, 2, weatherByChunk[chunkIndex] ?? null);
    const nextFetchedAt = weatherFetchedAt.slice();
    nextFetchedAt.splice(chunkIndex, 2, weatherFetchedAt[chunkIndex] ?? 0);

    const nextOverrides = shiftOverridesForMerge(overridesByChunk, chunkIndex);

    setRanges(nextRanges);
    setWeatherByChunk(nextWeather);
    setWeatherFetchedAt(nextFetchedAt);
    setOverridesByChunk(nextOverrides);
    reSimulate(nextOverrides, nextRanges, nextWeather);
  };

  const handleJumpToChunk = (chunkIndex: number) => {
    const chunk = state.chunks.find((entry) => entry.index === chunkIndex);
    if (!chunk) return;
    const midKm = (chunk.startKm + chunk.endKm) / 2;
    const point = locationAtKm(orientedPoints, midKm);
    if (!point) return;
    setJumpRequest((prev) => ({ lat: point.lat, lon: point.lon, nonce: (prev?.nonce ?? 0) + 1 }));
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const setColorScale = (colorScale: ColorScale) => setState((prev) => ({ ...prev, colorScale }));

  const handleStartChange = (next: string) => {
    setState((prev) => ({ ...prev, startDateTime: next, chunks: [] }));
    setRanges([]);
    setWeatherByChunk([]);
    setWeatherFetchedAt([]);
  };

  const highlightedChunkIndex = useMemo(() => {
    if (hoveredKm === null) return null;
    const chunk = state.chunks.find((entry) => hoveredKm >= entry.startKm && hoveredKm <= entry.endKm);
    return chunk?.index ?? null;
  }, [hoveredKm, state.chunks]);

  const hoveredPoint = useMemo(() => {
    if (hoveredKm === null || orientedPoints.length === 0) return null;
    return locationAtKm(orientedPoints, hoveredKm);
  }, [hoveredKm, orientedPoints]);

  const load = useMemo(
    () =>
      state.chunks.length > 0
        ? computeLoadSummary(state.chunks, deriveFtpW(state.profile.baselinePower))
        : null,
    [state.chunks, state.profile.baselinePower],
  );

  const breaks = state.breaks ?? [];
  const breakMinutes = breaks.reduce((sum, brk) => sum + brk.durationMin, 0);
  const totalKm = orientedPoints.length > 0 ? orientedPoints[orientedPoints.length - 1].cumKm : 0;

  const profileSummary = `${state.profile.riderWeight} kg · ${state.profile.baselinePower} W · ${RIDE_PROFILES[state.rideProfile ?? 'endurance'].label}`;
  const splitSummary = [
    state.split.grade && 'Grade',
    state.split.fixedDistance?.on && `every ${state.split.fixedDistance.km} km`,
    state.split.urbanArea && 'Urban',
    state.split.curvy && 'Curvy',
  ]
    .filter(Boolean)
    .join(' · ') || 'No splitting';
  const breaksSummary = breaks.length === 0 ? 'None' : `${breaks.length} · ${formatMinutes(breakMinutes)}`;
  const rideSummary =
    state.chunks.length === 0
      ? ''
      : [
          `${totalKm.toFixed(1)} km`,
          formatMinutes(totalMovingMinutes(state.chunks)),
          load && `${Math.round(load.tss)} TSS`,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-left">
          <h1>Ride simulator</h1>
        </div>
        <div className="app__controls">
          <ModelInfoButton />
        </div>
      </header>

      <section className="ride-controls">
        <GpxUpload currentName={state.gpx?.name ?? null} onUpload={handleUpload} />
        <StartTimeInput value={state.startDateTime} onChange={handleStartChange} />
        <label className="reverse-toggle">
          <input
            type="checkbox"
            checked={state.gpx?.reversed ?? false}
            disabled={!state.gpx}
            onChange={handleReverseToggle}
          />
          Ride in reverse
        </label>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={handleClearRoute}
          disabled={!state.gpx}
          title="Unload the route and clear chunks. Keeps your rider profile and settings."
        >
          Clear route
        </button>
      </section>

      <CollapsibleSection title="Rider profile" summary={profileSummary}>
        <RiderProfileForm
          profile={state.profile}
          rideProfile={state.rideProfile ?? 'endurance'}
          onChange={handleProfileChange}
          onRideProfileChange={(rideProfile) => setState((prev) => ({ ...prev, rideProfile }))}
        />
        <label className="reverse-toggle">
          <input
            type="checkbox"
            checked={state.autoAerobar ?? false}
            onChange={(event) =>
              setState((prev) => ({ ...prev, autoAerobar: event.target.checked }))
            }
          />
          Auto aerobar where safe
          <InfoTooltip content={AERO_RULES_TOOLTIP} label="When aerobar is considered safe" />
        </label>
        <label className="reverse-toggle">
          <input
            type="checkbox"
            checked={state.keepPowerSteady ?? false}
            onChange={(event) =>
              setState((prev) => ({ ...prev, keepPowerSteady: event.target.checked }))
            }
          />
          Keep power steady
          <InfoTooltip content={KEEP_POWER_TOOLTIP} label="How keep-power-steady works" />
        </label>
        <label className="reverse-toggle">
          <input
            type="checkbox"
            checked={state.heatEffect ?? false}
            onChange={(event) =>
              setState((prev) => ({ ...prev, heatEffect: event.target.checked }))
            }
          />
          Simulate heat effect
          <InfoTooltip content={HEAT_EFFECT_TOOLTIP} label="How the heat effect works" />
        </label>
        <label className="reverse-toggle">
          <input
            type="checkbox"
            checked={hasSurfaces}
            disabled={busy || orientedPoints.length < 2}
            onChange={(event) => {
              if (event.target.checked) void calculateSurfaceSpeeds();
              else void clearSurfaceSpeeds();
            }}
          />
          Surface-aware speeds
          <InfoTooltip content={SURFACE_FEATURE_TOOLTIP} label="How surface speeds work" />
        </label>
        {surfaceStatus && (
          <div className="ride-notice ride-notice--info">
            <span>{surfaceStatus}</span>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Split strategy"
        summary={splitSummary}
        actions={
          <button type="button" className="btn btn--ghost" onClick={() => setTuningOpen((open) => !open)}>
            Tune…
          </button>
        }
      >
        <SplitStrategyPicker
          value={state.split}
          onChange={handleSplitChange}
          onApply={handleReSplit}
          busy={busy}
        />
        {tuningOpen && (
          <TuningPopup
            tuning={getTuning()}
            minSectionKm={state.split.minSectionKm}
            maxSectionKm={state.split.maxSectionKm}
            rideProfile={state.rideProfile ?? 'endurance'}
            onChange={handleLiveTuning}
            onClose={() => setTuningOpen(false)}
          />
        )}
      </CollapsibleSection>

      {persistenceWarning && <div className="ride-notice ride-notice--warn">{persistenceWarning}</div>}
      {weatherError && <div className="ride-notice ride-notice--warn">{weatherError}</div>}
      {urbanStatus && (
        <div className={`ride-notice ride-notice--${urbanError ? 'warn' : 'info'}`}>
          <span>{urbanStatus}</span>
          {urbanError && (
            <button type="button" className="ride-notice__action" onClick={handleRetryUrban}>
              Retry
            </button>
          )}
        </div>
      )}

      <CollapsibleSection title="Breaks" summary={breaksSummary}>
        <BreaksPanel
          breaks={breaks}
          chunks={state.chunks}
          startDateTime={state.startDateTime}
          totalKm={totalKm}
          onChange={handleBreaksChange}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Summary" summary={rideSummary} defaultOpen>
        <RouteSummary
            points={orientedPoints}
            chunks={state.chunks}
            startDateTime={state.startDateTime}
            load={load}
            breakMinutes={breakMinutes}
        />
      </CollapsibleSection>

      <section className="ride-section ride-section--map" ref={mapSectionRef}>
        <div className="ride-section__title-row">
          <h2 className="ride-section__title">Route</h2>
          <div className="ride-section__title-actions">
            <ColorScaleToggle value={effectiveColorScale} onChange={setColorScale} />
          </div>
        </div>
        <RouteMap
          points={orientedPoints}
          chunks={state.chunks}
          colorScale={effectiveColorScale}
          profile={state.profile}
          autoAerobar={state.autoAerobar ?? false}
          highlightChunkIndex={highlightedChunkIndex}
          hoveredPoint={hoveredPoint}
          jumpRequest={jumpRequest}
          onChunkOverrideChange={handleOverrideChange}
        />
        {effectiveColorScale === 'zone' && <ZoneLegend />}
      </section>

      <section className="ride-section">
        <h2 className="ride-section__title">Ride graph</h2>
        <VelocityChart
          chunks={state.chunks}
          routePoints={orientedPoints}
          startDateTime={state.startDateTime}
          daylightWindows={daylightWindows}
          breaks={breaks}
          ftpW={deriveFtpW(state.profile.baselinePower)}
          onHoverKm={setHoveredKm}
        />
      </section>

      <details className="ride-section ride-section--collapsible">
        <summary className="ride-section__title ride-section__summary">Chunks</summary>
        <ChunkList
          chunks={state.chunks}
          profile={state.profile}
          autoAerobar={state.autoAerobar ?? false}
          curvyActive={state.split.curvy}
          highlightedIndex={highlightedChunkIndex}
          onHoverChunk={(index) => setHoveredKm(index === null ? null : midKmForChunk(state.chunks, index))}
          onOverrideChange={handleOverrideChange}
          onSplit={handleManualSplit}
          onMergeWithNext={handleMergeWithNext}
          onJumpToChunk={handleJumpToChunk}
        />
      </details>
    </div>
  );
}

function shiftOverridesForSplit(
  overrides: Record<number, ChunkOverrides>,
  splitIndex: number,
): Record<number, ChunkOverrides> {
  const result: Record<number, ChunkOverrides> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const index = Number(key);
    if (index < splitIndex) result[index] = value;
    else if (index === splitIndex) {
      result[index] = value;
      result[index + 1] = value;
    } else {
      result[index + 1] = value;
    }
  }
  return result;
}

function shiftOverridesForMerge(
  overrides: Record<number, ChunkOverrides>,
  mergeIndex: number,
): Record<number, ChunkOverrides> {
  const result: Record<number, ChunkOverrides> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const index = Number(key);
    if (index < mergeIndex) result[index] = value;
    else if (index === mergeIndex) result[index] = value;
    else if (index === mergeIndex + 1) {
      // dropped — merge keeps the first chunk's overrides
    } else {
      result[index - 1] = value;
    }
  }
  return result;
}

function midKmForChunk(chunks: Chunk[], chunkIndex: number): number | null {
  const chunk = chunks.find((entry) => entry.index === chunkIndex);
  if (!chunk) return null;
  return (chunk.startKm + chunk.endKm) / 2;
}

interface UrbanFetchResult {
  places: PlaceNode[];
  errored: boolean;
}

async function ensureUrbanPlaces(
  points: RoutePoint[],
  enabled: boolean,
  cached: PlaceNode[],
  setPlaces: (places: PlaceNode[]) => void,
  setStatus: (status: string | null) => void,
): Promise<UrbanFetchResult> {
  if (!enabled) {
    if (cached.length > 0) setPlaces([]);
    setStatus(null);
    return { places: [], errored: false };
  }
  if (points.length === 0) return { places: [], errored: false };
  if (cached.length > 0) return { places: cached, errored: false };
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const padding = 0.05;
  const minLat = Math.min(...lats) - padding;
  const maxLat = Math.max(...lats) + padding;
  const minLon = Math.min(...lons) - padding;
  const maxLon = Math.max(...lons) + padding;
  setStatus('Fetching urban places from OpenStreetMap…');
  try {
    const places = await fetchUrbanPlaces(minLat, minLon, maxLat, maxLon);
    setPlaces(places);
    if (places.length === 0) {
      setStatus('No OSM place nodes found in this route’s bounding box.');
      return { places: [], errored: true };
    }
    setStatus(`Urban data: ${places.length} OSM place nodes loaded.`);
    return { places, errored: false };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { places: [], errored: false };
    setStatus('Could not reach Overpass — urban detection paused.');
    return { places: [], errored: true };
  }
}

