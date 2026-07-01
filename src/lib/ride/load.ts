import type { Chunk } from './types';
import { zoneForFraction, ZONE_IDS, type ZoneId } from './zones';
import { urbanStopPenaltyMin } from './simulate';

export interface LoadSummary {
  ftpW: number;
  npW: number;
  intensityFactor: number;
  tss: number;
  movingSeconds: number;
  zoneMinutes: Record<ZoneId, number>;
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
    weightedFourthPower += chunk.effectivePower ** 4 * seconds;
    if (ftpW > 0) {
      zoneMinutes[zoneForFraction(chunk.effectivePower / ftpW)] += movingMin;
    }
  }

  const npW = movingSeconds > 0 ? (weightedFourthPower / movingSeconds) ** 0.25 : 0;
  const intensityFactor = ftpW > 0 ? npW / ftpW : 0;
  const tss = ftpW > 0 ? ((movingSeconds * npW * intensityFactor) / (ftpW * 3600)) * 100 : 0;

  return { ftpW, npW, intensityFactor, tss, movingSeconds, zoneMinutes };
}
