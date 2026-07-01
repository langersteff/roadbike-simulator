import type { Position, Surface } from '../../types';
import { getTuning } from '../tuning';
import { cappedVelocityKph, computeOutputs } from '../calc';
import { RIDE_PROFILES, deriveFtpW, type RideProfileId } from './zones';
import {
  URBAN_STOPS_PER_KM,
  STOP_DWELL_S,
  STOP_ACCEL_PENALTY_S,
  DEFAULT_SURFACE,
} from '../constants';
import { angleDiffDeg, bearingDeg, toRad } from '../gpx/geometry';
import type { RoutePoint } from '../gpx/parse';
import type { WeatherSample } from '../weather/openMeteo';
import {
  buildRanges,
  enforceMaxLength,
  mergeShortRanges,
  type RawChunkRange,
} from '../chunking/merge';
import {
  curvyBreakpointsOutsideUrban,
  fixedDistanceBreakpoints,
  gradeBreakpoints,
  gradeBucket,
  rangeBreakpoints,
  rangeOverlaps,
  unionBreakpoints,
  dominantSurface,
  type SplitConfig,
  type IndexRange,
  type UrbanRange,
} from '../chunking/strategies';
import type { Chunk, ChunkOverrides, RiderProfile } from './types';
import {
  crosswindKphFromWeather,
  crosswindMsForAero,
  headwindKphFromWeather,
} from './wind';

// Aerobar length/grade/crosswind limits are live-tunable — see DEFAULT_TUNING in ../tuning.
// Precipitation stays a fixed safety cut-off (wet aerobars are never desirable).
const AERO_MAX_PRECIPITATION_MMH = 3;
export const ESTIMATED_AVG_KPH_INITIAL = 24;

const POWER_UPHILL_PER_PERCENT = 0.04;
const POWER_DOWNHILL_PER_PERCENT = 0.10;
// Steep descents coast: power tapers to zero so terminal velocity (capped) governs the speed.
const POWER_MIN_FACTOR = 0;

// A constant-effort rider pushes harder into a headwind, the same way they do on a climb — so wind
// raises power (and thus the training zone), not just lowers speed. Crosswind adds some aero drag
// too, but a rider leans into it less than a pure headwind, so it counts at a reduced weight.
// Tailwind is ignored here (the rider coasts the gift rather than shedding power below cruise).
const WIND_POWER_PER_KPH = 0.012;
const WIND_POWER_MAX_FACTOR = 1.5;
const CROSSWIND_EFFORT_WEIGHT = 0.5;

// Climbing forces a minimum intensity that is independent of how easily the rider spins on the
// flat: gravity sets the floor, not the cruise effort. This grade→%FTP "climb demand" is the floor
// the rider is pushed to on an ascent; effort is the max of it and the (cruise-based) flat effort,
// then capped by the profile ceiling. Anchored so a ~3% grade reaches Zone 3 at the default rise;
// the per-grade rise is live-tunable (lower = the jump to Z3 needs a steeper grade).
const CLIMB_DEMAND_BASE = 0.62;

function climbRiseFor(rideProfile: RideProfileId): number {
  const tuning = getTuning();
  if (rideProfile === 'easyEndurance') return tuning.easyEnduranceClimbRise;
  if (rideProfile === 'endurance') return tuning.enduranceClimbRise;
  if (rideProfile === 'tempo') return tuning.tempoClimbRise;
  return tuning.hiitClimbRise;
}

export function climbDemandFraction(gradePct: number, rideProfile: RideProfileId): number {
  if (gradePct <= 0) return 0;
  return CLIMB_DEMAND_BASE + gradePct * climbRiseFor(rideProfile);
}

const RAIN_CRR_PER_MMH = 0.015;
const RAIN_CRR_MAX_FACTOR = 1.30;

