import { describe, it, expect, beforeEach } from 'vitest';
import { loadRideState, saveRideState } from './storage';

const V2_KEY = 'bikecalc.rideSimulator.v2';

const baseState = {
  gpx: null,
  startDateTime: '',
  split: { grade: true, maxSectionKm: 5, minSectionKm: 0.5, fixedDistance: { on: false, km: 5 } },
  profile: { riderWeight: 75, bikeWeight: 9, bodyHeightCm: 175, tire: 'clincher', defaultPosition: 'hoods' },
  chunks: [],
  colorScale: 'speed',
  units: 'metric',
};

describe('loadRideState migration', () => {
  beforeEach(() => localStorage.clear());

  it('migrates a v2 defaultPower profile to baselinePower', () => {
    const legacy = { ...baseState, profile: { ...baseState.profile, defaultPower: 220 } };
    localStorage.setItem(V2_KEY, JSON.stringify(legacy));

    const loaded = loadRideState();

    expect(loaded?.profile.baselinePower).toBe(220);
    expect((loaded?.profile as unknown as Record<string, unknown>).defaultPower).toBeUndefined();
    expect(localStorage.getItem(V2_KEY)).toBeNull();
  });

  it('round-trips baselinePower and rideProfile through the v3 key', () => {
    const state = {
      ...baseState,
      profile: { ...baseState.profile, baselinePower: 240 },
      rideProfile: 'tempo' as const,
    };
    saveRideState(state as never);

    const loaded = loadRideState();

    expect(loaded?.profile.baselinePower).toBe(240);
    expect(loaded?.rideProfile).toBe('tempo');
  });
});
