import { describe, it, expect } from 'vitest';
import {
  buildChunks,
  cascadeEta,
  evaluateChunk,
  heatPowerFactor,
  resolveBreaks,
  simulate,
  windPowerFactor,
  climbDemandFraction,
} from './simulate';
import { computeLoadSummary } from './load';
import { RIDE_PROFILES, deriveFtpW } from './zones';
import { headwindKphFromWeather } from './wind';
import { computeCurvyRanges, type SplitConfig } from '../chunking/strategies';
import { withCumulativeKm } from '../gpx/geometry';
import { computeOutputs } from '../calc';
import { DESCENT_MAX_KPH, URBAN_STOPS_PER_KM, STOP_DWELL_S, STOP_ACCEL_PENALTY_S, WIND_HEIGHT_FACTOR } from '../constants';
import type { RoutePoint } from '../gpx/parse';
import type { Chunk, RideBreak, RiderProfile } from './types';
import type { WeatherSample } from '../weather/openMeteo';

const PROFILE: RiderProfile = {
  riderWeight: 75,
  bikeWeight: 9,
  bodyHeightCm: 175,
  tire: 'clincher',
  baselinePower: 200,
  defaultPosition: 'hoods',
};

// A straight north-bound route (constant lon, increasing lat) so bearing never changes and the
// cornering cap stays inactive; cumKm and elevation are set explicitly to control gradient.
function straightRoute(elevations: number[], segKm: number): RoutePoint[] {
  return elevations.map((ele, index) => ({
    lat: 45 + index * 0.01,
    lon: 8,
    ele,
    cumKm: index * segKm,
  }));
}

function evaluate(points: RoutePoint[], opts: Partial<Parameters<typeof evaluateChunk>[0]> = {}) {
  return evaluateChunk({
    range: { startIndex: 0, endIndex: points.length - 1 },
    index: 0,
    points,
    profile: PROFILE,
    overrides: {},
    weather: null,
    autoAerobar: false,
    keepPowerSteady: true,
    heatEffect: false,
    rideProfile: 'endurance',
    urbanRanges: [],
    curvyRanges: [],
    ...opts,
  });
}

describe('heatPowerFactor (physiological derate)', () => {
  it('applies no penalty at or below the 25 °C onset threshold', () => {
    expect(heatPowerFactor(15)).toBe(1);
    expect(heatPowerFactor(25)).toBe(1);
  });

  it('drops ~15% at 30 °C, the Périard meta-analysis anchor', () => {
    expect(heatPowerFactor(30)).toBeCloseTo(0.85, 5);
  });

  it('floors at a 30% reduction from 35 °C upward', () => {
    expect(heatPowerFactor(35)).toBeCloseTo(0.7, 5);
    expect(heatPowerFactor(45)).toBeCloseTo(0.7, 5);
  });

  it('decreases monotonically with temperature', () => {
    expect(heatPowerFactor(28)).toBeLessThan(heatPowerFactor(26));
    expect(heatPowerFactor(32)).toBeLessThan(heatPowerFactor(28));
  });
});

describe('heat effect on the ride', () => {
  it('is slower in the heat than in the cool when enabled', () => {
    const flat = straightRoute([0, 0, 0, 0, 0, 0], 0.5);
    const cool = evaluate(flat, { heatEffect: true, overrides: { temperatureC: 15 } });
    const hot = evaluate(flat, { heatEffect: true, overrides: { temperatureC: 35 } });
    expect(hot.effectiveVelocityKph).toBeLessThan(cool.effectiveVelocityKph);
    expect(hot.effectivePower).toBeLessThan(cool.effectivePower);
  });

  it('leaves a hot ride unchanged when the effect is disabled', () => {
    const flat = straightRoute([0, 0, 0, 0, 0, 0], 0.5);
    const off = evaluate(flat, { heatEffect: false, overrides: { temperatureC: 35 } });
    const on = evaluate(flat, { heatEffect: true, overrides: { temperatureC: 35 } });
    expect(on.effectivePower).toBeLessThan(off.effectivePower);
    expect(on.effectiveVelocityKph).toBeLessThan(off.effectiveVelocityKph);
  });
});

