import type { RoutePoint } from '../gpx/parse';

export interface RawChunkRange {
  startIndex: number;
  endIndex: number;
}

export function buildRanges(points: RoutePoint[], breakpoints: number[]): RawChunkRange[] {
  if (points.length < 2) return [];
  const sortedBreaks = Array.from(new Set(breakpoints)).sort((a, b) => a - b);
  const ranges: RawChunkRange[] = [];
  let cursor = 0;
  for (const brk of sortedBreaks) {
    if (brk <= cursor || brk >= points.length - 1) continue;
    ranges.push({ startIndex: cursor, endIndex: brk });
    cursor = brk;
  }
  ranges.push({ startIndex: cursor, endIndex: points.length - 1 });
  return ranges;
}

export function enforceMaxLength(
  points: RoutePoint[],
  ranges: RawChunkRange[],
  maxSectionKm: number,
): RawChunkRange[] {
  if (maxSectionKm <= 0) return ranges;
  const result: RawChunkRange[] = [];
  for (const range of ranges) {
    const lengthKm = points[range.endIndex].cumKm - points[range.startIndex].cumKm;
    if (lengthKm <= maxSectionKm) {
      result.push(range);
      continue;
    }
    const pieces = Math.ceil(lengthKm / maxSectionKm);
    let pieceStart = range.startIndex;
    for (let pieceIndex = 1; pieceIndex < pieces; pieceIndex += 1) {
      const targetKm = points[range.startIndex].cumKm + (lengthKm * pieceIndex) / pieces;
      let pieceEnd = pieceStart + 1;
      while (pieceEnd < range.endIndex && points[pieceEnd].cumKm < targetKm) pieceEnd += 1;
      if (pieceEnd <= pieceStart) pieceEnd = pieceStart + 1;
      result.push({ startIndex: pieceStart, endIndex: pieceEnd });
      pieceStart = pieceEnd;
    }
    if (pieceStart < range.endIndex) {
      result.push({ startIndex: pieceStart, endIndex: range.endIndex });
    }
  }
  return result;
}

export function mergeShortRanges(
  points: RoutePoint[],
  ranges: RawChunkRange[],
  minSectionKm: number,
  protectedRanges: RawChunkRange[] = [],
): RawChunkRange[] {
  if (ranges.length <= 1) return ranges.slice();
  const lengthKm = (range: RawChunkRange) =>
    points[range.endIndex].cumKm - points[range.startIndex].cumKm;
  const isProtected = (range: RawChunkRange) =>
    protectedRanges.some(
      (protectedRange) =>
        protectedRange.startIndex < range.endIndex && protectedRange.endIndex > range.startIndex,
    );

  const result = ranges.map((range) => ({ ...range }));
  let index = 0;
  while (index < result.length) {
    if (lengthKm(result[index]) >= minSectionKm || isProtected(result[index])) {
      index += 1;
      continue;
    }
    if (result.length === 1) break;
    if (index === result.length - 1) {
      result[index - 1].endIndex = result[index].endIndex;
      result.splice(index, 1);
      index = Math.max(0, index - 1);
      continue;
    }
    if (index === 0) {
      result[index + 1].startIndex = result[index].startIndex;
      result.splice(index, 1);
      continue;
    }
    const prevLength = lengthKm(result[index - 1]);
    const nextLength = lengthKm(result[index + 1]);
    if (prevLength <= nextLength) {
      result[index - 1].endIndex = result[index].endIndex;
      result.splice(index, 1);
      index = Math.max(0, index - 1);
    } else {
      result[index + 1].startIndex = result[index].startIndex;
      result.splice(index, 1);
    }
  }
  return result;
}
