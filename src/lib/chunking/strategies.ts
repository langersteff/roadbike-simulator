import type { RoutePoint } from '../gpx/parse';
import type { Surface } from '../../types';
import { haversineKm } from '../gpx/geometry';
import { getTuning } from '../tuning';
import { DEFAULT_SURFACE } from '../constants';

export interface SplitConfig {
  grade: boolean;
  fixedDistance: { on: boolean; km: number };
  urbanArea: boolean;
  curvy: boolean;
  minSectionKm: number;
  maxSectionKm: number;
}

export const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  grade: true,
  fixedDistance: { on: false, km: 5 },
  urbanArea: false,
  curvy: false,
  minSectionKm: 0.5,
  maxSectionKm: 30.0,
};

const GRADE_BUCKET_EDGES = [-3, -1, 1, 3, 6];
const GRADE_BUCKET_LABELS = [
  'Downhill',
  'Light downhill',
  'Flat',
  'Light uphill',
  'Uphill',
  'Hard uphill',
] as const;

export type GradeCategory = typeof GRADE_BUCKET_LABELS[number];

const GRADE_SMOOTHING_WINDOW_KM = 0.3;

export function gradeBucket(gradePct: number): number {
  for (let edgeIndex = 0; edgeIndex < GRADE_BUCKET_EDGES.length; edgeIndex += 1) {
    if (gradePct < GRADE_BUCKET_EDGES[edgeIndex]) return edgeIndex;
  }
  return GRADE_BUCKET_EDGES.length;
}

export function gradeCategory(gradePct: number): GradeCategory {
  return GRADE_BUCKET_LABELS[gradeBucket(gradePct)];
}

export function smoothedGrade(points: RoutePoint[], index: number, windowKm = GRADE_SMOOTHING_WINDOW_KM): number {
  const centerKm = points[index].cumKm;
  let startIndex = index;
  while (startIndex > 0 && centerKm - points[startIndex].cumKm < windowKm / 2) startIndex -= 1;
  let endIndex = index;
  while (endIndex < points.length - 1 && points[endIndex].cumKm - centerKm < windowKm / 2) endIndex += 1;
  const deltaKm = points[endIndex].cumKm - points[startIndex].cumKm;
  if (deltaKm <= 0) return 0;
  return ((points[endIndex].ele - points[startIndex].ele) / (deltaKm * 1000)) * 100;
}

export function gradeBreakpoints(points: RoutePoint[]): number[] {
  if (points.length < 3) return [];
  const breaks: number[] = [];
  let currentBucket = gradeBucket(smoothedGrade(points, 0));
  for (let index = 1; index < points.length - 1; index += 1) {
    const bucket = gradeBucket(smoothedGrade(points, index));
    if (bucket !== currentBucket) {
      breaks.push(index);
      currentBucket = bucket;
    }
  }
  return breaks;
}

export function fixedDistanceBreakpoints(points: RoutePoint[], chunkKm: number): number[] {
  if (chunkKm <= 0) return [];
  const breaks: number[] = [];
  let nextTarget = chunkKm;
  const total = points[points.length - 1].cumKm;
  while (nextTarget < total) {
    const index = points.findIndex((point) => point.cumKm >= nextTarget);
    if (index > 0 && index < points.length - 1) breaks.push(index);
    nextTarget += chunkKm;
  }
  return breaks;
}

export function unionBreakpoints(...sets: number[][]): number[] {
  const set = new Set<number>();
  for (const list of sets) for (const value of list) set.add(value);
  return Array.from(set).sort((a, b) => a - b);
}

export interface IndexRange {
  startIndex: number;
  endIndex: number;
}

export type UrbanRange = IndexRange;

/**
 * Surface is categorical, so a chunk that spans more than one surface is labelled by
 * the surface covering the most distance within its range. Returns asphalt when no
 * per-point surface data is available.
 */
export function dominantSurface(
  points: RoutePoint[],
  range: IndexRange,
  perPointSurface: Surface[],
): Surface {
  const distanceBySurface = new Map<Surface, number>();
  for (let index = range.startIndex; index < range.endIndex; index += 1) {
    const segKm = points[index + 1].cumKm - points[index].cumKm;
    if (segKm <= 0) continue;
    const surface = perPointSurface[index] ?? DEFAULT_SURFACE;
    distanceBySurface.set(surface, (distanceBySurface.get(surface) ?? 0) + segKm);
  }
  let dominant: Surface = DEFAULT_SURFACE;
  let dominantKm = -1;
  for (const [surface, km] of distanceBySurface) {
    if (km > dominantKm) {
      dominantKm = km;
      dominant = surface;
    }
  }
  return dominant;
}