// Physiological heat derate: above an onset threshold the rider must shed power to limit core
// temperature, so sustainable output falls roughly linearly with ambient temperature until a
// floor. Anchored to Périard et al. (Sports Med, PMC5198812): mean self-paced power in prolonged
// time trials drops ~15% at ≥30 °C, with negligible loss below ~25 °C given a moving rider's
// airflow. This is the rider's physiology and is separate from (and opposite to) the small
// air-density speed gain that warm, thin air already produces in computeOutputs.
const HEAT_POWER_THRESHOLD_C = 25;
const HEAT_POWER_PER_C = 0.03;
const HEAT_POWER_MAX_REDUCTION = 0.30;

export function positionExplanation(chunk: Chunk, autoAerobar: boolean): string {
  if (chunk.overrides.position) {
    return `Manually overridden to ${chunk.overrides.position}.`;
  }
  if (!autoAerobar) {
    return `Auto-aerobar is off, so the rider’s default position is used.`;
  }
  if (chunk.positionAuto === 'aerobar') {
    return 'Aerobar: chunk meets all aero criteria — long enough, low turns, gentle grade, dry, low crosswind, non-urban, non-curvy.';
  }
  const tuning = getTuning();
  const reasons: string[] = [];
  if (chunk.urban) reasons.push('passes through an urban area');
  if (chunk.curvy) reasons.push('too curvy (contains a curvy stretch)');
  if (chunk.lengthKm < tuning.aeroMinLengthKm) {
    reasons.push(`too short (${chunk.lengthKm.toFixed(1)} km, min ${tuning.aeroMinLengthKm} km)`);
  }
  if (chunk.effectiveGradePct < tuning.aeroMinGradePct || chunk.effectiveGradePct > tuning.aeroMaxGradePct) {
    reasons.push(`grade ${chunk.effectiveGradePct.toFixed(1)}% outside ${tuning.aeroMinGradePct}%…+${tuning.aeroMaxGradePct}% aero window`);
  }
  if (chunk.effectivePrecipitationMmH >= AERO_MAX_PRECIPITATION_MMH) {
    reasons.push(`precipitation ${chunk.effectivePrecipitationMmH.toFixed(1)} mm/h (max ${AERO_MAX_PRECIPITATION_MMH})`);
  }
  if (chunk.weather) {
    const crosswindMs = crosswindMsForAero(chunk.weather, chunk.avgBearingDeg);
    if (crosswindMs >= tuning.aeroMaxCrosswindMs) {
      reasons.push(`crosswind ${crosswindMs.toFixed(1)} m/s (max ${tuning.aeroMaxCrosswindMs})`);
    }
  }
  if (reasons.length === 0) return `Rider default — no aero rule explicitly violated.`;
  return `Aerobar skipped because: ${reasons.join('; ')}.`;
}

export function powerFactorForGrade(gradePct: number): number {
  if (gradePct >= 0) {
    return 1 + gradePct * POWER_UPHILL_PER_PERCENT;
  }
  return Math.max(POWER_MIN_FACTOR, 1 + gradePct * POWER_DOWNHILL_PER_PERCENT);
}

export function windPowerFactor(headwindKph: number, crosswindKph: number): number {
  const effectiveHeadwind = headwindKph + CROSSWIND_EFFORT_WEIGHT * Math.abs(crosswindKph);
  if (effectiveHeadwind <= 0) return 1;
  return Math.min(WIND_POWER_MAX_FACTOR, 1 + effectiveHeadwind * WIND_POWER_PER_KPH);
}

/** Flat-ground effort fraction for the profile, read live from tuning so the popup can adjust it. */
function cruiseFractionFor(rideProfile: RideProfileId): number {
  const tuning = getTuning();
  if (rideProfile === 'easyEndurance') return tuning.easyEnduranceCruise;
  if (rideProfile === 'endurance') return tuning.enduranceCruise;
  if (rideProfile === 'tempo') return tuning.tempoCruise;
  return tuning.hiitCruise;
}

export function crrMultiplierForRain(precipitationMmH: number): number {
  if (!Number.isFinite(precipitationMmH) || precipitationMmH <= 0) return 1;
  return Math.min(RAIN_CRR_MAX_FACTOR, 1 + precipitationMmH * RAIN_CRR_PER_MMH);
}

