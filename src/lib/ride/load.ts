import type { Chunk } from './types';
import { zoneForFraction, ZONE_IDS, type ZoneId } from './zones';
import { urbanStopPenaltyMin } from './simulate';

export interface LoadSummary {
  readonly ftpW: number;
  readonly npW: number;
  readonly intensityFactor: number;
  readonly tss: number;
  readonly movingSeconds: number;
  readonly zoneMinutes: Readonly<Record<ZoneId, number>>;
}

function emptyZoneMinutes(): Record<ZoneId, number> {
  return ZONE_IDS.reduce((acc, id) => {
    acc[id] = 0;
    return acc;
  }, {} as Record<ZoneId, number>);
}

function chunkMovingSeconds(chunk: Chunk): number {
  const dwellMin = chunk.urban ? urbanStopPenaltyMin(chunk.lengthKm) : 0;
  return Math.max(0, chunk.durationMin - dwellMin) * 60;
}

function tssFrom(fourthPowerTime: number, seconds: number, ftpW: number): number {
  if (ftpW <= 0 || seconds <= 0) return 0;
  const np = (fourthPowerTime / seconds) ** 0.25;
  const intensityFactor = np / ftpW;
  return (seconds * intensityFactor ** 2) / 36;
}

export interface ChunkLoad {
  startTss: number;
  endTss: number;
}

/** Cumulative training load (TSS) at each chunk's start and end, so the curve ends at the ride total. */
export function cumulativeLoadByChunk(chunks: Chunk[], ftpW: number): ChunkLoad[] {
  let seconds = 0;
  let fourthPowerTime = 0;
  return chunks.map((chunk) => {
    const startTss = tssFrom(fourthPowerTime, seconds, ftpW);
    const chunkSeconds = chunkMovingSeconds(chunk);
    seconds += chunkSeconds;
    fourthPowerTime += (chunk.powerFourthMean ?? chunk.effectivePower ** 4) * chunkSeconds;
    const endTss = tssFrom(fourthPowerTime, seconds, ftpW);
    return { startTss, endTss };
  });
}

/** Cumulative TSS at a distance, interpolated within the chunk that km falls in. */
export function loadAtKm(km: number, chunks: Chunk[], byChunk: ChunkLoad[]): number {
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (km <= chunk.endKm || index === chunks.length - 1) {
      const span = chunk.lengthKm || 1;
      const within = Math.min(1, Math.max(0, (km - chunk.startKm) / span));
      const { startTss, endTss } = byChunk[index];
      return startTss + (endTss - startTss) * within;
    }
  }
  return 0;
}

export function computeLoadSummary(chunks: Chunk[], ftpW: number): LoadSummary {
  const zoneMinutes = emptyZoneMinutes();
  let movingSeconds = 0;
  let weightedFourthPower = 0;

  for (const chunk of chunks) {
    const seconds = chunkMovingSeconds(chunk);
    if (seconds <= 0) continue;

    movingSeconds += seconds;
    // Prefer the chunk's time-weighted mean of power⁴ (captures within-chunk variability); fall
    // back to the flat chunk power for state persisted before that field existed.
    const fourthPower = chunk.powerFourthMean ?? chunk.effectivePower ** 4;
    weightedFourthPower += fourthPower * seconds;
    // Prefer per-segment zone tallies (a chunk can span zones); fall back to bucketing the whole
    // chunk by its average power for state persisted before zoneSeconds existed.
    if (chunk.zoneSeconds) {
      for (const id of ZONE_IDS) {
        zoneMinutes[id] += (chunk.zoneSeconds[id] ?? 0) / 60;
      }
    } else if (ftpW > 0) {
      zoneMinutes[zoneForFraction(chunk.effectivePower / ftpW)] += seconds / 60;
    }
  }

  const npW = movingSeconds > 0 ? (weightedFourthPower / movingSeconds) ** 0.25 : 0;
  const intensityFactor = ftpW > 0 ? npW / ftpW : 0;
  const tss = ftpW > 0 ? ((movingSeconds * npW * intensityFactor) / (ftpW * 3600)) * 100 : 0;

  return { ftpW, npW, intensityFactor, tss, movingSeconds, zoneMinutes };
}
