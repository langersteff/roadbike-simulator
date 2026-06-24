import type { UnitSystem } from '../types';

const LB_PER_KG = 2.205;
const KG_PER_LB = 0.4536;
const KM_PER_MI = 1.609;
const MI_PER_KM = 0.6214;
const M_PER_FT = 0.3048;
const FT_PER_M = 3.281;
const KJ_PER_KCAL = 4.184;
const KCAL_PER_KJ = 0.2388;
const IN_PER_CM = 0.3937;
const CM_PER_IN = 2.54;

export const isImperial = (units: UnitSystem): boolean => units === 'imperial';

export const weightDisplay = (kg: number, units: UnitSystem): number =>
  isImperial(units) ? kg * LB_PER_KG : kg;

export const weightToKg = (value: number, units: UnitSystem): number =>
  isImperial(units) ? value * KG_PER_LB : value;

export const distanceDisplay = (km: number, units: UnitSystem): number =>
  isImperial(units) ? km * MI_PER_KM : km;

export const distanceToKm = (value: number, units: UnitSystem): number =>
  isImperial(units) ? value * KM_PER_MI : value;

export const speedDisplay = (kph: number, units: UnitSystem): number =>
  isImperial(units) ? kph * MI_PER_KM : kph;

export const speedToKph = (value: number, units: UnitSystem): number =>
  isImperial(units) ? value * KM_PER_MI : value;

export const elevationDisplay = (m: number, units: UnitSystem): number =>
  isImperial(units) ? m * FT_PER_M : m;

export const elevationToM = (value: number, units: UnitSystem): number =>
  isImperial(units) ? value * M_PER_FT : value;

export const temperatureDisplay = (c: number, units: UnitSystem): number =>
  isImperial(units) ? c * 1.8 + 32 : c;

export const temperatureToC = (value: number, units: UnitSystem): number =>
  isImperial(units) ? (value - 32) * 5 / 9 : value;

export const energyDisplay = (kj: number, units: UnitSystem): number =>
  isImperial(units) ? kj * KCAL_PER_KJ : kj;

export const energyToKJ = (value: number, units: UnitSystem): number =>
  isImperial(units) ? value * KJ_PER_KCAL : value;

export const weightLossDisplay = (kg: number, units: UnitSystem): number =>
  isImperial(units) ? kg * LB_PER_KG : kg;

export const heightDisplay = (cm: number, units: UnitSystem): number =>
  isImperial(units) ? cm * IN_PER_CM : cm;

export const heightToCm = (value: number, units: UnitSystem): number =>
  isImperial(units) ? value * CM_PER_IN : value;

export const UNIT_LABELS = {
  weight: (u: UnitSystem) => (isImperial(u) ? 'lbs' : 'kg'),
  distance: (u: UnitSystem) => (isImperial(u) ? 'mi' : 'km'),
  speed: (u: UnitSystem) => (isImperial(u) ? 'mph' : 'km/h'),
  elevation: (u: UnitSystem) => (isImperial(u) ? 'ft' : 'm'),
  temperature: (u: UnitSystem) => (isImperial(u) ? '°F' : '°C'),
  energy: (u: UnitSystem) => (isImperial(u) ? 'kcal' : 'kJ'),
  weightLoss: (u: UnitSystem) => (isImperial(u) ? 'lbs' : 'kg'),
  height: (u: UnitSystem) => (isImperial(u) ? 'in' : 'cm'),
};