describe('per-segment integration', () => {
  it('takes longer on rolling terrain than a single solve at the average (flat) grade', () => {
    // +6% / -6% rollers; net elevation change is zero so the averaged grade is 0%.
    const rolling = straightRoute([0, 30, 0, 30, 0, 30, 0, 30, 0], 0.5);
    const totalKm = rolling[rolling.length - 1].cumKm;

    const integrated = evaluate(rolling).durationMin;
    const flat = computeOutputs({
      id: 'flat',
      label: 'flat',
      mode: 'power',
      power: PROFILE.baselinePower,
      velocity: 0,
      riderWeight: PROFILE.riderWeight,
      bikeWeight: PROFILE.bikeWeight,
      bodyHeightCm: PROFILE.bodyHeightCm,
      tire: PROFILE.tire,
      position: PROFILE.defaultPosition,
      grade: 0,
      headwind: 0,
      distance: totalKm,
      temperature: 15,
      elevation: 15,
    }).timeMin;

    expect(integrated).toBeGreaterThan(flat);
  });
});

describe('descent capping', () => {
  it('keeps a steep straight descent at or below the absolute ceiling', () => {
    // -15% sustained descent (rider coasts at this gradient).
    const descent = straightRoute([900, 825, 750, 675, 600], 0.5);
    const chunk = evaluate(descent);
    expect(chunk.effectiveVelocityKph).toBeLessThanOrEqual(DESCENT_MAX_KPH + 1e-6);
  });

  it('coasts to a finite capped speed in the default (variable-power) mode', () => {
    // keepPowerSteady=false -> power tapers to zero on a steep descent; the solver must still
    // converge to a terminal velocity instead of dropping the segments.
    const descent = straightRoute([900, 825, 750, 675, 600], 0.5);
    const chunk = evaluate(descent, { keepPowerSteady: false });
    expect(chunk.durationMin).toBeGreaterThan(0);
    expect(chunk.effectiveVelocityKph).toBeGreaterThan(0);
    expect(chunk.effectiveVelocityKph).toBeLessThanOrEqual(DESCENT_MAX_KPH + 1e-6);
  });
});

describe('urban stop penalty', () => {
  it('adds stop time inside a settlement', () => {
    const flat = straightRoute([0, 0, 0, 0, 0], 0.5);
    const base = evaluate(flat, { urbanRanges: [] }).durationMin;
    const urban = evaluate(flat, { urbanRanges: [{ startIndex: 0, endIndex: 4 }] }).durationMin;

    const lengthKm = flat[flat.length - 1].cumKm;
    const expectedPenalty = URBAN_STOPS_PER_KM * lengthKm * ((STOP_DWELL_S + STOP_ACCEL_PENALTY_S) / 60);
    expect(urban - base).toBeCloseTo(expectedPenalty, 5);
  });
});

describe('curvy sections never auto-select aerobars', () => {
  it('auto-picks aerobar on a straight flat section but falls back when flagged curvy', () => {
    const straight = straightRoute([0, 0, 0, 0, 0, 0], 0.5);
    const onAero = evaluate(straight, { autoAerobar: true });
    expect(onAero.positionAuto).toBe('aerobar');

    const flaggedCurvy = evaluate(straight, {
      autoAerobar: true,
      curvyRanges: [{ startIndex: 0, endIndex: straight.length - 1 }],
    });
    expect(flaggedCurvy.positionAuto).toBe(PROFILE.defaultPosition);
  });
});

describe('rough surfaces never auto-select aerobars', () => {
  it('falls back from aerobar on a straight flat section once it is gravel', () => {
    const straight = straightRoute([0, 0, 0, 0, 0, 0], 0.5);
    const onAero = evaluate(straight, { autoAerobar: true });
    expect(onAero.positionAuto).toBe('aerobar');

    const onGravel = evaluate(straight, {
      autoAerobar: true,
      surfaces: straight.map(() => 'gravel' as const),
    });
    expect(onGravel.positionAuto).toBe(PROFILE.defaultPosition);
  });
});

