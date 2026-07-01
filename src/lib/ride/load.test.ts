import { describe, it, expect } from 'vitest';
import { computeLoadSummary } from './load';
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

describe('computeLoadSummary', () => {
  it('computes IF and TSS for one hour at threshold power', () => {
    const summary = computeLoadSummary([chunk({ effectivePower: 300, durationMin: 60 })], 300);
    expect(summary.ftpW).toBe(300);
    expect(summary.npW).toBeCloseTo(300, 5);
    expect(summary.intensityFactor).toBeCloseTo(1.0, 5);
    expect(summary.tss).toBeCloseTo(100, 1);
    expect(summary.movingSeconds).toBe(3600);
  });

  it('excludes urban stop-dwell time from moving seconds', () => {
    const urbanChunk = chunk({ urban: true, lengthKm: 10, durationMin: 60, effectivePower: 300 });
    const summary = computeLoadSummary([urbanChunk], 300);
    // URBAN_STOPS_PER_KM 1.2 × 10 km × (12+6)s/60 = 36 min of dwell removed.
    expect(summary.movingSeconds).toBeCloseTo((60 - 36) * 60, 1);
  });

  it('accumulates minutes into the correct zones', () => {
    const summary = computeLoadSummary(
      [
        chunk({ effectivePower: 150, durationMin: 30 }), // 0.5 FTP -> Z1
        chunk({ effectivePower: 200, durationMin: 20 }), // 0.667 FTP -> Z2
        chunk({ effectivePower: 260, durationMin: 10 }), // 0.867 FTP -> Z3
      ],
      300,
    );
    expect(summary.zoneMinutes.Z1).toBeCloseTo(30, 5);
    expect(summary.zoneMinutes.Z2).toBeCloseTo(20, 5);
    expect(summary.zoneMinutes.Z3).toBeCloseTo(10, 5);
    expect(summary.zoneMinutes.Z4).toBe(0);
  });
});
