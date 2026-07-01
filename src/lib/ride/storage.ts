import type { RideSimulatorState, RiderProfile } from './types';
import { readJson, removeKey } from '../persist';

const STORAGE_KEY = 'bikecalc.rideSimulator.v3';
const LEGACY_STORAGE_KEYS = ['bikecalc.rideSimulator.v1', 'bikecalc.rideSimulator.v2'];
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
  const legacyRaw = LEGACY_STORAGE_KEYS.map((key) => readJson<unknown>(key)).find(Boolean) ?? null;
  LEGACY_STORAGE_KEYS.forEach(removeKey);
  const parsed = readJson<unknown>(STORAGE_KEY) ?? legacyRaw;
  if (parsed === null) return null;
  if (!isValidState(parsed)) {
    removeKey(STORAGE_KEY);
    return null;
  }
  return migrateLegacyState(parsed as RideSimulatorState);
}

function migrateLegacyState(state: RideSimulatorState): RideSimulatorState {
  const rawProfile = state.profile as RiderProfile & { defaultPower?: number };
  const baselinePower = rawProfile.baselinePower ?? rawProfile.defaultPower ?? 200;
  const tire = (rawProfile.tire as string) === 'tubular' ? 'clincher' : rawProfile.tire;
  const { defaultPower: _legacyPower, ...rest } = rawProfile;
  return { ...state, profile: { ...rest, tire, baselinePower } };
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
