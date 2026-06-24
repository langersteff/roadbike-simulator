import type { AppState, CalculatorInputs } from '../types';
import { readJson, writeJson } from './persist';

const STORAGE_KEY = 'bikecalc.v1';

const migrateTire = <T extends { tire?: string }>(item: T): T => {
  if (item.tire === 'tubular') return { ...item, tire: 'clincher' };
  return item;
};

export const loadState = (): AppState | null => {
  const parsed = readJson<AppState>(STORAGE_KEY);
  if (!parsed?.calculators?.length) return null;
  return {
    ...parsed,
    calculators: parsed.calculators.map((calc) => migrateTire(calc) as CalculatorInputs),
  };
};

export const saveState = (state: AppState): void => {
  writeJson(STORAGE_KEY, state);
};
