import type { Chunk } from './types';
import { urbanStopPenaltyMin } from './simulate';

// Usable carbohydrate energy before the tank runs dry, per kg of body mass. Glycogen storage
// scales with muscle mass; this "effective" figure already accounts for fat covering part of the
// demand, and is calibrated so a hard multi-hour ride approaches 100% while an easy one stays low.
// Tunable — this is an estimate, not a measurement.
export const CARB_CAPACITY_KJ_PER_KG = 35;

// Share of energy drawn from carbohydrate as a function of intensity. Fat covers most of the
// demand at low intensity; carbohydrate dominates near and above threshold (bonk territory).
export function carbFraction(fractionOfFtp: number): number {
  if (fractionOfFtp <= 0.5) return 0.4;
  if (fractionOfFtp >= 1.0) return 1.0;
  return 0.4 + ((fractionOfFtp - 0.5) / 0.5) * 0.6;
}

export interface ChunkExhaustion {
  startPct: number;
  endPct: number;
}

function movingSecondsFor(chunk: Chunk): number {
  const dwellMin = chunk.urban ? urbanStopPenaltyMin(chunk.lengthKm) : 0;
  return Math.max(0, chunk.durationMin - dwellMin) * 60;
}

export function exhaustionByChunk(
  chunks: Chunk[],
  riderWeightKg: number,
  ftpW: number,
): ChunkExhaustion[] {
  const capacityKJ = Math.max(1, riderWeightKg * CARB_CAPACITY_KJ_PER_KG);
  let cumulativeKJ = 0;

  return chunks.map((chunk) => {
    const startPct = Math.min(100, (cumulativeKJ / capacityKJ) * 100);
    const mechanicalKJ = (chunk.effectivePower * movingSecondsFor(chunk)) / 1000;
    const intensity = ftpW > 0 ? chunk.effectivePower / ftpW : 0;
    cumulativeKJ += mechanicalKJ * carbFraction(intensity);
    const endPct = Math.min(100, (cumulativeKJ / capacityKJ) * 100);
    return { startPct, endPct };
  });
}

/** Exhaustion (0–100) at a distance along the ride, interpolated within the chunk that km falls in. */
export function exhaustionAtKm(km: number, chunks: Chunk[], byChunk: ChunkExhaustion[]): number {
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (km <= chunk.endKm || index === chunks.length - 1) {
      const span = chunk.lengthKm || 1;
      const within = Math.min(1, Math.max(0, (km - chunk.startKm) / span));
      const { startPct, endPct } = byChunk[index];
      return startPct + (endPct - startPct) * within;
    }
  }
  return 0;
}