const URBAN_GAP_BRIDGE_KM = 0.5;
const URBAN_MIN_RANGE_KM = 0.3;

const CURVY_WINDOW_KM = 0.3;
const CURVY_GAP_BRIDGE_KM = 0.3;
const CURVY_MIN_RANGE_KM = 0.2;

function flagRuns(flags: boolean[]): IndexRange[] {
  const runs: IndexRange[] = [];
  let cursor = 0;
  while (cursor < flags.length) {
    if (!flags[cursor]) {
      cursor += 1;
      continue;
    }
    const startIndex = cursor;
    while (cursor < flags.length && flags[cursor]) cursor += 1;
    runs.push({ startIndex, endIndex: cursor - 1 });
  }
  return runs;
}

function coalesceRuns(runs: IndexRange[], points: RoutePoint[], gapKm: number, minKm: number): IndexRange[] {
  const merged: IndexRange[] = runs.length > 0 ? [{ ...runs[0] }] : [];
  for (let index = 1; index < runs.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = runs[index];
    const gap = points[current.startIndex].cumKm - points[previous.endIndex].cumKm;
    if (gap <= gapKm) {
      previous.endIndex = current.endIndex;
    } else {
      merged.push({ ...current });
    }
  }
  return merged.filter(
    (range) => points[range.endIndex].cumKm - points[range.startIndex].cumKm >= minKm,
  );
}

export function computeUrbanRanges(flags: boolean[], points?: RoutePoint[]): UrbanRange[] {
  const runs = flagRuns(flags);
  if (!points) return runs;
  return coalesceRuns(runs, points, URBAN_GAP_BRIDGE_KM, URBAN_MIN_RANGE_KM);
}

/**
 * Sinuosity within a window around the point: arc length divided by the straight-line chord between
 * the window endpoints. A straight road is ~1.0 even with dense GPS jitter (which a turn-rate
 * measure would saturate on); real bends push it higher.
 */
function windowSinuosity(points: RoutePoint[], index: number, windowKm: number): number {
  const centerKm = points[index].cumKm;
  let startIndex = index;
  while (startIndex > 0 && centerKm - points[startIndex].cumKm < windowKm / 2) startIndex -= 1;
  let endIndex = index;
  while (endIndex < points.length - 1 && points[endIndex].cumKm - centerKm < windowKm / 2) endIndex += 1;
  const arcKm = points[endIndex].cumKm - points[startIndex].cumKm;
  if (arcKm <= 0) return 1;
  const chordKm = haversineKm(points[startIndex], points[endIndex]);
  if (chordKm <= 0) return 99;
  return arcKm / chordKm;
}

export function computeCurvyRanges(points: RoutePoint[]): IndexRange[] {
  if (points.length < 3) return [];
  const sinuosityThreshold = getTuning().curvySinuosity;
  const flags = points.map(
    (_, index) => windowSinuosity(points, index, CURVY_WINDOW_KM) >= sinuosityThreshold,
  );
  return coalesceRuns(flagRuns(flags), points, CURVY_GAP_BRIDGE_KM, CURVY_MIN_RANGE_KM);
}

/** Drop curvy breakpoints that fall strictly inside an urban range, so an urban+curvy area
 *  stays a single section instead of being split into many curvy pieces. */
export function curvyBreakpointsOutsideUrban(
  curvyRanges: IndexRange[],
  urbanRanges: IndexRange[],
  pointCount: number,
): number[] {
  return rangeBreakpoints(curvyRanges, pointCount).filter(
    (breakIndex) => !urbanRanges.some((urban) => breakIndex > urban.startIndex && breakIndex < urban.endIndex),
  );
}

export function rangeBreakpoints(ranges: IndexRange[], pointCount: number): number[] {
  const breaks: number[] = [];
  for (const range of ranges) {
    if (range.startIndex > 0 && range.startIndex < pointCount - 1) breaks.push(range.startIndex);
    if (range.endIndex > 0 && range.endIndex < pointCount - 1) breaks.push(range.endIndex);
  }
  return breaks;
}

export function rangeOverlaps(
  startIndex: number,
  endIndex: number,
  ranges: IndexRange[],
  minFraction = 0.5,
): boolean {
  for (const range of ranges) {
    if (range.endIndex < startIndex || range.startIndex > endIndex) continue;
    const overlapStart = Math.max(range.startIndex, startIndex);
    const overlapEnd = Math.min(range.endIndex, endIndex);
    const overlapLen = overlapEnd - overlapStart;
    if (overlapLen <= 0) continue;
    const chunkLen = endIndex - startIndex;
    if (chunkLen <= 0) return true;
    if (overlapLen / chunkLen >= minFraction) return true;
  }
  return false;
}