export function heatPowerFactor(temperatureC: number): number {
  if (!Number.isFinite(temperatureC) || temperatureC <= HEAT_POWER_THRESHOLD_C) return 1;
  const reduction = Math.min(
    HEAT_POWER_MAX_REDUCTION,
    (temperatureC - HEAT_POWER_THRESHOLD_C) * HEAT_POWER_PER_C,
  );
  return 1 - reduction;
}

export function buildChunks(
  points: RoutePoint[],
  split: SplitConfig,
  _startTimeMs: number,
  urbanRanges: UrbanRange[] = [],
  curvyRanges: IndexRange[] = [],
): RawChunkRange[] {
  if (points.length < 2) return [];
  const sets: number[][] = [];
  if (split.grade) sets.push(gradeBreakpoints(points));
  if (split.fixedDistance.on) sets.push(fixedDistanceBreakpoints(points, split.fixedDistance.km));
  if (split.urbanArea) sets.push(rangeBreakpoints(urbanRanges, points.length));
  if (split.curvy) sets.push(curvyBreakpointsOutsideUrban(curvyRanges, urbanRanges, points.length));
  const unioned = unionBreakpoints(...sets);
  const ranges = buildRanges(points, unioned);
  const merged = mergeShortRanges(points, ranges, split.minSectionKm, split.curvy ? curvyRanges : []);
  const capped = enforceMaxLength(points, merged, split.maxSectionKm);
  return mergeSameBucketRanges(points, capped, split, urbanRanges, curvyRanges);
}

function mergeSameBucketRanges(
  points: RoutePoint[],
  ranges: RawChunkRange[],
  split: SplitConfig,
  urbanRanges: UrbanRange[],
  curvyRanges: IndexRange[],
): RawChunkRange[] {
  if (ranges.length <= 1 || (!split.grade && !split.urbanArea && !split.curvy)) {
    return ranges;
  }

  const onlyBucketStrategies = !split.fixedDistance.on;
  const hardBreaks = new Set<number>();
  if (split.fixedDistance.on) {
    fixedDistanceBreakpoints(points, split.fixedDistance.km).forEach((value) => hardBreaks.add(value));
  }

  const rangeStartKm = (range: RawChunkRange) => points[range.startIndex].cumKm;
  const rangeEndKm = (range: RawChunkRange) => points[range.endIndex].cumKm;
  const rangeAvgGrade = (range: RawChunkRange) => {
    const lengthM = (rangeEndKm(range) - rangeStartKm(range)) * 1000;
    if (lengthM <= 0) return 0;
    return ((points[range.endIndex].ele - points[range.startIndex].ele) / lengthM) * 100;
  };
  const rangeUrban = (range: RawChunkRange) =>
    rangeOverlaps(range.startIndex, range.endIndex, urbanRanges);
  const rangeCurvy = (range: RawChunkRange) =>
    rangeOverlaps(range.startIndex, range.endIndex, curvyRanges);

  const result: RawChunkRange[] = [{ ...ranges[0] }];
  let headStartKm = rangeStartKm(ranges[0]);
  let headGradeBucket = gradeBucket(rangeAvgGrade(ranges[0]));
  let headUrban = rangeUrban(ranges[0]);
  let headCurvy = rangeCurvy(ranges[0]);

  for (let chunkIndex = 1; chunkIndex < ranges.length; chunkIndex += 1) {
    const current = ranges[chunkIndex];
    const last = result[result.length - 1];
    const hardBreak = hardBreaks.has(last.endIndex);
    const mergedKm = rangeEndKm(current) - headStartKm;
    const wouldExceedMax = !onlyBucketStrategies && mergedKm > split.maxSectionKm;
    const currentGradeBucket = gradeBucket(rangeAvgGrade(current));
    const currentUrban = rangeUrban(current);
    const currentCurvy = rangeCurvy(current);

    const gradeMatches = !split.grade || headGradeBucket === currentGradeBucket;
    const urbanMatches = !split.urbanArea || headUrban === currentUrban;
    const curvyMatches = !split.curvy || headCurvy === currentCurvy;

    if (!hardBreak && !wouldExceedMax && gradeMatches && urbanMatches && curvyMatches) {
      last.endIndex = current.endIndex;
    } else {
      result.push({ ...current });
      headStartKm = rangeStartKm(current);
      headGradeBucket = currentGradeBucket;
      headUrban = currentUrban;
      headCurvy = currentCurvy;
    }
  }
  return result;
}

