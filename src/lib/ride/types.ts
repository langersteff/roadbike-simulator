import type { Position, Tire, Surface } from '../../types';
import type { RoutePoint } from '../gpx/parse';
import type { WeatherSample } from '../weather/openMeteo';
import type { SplitConfig } from '../chunking/strategies';
import type { PlaceNode } from '../osm/overpass';
import type { RideProfileId, ZoneId } from './zones';

export type ColorScale = 'speed' | 'grade' | 'aerobar' | 'curvy' | 'zone';

export interface RiderProfile {
  riderWeight: number;
  bikeWeight: number;
  bodyHeightCm: number;
  tire: Tire;
  baselinePower: number;
  defaultPosition: Position;
}

export type BreakAnchor =
  | { kind: 'distance'; km: number }
  | { kind: 'time'; elapsedMin: number };

export interface RideBreak {
  id: string;
  anchor: BreakAnchor;
  durationMin: number;
}

export interface ResolvedBreak {
  id: string;
  km: number;
  atElapsedMin: number;
  durationMin: number;
}

export interface ChunkOverrides {
  power?: number;
  position?: Position;
  headwindKph?: number;
  temperatureC?: number;
  precipitationMmH?: number;
  gradePct?: number;
  surface?: Surface;
}

export interface Chunk {
  index: number;
  startIndex: number;
  endIndex: number;
  startKm: number;
  endKm: number;
  lengthKm: number;
  avgBearingDeg: number;
  bearingVarianceDeg: number;
  avgGradePct: number;
  avgElevationM: number;
  positionAuto: Position;
  surfaceAuto: Surface;
  urban: boolean;
  curvy: boolean;
  weather: WeatherSample | null;
  overrides: ChunkOverrides;
  effectivePower: number;
  // Optional only for pre-v3 chunks loaded from storage, which predate these fields; freshly
  // simulated chunks always set them. Consumers fall back when they are absent.
  powerFourthMean?: number;
  zoneSeconds?: Partial<Record<ZoneId, number>>;
  effectivePosition: Position;
  effectiveHeadwindKph: number;
  effectiveTemperatureC: number;
  effectivePrecipitationMmH: number;
  effectiveSurface: Surface;
  effectiveGradePct: number;
  effectiveVelocityKph: number;
  durationMin: number;
  etaFromStartMin: number;
}

export interface RideSimulatorState {
  gpx: { name: string; points: RoutePoint[]; reversed: boolean } | null;
  startDateTime: string;
  split: SplitConfig;
  profile: RiderProfile;
  chunks: Chunk[];
  breaks?: RideBreak[];
  colorScale: ColorScale;
  autoAerobar?: boolean;
  keepPowerSteady?: boolean;
  heatEffect?: boolean;
  rideProfile?: RideProfileId;
  urbanPlaces?: PlaceNode[];
  surfaces?: Surface[];
}
