import { describe, it, expect } from 'vitest';
import type { CalculatorInputs } from '../types';
import { computeOutputs, frontalAreaScale, cappedVelocityKph, airDensity } from './calc';
import type { Tire, Surface } from '../types';
import {
  DESCENT_MAX_KPH,
  CDA_REF_WEIGHT_KG,
  CDA_REF_HEIGHT_CM,
  SURFACE_CRR,
  SURFACE_LABELS,
  TIRE_LABELS,
} from './constants';

const TIRES: Tire[] = ['clincher', 'gravel', 'mtb'];
const SURFACES: Surface[] = ['asphalt', 'compacted', 'gravel', 'cobbles'];

const baseInputs = (overrides: Partial<CalculatorInputs> = {}): CalculatorInputs => ({
  id: 'test',
  label: 'test',
  mode: 'power',
  power: 200,
  velocity: 0,
  riderWeight: 75,
  bikeWeight: 9,
  bodyHeightCm: 175,
  tire: 'clincher',
  position: 'hoods',
  grade: 0,
  headwind: 0,
  distance: 10,
  temperature: 15,
  elevation: 0,
  ...overrides,
});

describe('computeOutputs solver', () => {
  it('round-trips power -> velocity -> power', () => {
    const forward = computeOutputs(baseInputs({ mode: 'power', power: 220 }));
    const back = computeOutputs(
      baseInputs({ mode: 'velocity', velocity: forward.velocityKph }),
    );
    expect(back.powerW).toBeCloseTo(220, 0);
  });

  it('is slower into a headwind', () => {
    const calm = computeOutputs(baseInputs({ headwind: 0 }));
    const windy = computeOutputs(baseInputs({ headwind: 20 }));
    expect(windy.velocityKph).toBeLessThan(calm.velocityKph);
  });

  it('is slower as the gradient steepens', () => {
    const flat = computeOutputs(baseInputs({ grade: 0 }));
    const gentle = computeOutputs(baseInputs({ grade: 5 }));
    const steep = computeOutputs(baseInputs({ grade: 10 }));
    expect(gentle.velocityKph).toBeLessThan(flat.velocityKph);
    expect(steep.velocityKph).toBeLessThan(gentle.velocityKph);
  });
});

describe('airDensity (ISA + ideal gas)', () => {
  it('matches the ISA sea-level standard at 15 °C', () => {
    expect(airDensity(15, 0)).toBeCloseTo(1.225, 2);
  });

  it('matches the textbook dry-air density at 0 °C, sea level', () => {
    expect(airDensity(0, 0)).toBeCloseTo(1.292, 2);
  });

  it('falls with altitude and with temperature', () => {
    expect(airDensity(15, 2000)).toBeLessThan(airDensity(15, 0));
    expect(airDensity(30, 0)).toBeLessThan(airDensity(0, 0));
  });
});

describe('published-benchmark sanity', () => {
  it('puts a 75 kg rider at ~250 W on the flat in a realistic 34–40 km/h range', () => {
    const { velocityKph } = computeOutputs(
      baseInputs({ power: 250, position: 'drops', grade: 0, headwind: 0 }),
    );
    expect(velocityKph).toBeGreaterThan(34);
    expect(velocityKph).toBeLessThan(40);
  });

  it('gets faster on the aerobars than on the hoods at equal power', () => {
    const hoods = computeOutputs(baseInputs({ position: 'hoods' }));
    const aerobar = computeOutputs(baseInputs({ position: 'aerobar' }));
    expect(aerobar.velocityKph).toBeGreaterThan(hoods.velocityKph);
  });
});

describe('tire × surface rolling resistance', () => {
  it('defines a positive Crr for every tire/surface pair and a label per tire/surface', () => {
    for (const tire of TIRES) {
      expect(TIRE_LABELS[tire]).toBeTruthy();
      for (const surface of SURFACES) {
        expect(SURFACE_CRR[tire][surface]).toBeGreaterThan(0);
      }
    }
    for (const surface of SURFACES) {
      expect(SURFACE_LABELS[surface]).toBeTruthy();
    }
  });

  it('rises monotonically from asphalt to cobbles for each tire', () => {
    for (const tire of TIRES) {
      const crr = SURFACE_CRR[tire];
      expect(crr.asphalt).toBeLessThanOrEqual(crr.compacted);
      expect(crr.compacted).toBeLessThanOrEqual(crr.gravel);
      expect(crr.gravel).toBeLessThanOrEqual(crr.cobbles);
    }
  });

  it('rolls slower from road to gravel to MTB on asphalt', () => {
    const road = computeOutputs(baseInputs({ tire: 'clincher' }));
    const gravel = computeOutputs(baseInputs({ tire: 'gravel' }));
    const mtb = computeOutputs(baseInputs({ tire: 'mtb' }));
    expect(gravel.velocityKph).toBeLessThan(road.velocityKph);
    expect(mtb.velocityKph).toBeLessThan(gravel.velocityKph);
  });

  it('inverts off-pavement: the clincher beats the MTB on asphalt but loses on gravel', () => {
    const clincherAsphalt = computeOutputs(baseInputs({ tire: 'clincher', surface: 'asphalt' }));
    const mtbAsphalt = computeOutputs(baseInputs({ tire: 'mtb', surface: 'asphalt' }));
    expect(clincherAsphalt.velocityKph).toBeGreaterThan(mtbAsphalt.velocityKph);

    const clincherGravel = computeOutputs(baseInputs({ tire: 'clincher', surface: 'gravel' }));
    const mtbGravel = computeOutputs(baseInputs({ tire: 'mtb', surface: 'gravel' }));
    expect(clincherGravel.velocityKph).toBeLessThan(mtbGravel.velocityKph);
  });

  it('treats a missing surface as asphalt', () => {
    const implicit = computeOutputs(baseInputs({ tire: 'gravel' }));
    const explicit = computeOutputs(baseInputs({ tire: 'gravel', surface: 'asphalt' }));
    expect(implicit.velocityKph).toBeCloseTo(explicit.velocityKph, 10);
  });
});

describe('frontalAreaScale', () => {
  it('is 1.0 for the reference rider', () => {
    expect(frontalAreaScale(CDA_REF_WEIGHT_KG, CDA_REF_HEIGHT_CM)).toBeCloseTo(1, 5);
  });

  it('grows for a bigger rider and shrinks for a smaller one', () => {
    expect(frontalAreaScale(90, 188)).toBeGreaterThan(1);
    expect(frontalAreaScale(60, 165)).toBeLessThan(1);
  });

  it('defaults missing height to the reference height', () => {
    expect(frontalAreaScale(CDA_REF_WEIGHT_KG)).toBeCloseTo(1, 5);
  });

  it('makes a taller rider slower at equal weight and power (CdA only)', () => {
    const shortRider = computeOutputs(baseInputs({ bodyHeightCm: 165 }));
    const tallRider = computeOutputs(baseInputs({ bodyHeightCm: 195 }));
    expect(tallRider.velocityKph).toBeLessThan(shortRider.velocityKph);
  });
});

describe('cappedVelocityKph', () => {
  it('leaves a moderate speed on a straight road untouched', () => {
    expect(cappedVelocityKph(45, Infinity)).toBe(45);
  });

  it('applies the absolute descent ceiling', () => {
    expect(cappedVelocityKph(120, Infinity)).toBe(DESCENT_MAX_KPH);
  });

  it('applies the cornering limit on a tight bend', () => {
    const tight = cappedVelocityKph(90, 20);
    expect(tight).toBeLessThan(90);
    expect(tight).toBeCloseTo(Math.sqrt(4 * 20) * 3.6, 5);
  });
});