interface DedupeAdjacentChunksOptions {
  points: RoutePoint[];
  split: SplitConfig;
  startTimeMs: number;
  urbanRanges: UrbanRange[];
}

interface DedupeAdjacentChunksResult {
  ranges: RawChunkRange[];
  weather: Array<WeatherSample | null>;
  changed: boolean;
}

export function dedupeAdjacentChunks(
  chunks: Chunk[],
  ranges: RawChunkRange[],
  weather: Array<WeatherSample | null>,
  options: DedupeAdjacentChunksOptions,
): DedupeAdjacentChunksResult {
  const { split } = options;
  if (chunks.length <= 1 || (!split.grade && !split.urbanArea && !split.curvy)) {
    return { ranges: ranges.slice(), weather: weather.slice(), changed: false };
  }

  const onlyBucketStrategies = !split.fixedDistance.on;
  const hardBreaks = new Set<number>();
  if (split.fixedDistance.on) {
    fixedDistanceBreakpoints(options.points, split.fixedDistance.km).forEach((value) => hardBreaks.add(value));
  }

  type Accumulator = {
    range: RawChunkRange;
    weather: WeatherSample | null;
    headChunk: Chunk;
  };

  const result: Accumulator[] = [{
    range: { ...ranges[0] },
    weather: weather[0] ?? null,
    headChunk: chunks[0],
  }];
  let changed = false;

  for (let chunkIndex = 1; chunkIndex < chunks.length; chunkIndex += 1) {
    const current = chunks[chunkIndex];
    const last = result[result.length - 1];

    const hardBreak = hardBreaks.has(last.range.endIndex);
    const mergedKm = current.endKm - last.headChunk.startKm;
    const wouldExceedMax = !onlyBucketStrategies && mergedKm > split.maxSectionKm;

    const gradeMatches =
      (!split.grade && !split.urbanArea && !split.curvy)
      || gradeBucket(last.headChunk.effectiveGradePct) === gradeBucket(current.effectiveGradePct);
    const urbanMatches =
      !split.urbanArea
      || last.headChunk.urban === current.urban;
    const curvyMatches =
      !split.curvy
      || last.headChunk.curvy === current.curvy;

    if (!hardBreak && !wouldExceedMax && gradeMatches && urbanMatches && curvyMatches) {
      last.range.endIndex = ranges[chunkIndex].endIndex;
      changed = true;
    } else {
      result.push({
        range: { ...ranges[chunkIndex] },
        weather: weather[chunkIndex] ?? null,
        headChunk: current,
      });
    }
  }

  return {
    ranges: result.map((entry) => entry.range),
    weather: result.map((entry) => entry.weather),
    changed,
  };
}

function bearingVariance(points: RoutePoint[], startIndex: number, endIndex: number, mean: number): number {
  if (endIndex - startIndex < 2) return 0;
  let sumSquared = 0;
  let count = 0;
  for (let i = startIndex; i < endIndex; i += 1) {
    const segBearing = bearingDeg(points[i], points[i + 1]);
    sumSquared += angleDiffDeg(segBearing, mean) ** 2;
    count += 1;
  }
  return Math.sqrt(sumSquared / count);
}

interface AeroSafetyInputs {
  lengthKm: number;
  avgBearingDeg: number;
  gradePct: number;
  weather: WeatherSample | null;
}

