import { describe, it, expect } from 'vitest';
import {
  deriveFtpW,
  zoneForFraction,
  RIDE_PROFILES,
  ZONE_IDS,
  Z2_MID_FRACTION,
} from './zones';

describe('deriveFtpW', () => {
  it('treats baseline power as mid-Zone-2 (65% FTP)', () => {
    expect(deriveFtpW(200)).toBeCloseTo(200 / Z2_MID_FRACTION, 5);
    expect(Math.round(deriveFtpW(200))).toBe(308);
  });
});

describe('zoneForFraction', () => {
  it('maps fractions of FTP to the 5-zone bands', () => {
    expect(zoneForFraction(0.40)).toBe('Z1');
    expect(zoneForFraction(0.54)).toBe('Z1');
    expect(zoneForFraction(0.55)).toBe('Z2');
    expect(zoneForFraction(0.75)).toBe('Z2');
    expect(zoneForFraction(0.76)).toBe('Z3');
    expect(zoneForFraction(0.90)).toBe('Z3');
    expect(zoneForFraction(0.91)).toBe('Z4');
    expect(zoneForFraction(1.05)).toBe('Z4');
    expect(zoneForFraction(1.06)).toBe('Z5');
    expect(zoneForFraction(1.40)).toBe('Z5');
  });
});

describe('RIDE_PROFILES', () => {
  it('exposes cruise, ceiling and climb-rise for every profile id', () => {
    expect(ZONE_IDS).toEqual(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
    expect(RIDE_PROFILES.easyEndurance).toEqual({ cruiseFraction: 0.4, ceilingFraction: 0.90, climbRise: 0.015, label: 'Easy endurance' });
    expect(RIDE_PROFILES.endurance).toEqual({ cruiseFraction: 0.55, ceilingFraction: 0.90, climbRise: 0.045, label: 'Endurance' });
    expect(RIDE_PROFILES.tempo).toEqual({ cruiseFraction: 0.78, ceilingFraction: 1.05, climbRise: 0.045, label: 'Tempo' });
    expect(RIDE_PROFILES.hiit).toEqual({ cruiseFraction: 0.65, ceilingFraction: 1.20, climbRise: 0.045, label: 'High intensity' });
  });

  it('reaches Z3 at a steeper grade for easy endurance than endurance', () => {
    // Z3 begins at 76% FTP; climb demand = 0.62 + grade × climbRise.
    const z3Grade = (climbRise: number) => (0.76 - 0.62) / climbRise;
    expect(z3Grade(RIDE_PROFILES.easyEndurance.climbRise)).toBeGreaterThan(
      z3Grade(RIDE_PROFILES.endurance.climbRise),
    );
  });
});
