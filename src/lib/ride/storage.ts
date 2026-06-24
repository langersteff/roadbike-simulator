import type { RideSimulatorState } from './types';
import { readJson, removeKey } from '../persist';

const STORAGE_KEY = 'bikecalc.rideSimulator.v2';
const LEGACY_STORAGE_KEYS = ['bikecalc.rideSimulator.v1'];
const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;

export interface SaveOutcome {
  saved: boolean;
  reason?: 'quota' | 'too-large' | 'unavailable';
}

function isValidState(value: unknown): value is RideSimulatorState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RideSimulatorState;
  if (!('split' in candidate) || !('chunks' in candidate)) return false;
  if (typeof (candidate.split as { grade?: unknown }).grade !== 'boolean') return false;
  if (typeof (candidate.split as { maxSectionKm?: unknown }).maxSectionKm !== 'number') return false;
  if (!Array.isArray(candidate.chunks)) return false;
  if (candidate.chunks.length > 0 && typeof candidate.chunks[0].effectiveGradePct !== 'number') {
    return false;
  }
  return true;
}

export function loadRideState(): RideSimulatorState | null {
  LEGACY_STORAGE_KEYS.forEach(removeKey);
  const parsed = readJson<unknown>(STORAGE_KEY);
  if (parsed === null) return null;
  if (!isValidState(parsed)) {
    removeKey(STORAGE_KEY);
    return null;
  }
  return migrateLegacyTire(parsed);
}

function migrateLegacyTire(state: RideSimulatorState): RideSimulatorState {
  const profileTire = state.profile.tire as string;
  const profile = profileTire === 'tubular' ? { ...state.profile, tire: 'clincher' as const } : state.profile;
  return { ...state, profile };
}

export function saveRideState(state: RideSimulatorState): SaveOutcome {
  let payload: string;
  try {
    payload = JSON.stringify(state);
  } catch {
    return { saved: false, reason: 'unavailable' };
  }
  if (payload.length > MAX_SERIALIZED_BYTES) {
    return { saved: false, reason: 'too-large' };
  }
  try {
    localStorage.setItem(STORAGE_KEY, payload);
    return { saved: true };
  } catch {
    return { saved: false, reason: 'quota' };
  }
}

export function clearRideState(): void {
  removeKey(STORAGE_KEY);
}