export function isAerobarPlausible({
  lengthKm,
  avgBearingDeg,
  gradePct,
  weather,
}: AeroSafetyInputs): boolean {
  const tuning = getTuning();
  if (lengthKm < tuning.aeroMinLengthKm) return false;
  if (gradePct < tuning.aeroMinGradePct || gradePct > tuning.aeroMaxGradePct) return false;
  if (weather) {
    if (weather.precipitationMmH >= AERO_MAX_PRECIPITATION_MMH) return false;
    if (crosswindMsForAero(weather, avgBearingDeg) >= tuning.aeroMaxCrosswindMs) return false;
  }
  return true;
}

function pickAutoPosition(
  criteria: AeroSafetyInputs,
  fallback: Position,
  autoEnabled: boolean,
  urban: boolean,
  curvy: boolean,
  roughSurface: boolean,
): Position {
  if (!autoEnabled || urban || curvy || roughSurface) return fallback;
  return isAerobarPlausible(criteria) ? 'aerobar' : fallback;
}

function chunkAvgElevation(points: RoutePoint[], range: RawChunkRange): number {
  return (points[range.startIndex].ele + points[range.endIndex].ele) / 2;
}

function chunkAvgGrade(points: RoutePoint[], range: RawChunkRange): number {
  const lengthM =
    (points[range.endIndex].cumKm - points[range.startIndex].cumKm) * 1000;
  if (lengthM <= 0) return 0;
  return ((points[range.endIndex].ele - points[range.startIndex].ele) / lengthM) * 100;
}

function chunkAvgBearing(points: RoutePoint[], range: RawChunkRange): number {
  return bearingDeg(points[range.startIndex], points[range.endIndex]);
}

/** Local turn radius (m) at point i, from the bearing change into the next segment. */
function turnRadiusM(points: RoutePoint[], index: number, segLengthM: number): number {
  if (index + 2 >= points.length) return Infinity;
  const into = bearingDeg(points[index], points[index + 1]);
  const out = bearingDeg(points[index + 1], points[index + 2]);
  const turnRad = toRad(angleDiffDeg(into, out));
  if (turnRad < 1e-3) return Infinity;
  return segLengthM / turnRad;
}

interface ChunkPhysicsParams {
  profile: RiderProfile;
  position: Position;
  surface: Surface;
  temperatureC: number;
  crrMultiplier: number;
  weather: WeatherSample | null;
  keepPowerSteady: boolean;
  heatEffect: boolean;
  rideProfile: RideProfileId;
  gradeOverride?: number;
  powerOverride?: number;
  headwindOverrideKph?: number;
}

interface ChunkPhysicsResult {
  movingTimeMin: number;
  avgVelocityKph: number;
  avgPowerW: number;
  // Time-weighted mean of power⁴ across the chunk's segments. Kept separate from avgPowerW so the
  // load model can build a Normalized Power that reflects within-chunk variability (climbs spike,
  // descents coast) instead of collapsing each chunk to a single flat power.
  powerFourthMean: number;
}

/**
 * Integrate the force balance point-by-point across the chunk instead of solving once at the
 * chunk's average grade. Speed is non-linear in grade, so averaging first reads too fast on
 * rolling terrain; each descent segment is additionally capped to a realistic cornering/braking
 * speed. Returns moving time and distance-weighted averages.
 */