describe('surface slows the chunk', () => {
  it('is slower on gravel than asphalt at equal power', () => {
    const flat = straightRoute([0, 0, 0, 0, 0, 0], 0.5);
    const asphalt = evaluate(flat);
    const gravel = evaluate(flat, { surfaces: flat.map(() => 'gravel' as const) });
    expect(gravel.effectiveSurface).toBe('gravel');
    expect(gravel.effectiveVelocityKph).toBeLessThan(asphalt.effectiveVelocityKph);
  });
});

describe('curvy range detection', () => {
  function routeFrom(coords: Array<[number, number]>): RoutePoint[] {
    return withCumulativeKm(coords.map(([lat, lon]) => ({ lat, lon, ele: 0 })));
  }

  // Straight north stretch, a tight zigzag in the middle, then straight north again.
  function straightTwistyStraight(): RoutePoint[] {
    const coords: Array<[number, number]> = [];
    let lat = 45;
    let lon = 8;
    for (let step = 0; step < 14; step += 1) {
      coords.push([lat, lon]);
      lat += 0.0005;
    }
    for (let step = 0; step < 24; step += 1) {
      coords.push([lat, lon]);
      lat += 0.00015;
      lon += step % 2 === 0 ? 0.0006 : -0.0006;
    }
    for (let step = 0; step < 14; step += 1) {
      coords.push([lat, lon]);
      lat += 0.0005;
    }
    return routeFrom(coords);
  }

  it('returns no ranges for a straight route', () => {
    const straight = routeFrom(Array.from({ length: 30 }, (_, index) => [45 + index * 0.0005, 8]));
    expect(computeCurvyRanges(straight)).toHaveLength(0);
  });

  it('isolates the twisty middle as a single coalesced range', () => {
    const points = straightTwistyStraight();
    const ranges = computeCurvyRanges(points);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startIndex).toBeGreaterThan(0);
    expect(ranges[0].endIndex).toBeLessThan(points.length - 1);
  });
});

describe('flat-chunk merging ignores wind', () => {
  it('merges flat pieces of a bending route into one chunk', () => {
    // A perfectly flat route that heads north for the first half and east for the second.
    // The bearing change used to flip the headwind bucket and keep the pieces apart; grade is
    // flat throughout, so the pieces (split by maxSectionKm) must collapse into a single chunk.
    const points: RoutePoint[] = Array.from({ length: 13 }, (_, index) => ({
      lat: index <= 6 ? 45 + index * 0.02 : 45.12,
      lon: index <= 6 ? 8 : 8 + (index - 6) * 0.02,
      ele: 0,
      cumKm: index * 2,
    }));
    const split: SplitConfig = {
      grade: true,
      fixedDistance: { on: false, km: 5 },
      urbanArea: false,
      curvy: false,
      minSectionKm: 0.5,
      maxSectionKm: 10,
    };

    const ranges = buildChunks(points, split, 0, []);
    expect(ranges).toHaveLength(1);
  });
});

describe('wind at rider height', () => {
  it('reduces forecast 10 m wind to the boundary-layer value', () => {
    const weather: WeatherSample = {
      time: '2026-06-17T08:00',
      windMs: 10,
      windFromDeg: 0,
      tempC: 15,
      precipitationMmH: 0,
    };
    // Heading due north (0°) into a wind coming from the north => pure headwind.
    expect(headwindKphFromWeather(weather, 0)).toBeCloseTo(10 * WIND_HEIGHT_FACTOR * 3.6, 5);
  });
});

