export type Tire = 'clincher' | 'gravel' | 'mtb';
export type Surface = 'asphalt' | 'compacted' | 'gravel' | 'cobbles';
export type Position = 'hoods' | 'bartops' | 'barends' | 'drops' | 'aerobar';
export type CalcMode = 'power' | 'velocity';

export interface CalculatorInputs {
  id: string;
  label: string;
  mode: CalcMode;
  power: number;
  velocity: number;
  riderWeight: number;
  bikeWeight: number;
  bodyHeightCm?: number;
  tire: Tire;
  surface?: Surface;
  position: Position;
  grade: number;
  headwind: number;
  crosswind?: number;
  distance: number;
  temperature: number;
  elevation: number;
  crrMultiplier?: number;
}

export interface CalculatorOutputs {
  velocityKph: number;
  powerW: number;
  timeMin: number;
  energyKJ: number;
  weightLossKg: number;
}

export interface AppState {
  calculators: CalculatorInputs[];
}