function integrateChunkPhysics(
  points: RoutePoint[],
  range: RawChunkRange,
  params: ChunkPhysicsParams,
): ChunkPhysicsResult {
  let movingTimeMin = 0;
  let distanceKm = 0;
  let powerDistance = 0;
  let powerFourthTime = 0;

  const heatFactor = params.heatEffect ? heatPowerFactor(params.temperatureC) : 1;

  for (let index = range.startIndex; index < range.endIndex; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const segKm = to.cumKm - from.cumKm;
    if (segKm <= 0) continue;
    const segM = segKm * 1000;

    const grade = params.gradeOverride ?? ((to.ele - from.ele) / segM) * 100;
    const segBearing = bearingDeg(from, to);
    const headwind = params.headwindOverrideKph ?? headwindKphFromWeather(params.weather, segBearing);
    const crosswind = crosswindKphFromWeather(params.weather, segBearing);
    const ftpW = deriveFtpW(params.profile.baselinePower);
    const spec = RIDE_PROFILES[params.rideProfile];
    const cruiseFraction = cruiseFractionFor(params.rideProfile);
    // Flat/descent effort comes from cruise (descents taper toward coasting); climbs are driven by
    // the grade-forced demand instead. The rider does whichever is harder, capped by the profile.
    const descentTaper = grade < 0 ? powerFactorForGrade(grade) : 1;
    const baseEffort = cruiseFraction * descentTaper;
    const effortFraction = Math.min(
      spec.ceilingFraction,
      Math.max(baseEffort, climbDemandFraction(grade, params.rideProfile)) * windPowerFactor(headwind, crosswind),
    );
    const power =
      heatFactor *
      (params.powerOverride ??
        (params.keepPowerSteady
          ? params.profile.baselinePower
          : ftpW * effortFraction));

    const outputs = computeOutputs({
      id: 'segment',
      label: 'segment',
      mode: 'power',
      power,
      velocity: 0,
      riderWeight: params.profile.riderWeight,
      bikeWeight: params.profile.bikeWeight,
      bodyHeightCm: params.profile.bodyHeightCm,
      tire: params.profile.tire,
      surface: params.surface,
      position: params.position,
      grade,
      headwind,
      crosswind,
      distance: segKm,
      temperature: params.temperatureC,
      elevation: (from.ele + to.ele) / 2,
      crrMultiplier: params.crrMultiplier,
    });

    const velocityKph = cappedVelocityKph(outputs.velocityKph, turnRadiusM(points, index, segM));
    if (velocityKph <= 0) continue;

    const segSeconds = (segKm / velocityKph) * 3600;
    movingTimeMin += (segKm / velocityKph) * 60;
    distanceKm += segKm;
    powerDistance += power * segKm;
    powerFourthTime += power ** 4 * segSeconds;
  }

  const movingSeconds = movingTimeMin * 60;

  return {
    movingTimeMin,
    powerFourthMean: movingSeconds > 0 ? powerFourthTime / movingSeconds : 0,
    avgVelocityKph: movingTimeMin > 0 ? distanceKm / (movingTimeMin / 60) : 0,
    avgPowerW: distanceKm > 0 ? powerDistance / distanceKm : params.profile.baselinePower,
  };
}

/** Extra time lost to stops at lights/junctions while riding through a settlement. */
export function urbanStopPenaltyMin(lengthKm: number): number {
  return URBAN_STOPS_PER_KM * lengthKm * ((STOP_DWELL_S + STOP_ACCEL_PENALTY_S) / 60);
}

interface BuildChunkOptions {
  range: RawChunkRange;
  index: number;
  points: RoutePoint[];
  profile: RiderProfile;
  overrides: ChunkOverrides;
  weather: WeatherSample | null;
  autoAerobar: boolean;
  keepPowerSteady: boolean;
  heatEffect: boolean;
  rideProfile: RideProfileId;
  urbanRanges: UrbanRange[];
  curvyRanges: IndexRange[];
  surfaces?: Surface[];
}

