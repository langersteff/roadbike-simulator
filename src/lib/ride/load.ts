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

export function computeLoadSummary(chunks: Chunk[], ftpW: number): LoadSummary {
  const zoneMinutes = emptyZoneMinutes();
  let movingSeconds = 0;
  let weightedFourthPower = 0;

  for (const chunk of chunks) {
    const dwellMin = chunk.urban ? urbanStopPenaltyMin(chunk.lengthKm) : 0;
    const movingMin = Math.max(0, chunk.durationMin - dwellMin);
    const seconds = movingMin * 60;
    if (seconds <= 0) continue;

    movingSeconds += seconds;
    // Prefer the chunk's time-weighted mean of power⁴ (captures within-chunk variability); fall
    // back to the flat chunk power for state persisted before that field existed.
    const fourthPower = chunk.powerFourthMean ?? chunk.effectivePower ** 4;
    weightedFourthPower += fourthPower * seconds;
    if (ftpW > 0) {
      zoneMinutes[zoneForFraction(chunk.effectivePower / ftpW)] += movingMin;
    }
  }

  const npW = movingSeconds > 0 ? (weightedFourthPower / movingSeconds) ** 0.25 : 0;
  const intensityFactor = ftpW > 0 ? npW / ftpW : 0;
  const tss = ftpW > 0 ? ((movingSeconds * npW * intensityFactor) / (ftpW * 3600)) * 100 : 0;

  return { ftpW, npW, intensityFactor, tss, movingSeconds, zoneMinutes };
}
