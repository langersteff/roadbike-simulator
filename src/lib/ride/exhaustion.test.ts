import { describe, it, expect } from 'vitest';
import { carbFraction, exhaustionByChunk, exhaustionAtKm, CARB_CAPACITY_KJ_PER_KG } from './exhaustion';
import type { Chunk } from './types';

function chunk(partial: Partial<Chunk>): Chunk {
  return {
    index: 0, startIndex: 0, endIndex: 1, startKm: 0, endKm: 1, lengthKm: 1,
    avgBearingDeg: 0, bearingVarianceDeg: 0, avgGradePct: 0, avgElevationM: 0,
    positionAuto: 'hoods', surfaceAuto: 'asphalt', urban: false, curvy: false,
    weather: null, overrides: {}, effectivePower: 200, effectivePosition: 'hoods',
    effectiveHeadwindKph: 0, effectiveTemperatureC: 15, effectivePrecipitationMmH: 0,
    effectiveSurface: 'asphalt', effectiveGradePct: 0, effectiveVelocityKph: 30,
    durationMin: 60, etaFromStartMin: 0, ...partial,
  };
}

describe('carbFraction', () => {
  it('rises from fat-dominant at low intensity to all-carb at threshold', () => {
    expect(carbFraction(0.4)).toBeCloseTo(0.4, 5);
    expect(carbFraction(0.5)).toBeCloseTo(0.4, 5);
    expect(carbFraction(0.75)).toBeCloseTo(0.7, 5);
    expect(carbFraction(1.0)).toBeCloseTo(1.0, 5);
    expect(carbFraction(1.3)).toBeCloseTo(1.0, 5);
  });
});

describe('exhaustionByChunk', () => {
  it('accumulates glycogen cost toward the rider capacity', () => {
    // 300 W for 1 h at FTP 300 (intensity 1.0 -> carbFraction 1.0):
    // mechanical = 300 W * 3600 s / 1000 = 1080 kJ of carb cost.
    const [result] = exhaustionByChunk([chunk({ effectivePower: 300, durationMin: 60 })], 70, 300);
    const capacityKJ = 70 * CARB_CAPACITY_KJ_PER_KG;
    expect(result.startPct).toBe(0);
    expect(result.endPct).toBeCloseTo((1080 / capacityKJ) * 100, 1);
  });

  it('caps at 100 and an easy ride stays well below', () => {
    const easy = exhaustionByChunk([chunk({ effectivePower: 120, durationMin: 120 })], 70, 300);
    expect(easy[0].endPct).toBeLessThan(60);

    const brutal = exhaustionByChunk(
      [chunk({ effectivePower: 320, durationMin: 300 })],
      70,
      300,
    );
    expect(brutal[0].endPct).toBe(100);
  });
});

describe('exhaustionAtKm', () => {
  it('interpolates linearly within a chunk', () => {
    const chunks = [chunk({ startKm: 0, endKm: 10, lengthKm: 10 })];
    const byChunk = [{ startPct: 20, endPct: 40 }];
    expect(exhaustionAtKm(0, chunks, byChunk)).toBeCloseTo(20, 5);
    expect(exhaustionAtKm(5, chunks, byChunk)).toBeCloseTo(30, 5);
    expect(exhaustionAtKm(10, chunks, byChunk)).toBeCloseTo(40, 5);
  });
});