describe('profile-driven effort model', () => {
  // 15% climb, 1 km segment — steep enough that endurance hits its ceiling while hiit has room above it.
  const climb = straightRoute([0, 150], 1);

  it('endurance flat effort sits at the profile cruise fraction of FTP', () => {
    const flat = straightRoute([100, 100], 1);
    const chunk = evaluate(flat, { keepPowerSteady: false, rideProfile: 'endurance' });
    const cruiseW = deriveFtpW(200) * RIDE_PROFILES.endurance.cruiseFraction;
    expect(chunk.effectivePower).toBeCloseTo(cruiseW, 0);
  });

  it('endurance clamps a steep climb to the Z3 ceiling (90% FTP)', () => {
    const chunk = evaluate(climb, { keepPowerSteady: false, rideProfile: 'endurance' });
    const ceilingW = deriveFtpW(200) * RIDE_PROFILES.endurance.ceilingFraction;
    expect(chunk.effectivePower).toBeCloseTo(ceilingW, 0);
  });

  it('high intensity allows more climb power than endurance', () => {
    const enduranceChunk = evaluate(climb, { keepPowerSteady: false, rideProfile: 'endurance' });
    const hiitChunk = evaluate(climb, { keepPowerSteady: false, rideProfile: 'hiit' });
    expect(hiitChunk.effectivePower).toBeGreaterThan(enduranceChunk.effectivePower);
  });

  it('powerFourthMean yields a normalized power above average on rolling terrain', () => {
    const rolling = straightRoute([0, 0, 0, 120], 1);
    const chunk = evaluate(rolling, { keepPowerSteady: false, rideProfile: 'hiit' });
    const normalizedPower = chunk.powerFourthMean! ** 0.25;
    expect(normalizedPower).toBeGreaterThan(chunk.effectivePower);
  });

  it('powerFourthMean equals flat power on constant-grade terrain', () => {
    const flat = straightRoute([100, 100], 1);
    const chunk = evaluate(flat, { keepPowerSteady: false, rideProfile: 'endurance' });
    expect(chunk.powerFourthMean! ** 0.25).toBeCloseTo(chunk.effectivePower, 0);
  });
});

describe('windPowerFactor', () => {
  it('is neutral in calm and tailwind', () => {
    expect(windPowerFactor(0, 0)).toBe(1);
    expect(windPowerFactor(-20, 0)).toBe(1);
  });

  it('raises effort with headwind and (at reduced weight) crosswind', () => {
    expect(windPowerFactor(25, 0)).toBeCloseTo(1.3, 5);
    expect(windPowerFactor(0, 10)).toBeCloseTo(1.06, 5);
  });

  it('caps the wind-driven bump', () => {
    expect(windPowerFactor(100, 0)).toBeCloseTo(1.5, 5);
  });
});

describe('climb demand (decoupled from cruise)', () => {
  it('is zero on flat/descent and rises with grade', () => {
    expect(climbDemandFraction(0, 'endurance')).toBe(0);
    expect(climbDemandFraction(-5, 'endurance')).toBe(0);
    expect(climbDemandFraction(4, 'endurance')).toBeCloseTo(0.62 + 4 * 0.025, 5);
  });

  it('rises more gently on easy endurance than endurance', () => {
    expect(climbDemandFraction(4, 'easyEndurance')).toBeLessThan(climbDemandFraction(4, 'endurance'));
    expect(climbDemandFraction(4, 'easyEndurance')).toBeCloseTo(0.62 + 4 * 0.015, 5);
  });

  it('tallies zone time per segment so a mixed chunk spans zones', () => {
    const flatThenSteep = straightRoute([0, 0, 0, 120], 1); // three flat segments, one 12% ramp
    const chunk = evaluate(flatThenSteep, { keepPowerSteady: false, rideProfile: 'endurance' });
    expect((chunk.zoneSeconds?.Z2 ?? 0)).toBeGreaterThan(0);
    expect((chunk.zoneSeconds?.Z3 ?? 0)).toBeGreaterThan(0);
  });

  it('a moderate climb is driven by grade demand, not the cruise fraction', () => {
    const climb4 = straightRoute([0, 40], 1); // 4% grade
    const chunk = evaluate(climb4, { keepPowerSteady: false, rideProfile: 'endurance' });
    const expected = deriveFtpW(200) * climbDemandFraction(4, 'endurance');
    expect(chunk.effectivePower).toBeCloseTo(expected, 0);
  });
});

describe('wind raises effort power', () => {
  it('a headwind lifts flat-ground power', () => {
    const flat = straightRoute([100, 100], 1);
    const calm = evaluate(flat, { keepPowerSteady: false, rideProfile: 'tempo' });
    const windy = evaluate(flat, {
      keepPowerSteady: false,
      rideProfile: 'tempo',
      overrides: { headwindKph: 25 },
    });
    expect(windy.effectivePower).toBeGreaterThan(calm.effectivePower);
  });
});

