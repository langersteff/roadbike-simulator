import { WIND_HEIGHT_FACTOR, MS_TO_KPH } from '../constants';
import { toRad } from '../gpx/geometry';
import type { WeatherSample } from '../weather/openMeteo';

const windAngleRad = (weather: WeatherSample, bearingDeg: number): number =>
  toRad(weather.windFromDeg - bearingDeg);

/** Longitudinal headwind (kph) felt by the rider, scaled to rider height. Negative = tailwind. */
export function headwindKphFromWeather(weather: WeatherSample | null, bearingDeg: number): number {
  if (!weather) return 0;
  return weather.windMs * WIND_HEIGHT_FACTOR * MS_TO_KPH * Math.cos(windAngleRad(weather, bearingDeg));
}

/** Crosswind magnitude (kph) felt by the rider, scaled to rider height. */
export function crosswindKphFromWeather(weather: WeatherSample | null, bearingDeg: number): number {
  if (!weather) return 0;
  return Math.abs(weather.windMs * WIND_HEIGHT_FACTOR * Math.sin(windAngleRad(weather, bearingDeg))) * MS_TO_KPH;
}

/** Raw crosswind (m/s) at forecast height — the threshold the aerobar safety check compares against. */
export function crosswindMsForAero(weather: WeatherSample, bearingDeg: number): number {
  return Math.abs(weather.windMs * Math.sin(windAngleRad(weather, bearingDeg)));
}
