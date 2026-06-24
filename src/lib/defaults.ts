import type { CalculatorInputs } from '../types';

let counter = 0;
const nextId = (): string => `calc-${Date.now()}-${counter++}`;

export const buildDefaultInputs = (label: string): CalculatorInputs => ({
  id: nextId(),
  label,
  mode: 'power',
  power: 100,
  velocity: 0,
  riderWeight: 70,
  bikeWeight: 9,
  bodyHeightCm: 175,
  tire: 'clincher',
  position: 'hoods',
  grade: 0,
  headwind: 0,
  distance: 30,
  temperature: 25,
  elevation: 100,
});

export const cloneInputs = (source: CalculatorInputs, label: string): CalculatorInputs => ({
  ...source,
  id: nextId(),
  label,
});