export function evaluateChunk({
  range,
  index,
  points,
  profile,
  overrides,
  weather,
  autoAerobar,
  keepPowerSteady,
  heatEffect,
  rideProfile,
  urbanRanges,
  curvyRanges,
  surfaces,
}: BuildChunkOptions): Omit<Chunk, 'etaFromStartMin'> {
  const startKm = points[range.startIndex].cumKm;
  const endKm = points[range.endIndex].cumKm;
  const lengthKm = endKm - startKm;
  const avgBearing = chunkAvgBearing(points, range);
  const variance = bearingVariance(points, range.startIndex, range.endIndex, avgBearing);
  const avgGrade = chunkAvgGrade(points, range);
  const avgElevation = chunkAvgElevation(points, range);
  const urban = rangeOverlaps(range.startIndex, range.endIndex, urbanRanges);
  const curvy = rangeOverlaps(range.startIndex, range.endIndex, curvyRanges);
  const surfaceAuto = surfaces ? dominantSurface(points, range, surfaces) : DEFAULT_SURFACE;
  const effectiveSurface = overrides.surface ?? surfaceAuto;
  const positionAuto = pickAutoPosition(
    {
      lengthKm,
      avgBearingDeg: avgBearing,
      gradePct: avgGrade,
      weather,
    },
    profile.defaultPosition,
    autoAerobar,
    urban,
    curvy,
    effectiveSurface !== DEFAULT_SURFACE,
  );

  const effectiveGrade = overrides.gradePct ?? avgGrade;
  const effectivePosition = overrides.position ?? positionAuto;
  const effectiveHeadwind = overrides.headwindKph ?? headwindKphFromWeather(weather, avgBearing);
  const effectiveTemperature = overrides.temperatureC ?? weather?.tempC ?? 15;
  const effectivePrecipitation = overrides.precipitationMmH ?? weather?.precipitationMmH ?? 0;
  const crrMultiplier = crrMultiplierForRain(effectivePrecipitation);

  const physics = integrateChunkPhysics(points, range, {
    profile,
    position: effectivePosition,
    surface: effectiveSurface,
    temperatureC: effectiveTemperature,
    crrMultiplier,
    weather,
    keepPowerSteady,
    heatEffect,
    rideProfile,
    gradeOverride: overrides.gradePct,
    powerOverride: overrides.power,
    headwindOverrideKph: overrides.headwindKph,
  });
  const durationMin = physics.movingTimeMin + (urban ? urbanStopPenaltyMin(lengthKm) : 0);

  return {
    index,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    startKm,
    endKm,
    lengthKm,
    avgBearingDeg: avgBearing,
    bearingVarianceDeg: variance,
    avgGradePct: avgGrade,
    avgElevationM: avgElevation,
    positionAuto,
    surfaceAuto,
    urban,
    curvy,
    weather,
    overrides,
    effectivePower: physics.avgPowerW,
    powerFourthMean: physics.powerFourthMean,
    effectivePosition,
    effectiveHeadwindKph: effectiveHeadwind,
    effectiveTemperatureC: effectiveTemperature,
    effectivePrecipitationMmH: effectivePrecipitation,
    effectiveSurface,
    effectiveGradePct: effectiveGrade,
    effectiveVelocityKph: physics.avgVelocityKph,
    durationMin,
  };
}

export function cascadeEta(chunks: Array<Omit<Chunk, 'etaFromStartMin'>>): Chunk[] {
  let elapsed = 0;
  return chunks.map((chunk) => {
    const eta = elapsed;
    elapsed += chunk.durationMin;
    return { ...chunk, etaFromStartMin: eta };
  });
}

interface SimulateOptions {
  points: RoutePoint[];
  ranges: RawChunkRange[];
  profile: RiderProfile;
  overrides: ChunkOverrides[];
  weather: Array<WeatherSample | null>;
  autoAerobar: boolean;
  keepPowerSteady: boolean;
  heatEffect: boolean;
  rideProfile: RideProfileId;
  urbanRanges: UrbanRange[];
  curvyRanges: IndexRange[];
  surfaces?: Surface[];
}

export function simulate({
  points,
  ranges,
  profile,
  overrides,
  weather,
  autoAerobar,
  keepPowerSteady,
  heatEffect,
  rideProfile,
  urbanRanges,
  curvyRanges,
  surfaces,
}: SimulateOptions): Chunk[] {
  const evaluated = ranges.map((range, index) =>
    evaluateChunk({
      range,
      index,
      points,
      profile,
      overrides: overrides[index] ?? {},
      weather: weather[index] ?? null,
      autoAerobar,
      keepPowerSteady,
      heatEffect,
      rideProfile,
      urbanRanges,
      curvyRanges,
      surfaces,
    }),
  );
  return cascadeEta(evaluated);
}
