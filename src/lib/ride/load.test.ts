import { describe, it, expect } from 'vitest';
import { computeLoadSummary, cumulativeLoadByChunk, loadAtKm } from './load';
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
    // URBAN_STOPS_PER_KM 1.2 × 10 km × (12+6)s/60 = 3.6 min of dwell removed.
    expect(summary.movingSeconds).toBeCloseTo((60 - 3.6) * 60, 1);
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

  it('splits a chunk across zones using per-segment zoneSeconds when present', () => {
    const mixed = chunk({ durationMin: 30, effectivePower: 300, zoneSeconds: { Z2: 600, Z3: 1200 } });
    const summary = computeLoadSummary([mixed], 300);
    expect(summary.zoneMinutes.Z2).toBeCloseTo(10, 5);
    expect(summary.zoneMinutes.Z3).toBeCloseTo(20, 5);
  });
});

describe('cumulativeLoadByChunk', () => {
  const chunks = [
    chunk({ startKm: 0, endKm: 20, lengthKm: 20, effectivePower: 200, durationMin: 40 }),
    chunk({ startKm: 20, endKm: 40, lengthKm: 20, effectivePower: 280, durationMin: 40 }),
  ];

  it('is monotonic and ends at the ride total TSS', () => {
    const byChunk = cumulativeLoadByChunk(chunks, 300);
    const total = computeLoadSummary(chunks, 300).tss;
    expect(byChunk[0].startTss).toBe(0);
    expect(byChunk[1].endTss).toBeCloseTo(total, 5);
    expect(byChunk[1].startTss).toBeGreaterThan(byChunk[0].startTss);
  });

  it('interpolates cumulative load within a chunk', () => {
    const byChunk = cumulativeLoadByChunk(chunks, 300);
    const midFirst = loadAtKm(10, chunks, byChunk);
    expect(midFirst).toBeGreaterThan(byChunk[0].startTss);
    expect(midFirst).toBeLessThan(byChunk[0].endTss);
  });
});