// Three back-to-back 10-minute chunks spanning 0..30 km. Only startKm/endKm/durationMin drive
// the ETA cascade, so a partial cast keeps the fixtures readable.
function cascadeChunks(): Array<Omit<Chunk, 'etaFromStartMin'>> {
  return [0, 10, 20].map(
    (startKm) => ({ startKm, endKm: startKm + 10, durationMin: 10 }) as unknown as Omit<Chunk, 'etaFromStartMin'>,
  );
}

describe('cascadeEta with breaks', () => {
  it('matches the plain cascade when there are no breaks', () => {
    const etas = cascadeEta(cascadeChunks()).map((chunk) => chunk.etaFromStartMin);
    expect(etas).toEqual([0, 10, 20]);
  });

  it('shifts only the chunks after a distance break', () => {
    const breaks: RideBreak[] = [{ id: 'a', anchor: { kind: 'distance', km: 10 }, durationMin: 30 }];
    const etas = cascadeEta(cascadeChunks(), breaks).map((chunk) => chunk.etaFromStartMin);
    expect(etas).toEqual([0, 40, 50]);
  });

  it('injects a time break at the first boundary where elapsed reaches the target', () => {
    const breaks: RideBreak[] = [{ id: 'b', anchor: { kind: 'time', elapsedMin: 15 }, durationMin: 20 }];
    const etas = cascadeEta(cascadeChunks(), breaks).map((chunk) => chunk.etaFromStartMin);
    expect(etas).toEqual([0, 10, 40]);
  });

  it('accumulates multiple breaks and still counts one placed past the route end', () => {
    const breaks: RideBreak[] = [
      { id: 'near', anchor: { kind: 'distance', km: 5 }, durationMin: 10 },
      { id: 'far', anchor: { kind: 'distance', km: 100 }, durationMin: 5 },
    ];
    const resolved = resolveBreaks(cascadeChunks(), breaks);
    const totalBreakMin = resolved.reduce((sum, brk) => sum + brk.durationMin, 0);
    expect(totalBreakMin).toBe(15);
    const beyondRoute = resolved.find((brk) => brk.id === 'far');
    expect(beyondRoute?.km).toBe(30);
  });
});

describe('resolveBreaks', () => {
  it('resolves distance and time anchors to km + elapsed start', () => {
    const breaks: RideBreak[] = [
      { id: 'dist', anchor: { kind: 'distance', km: 10 }, durationMin: 30 },
      { id: 'time', anchor: { kind: 'time', elapsedMin: 15 }, durationMin: 20 },
    ];
    const resolved = resolveBreaks(cascadeChunks(), breaks);
    const dist = resolved.find((brk) => brk.id === 'dist');
    const time = resolved.find((brk) => brk.id === 'time');
    expect(dist).toMatchObject({ km: 10, atElapsedMin: 10 });
    // The distance break adds 30 min at km 10, so elapsed at the next boundary already exceeds 15.
    expect(time?.km).toBe(10);
  });
});

describe('breaks leave training load untouched', () => {
  it('produces identical load with and without a break, only shifting ETAs', () => {
    const points = straightRoute([100, 110, 130, 160, 200], 4);
    const split: SplitConfig = {
      grade: true,
      fixedDistance: { on: true, km: 4 },
      urbanArea: false,
      curvy: false,
      minSectionKm: 0.5,
      maxSectionKm: 10,
    };
    const ranges = buildChunks(points, split, 0, []);
    expect(ranges.length).toBeGreaterThan(1);
    const base = {
      points,
      ranges,
      profile: PROFILE,
      overrides: ranges.map(() => ({})),
      weather: ranges.map(() => null),
      autoAerobar: false,
      keepPowerSteady: true,
      heatEffect: false,
      rideProfile: 'endurance' as const,
      urbanRanges: [],
      curvyRanges: [],
    };
    const ftpW = deriveFtpW(PROFILE.baselinePower);
    const without = simulate(base);
    const withBreak = simulate({
      ...base,
      breaks: [{ id: 'x', anchor: { kind: 'distance', km: 4 }, durationMin: 30 }],
    });

    expect(computeLoadSummary(withBreak, ftpW)).toEqual(computeLoadSummary(without, ftpW));
    const lastEta = withBreak[withBreak.length - 1].etaFromStartMin;
    const baselineEta = without[without.length - 1].etaFromStartMin;
    expect(lastEta).toBeGreaterThan(baselineEta);
  });
});
