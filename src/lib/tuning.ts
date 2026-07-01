import { readJson, writeJson } from './persist';
import { RIDE_PROFILES, type RideProfileId } from './ride/zones';

/**
 * Live-tunable knobs for aerobar/chunking detection. These are read at compute time via
 * getTuning(), so the tuning popup can change them and a re-split picks them up immediately.
 * Defaults equal the previously-hardcoded constants, so behaviour is unchanged until edited.
 */
export interface TuningConfig {
  /** Curvy detection threshold. Sinuosity = arc/chord over a window; ~1.0 on a straight road.
   *  Lower = flags curvy sooner = aerobars offered less often (more conservative). */
  curvySinuosity: number;
  /** Multiplier applied to every OSM place radius. >1 widens the no-aero buffer around towns. */
  urbanRadiusScale: number;
  /** Minimum chunk length (km) for aerobars — too-short sections never go aero. */
  aeroMinLengthKm: number;
  /** Lowest grade (%) still allowed for aerobars (steeper descents fall back). */
  aeroMinGradePct: number;
  /** Highest grade (%) still allowed for aerobars (steeper climbs fall back). */
  aeroMaxGradePct: number;
  /** Crosswind (m/s) above which aerobars are unsafe and disabled. */
  aeroMaxCrosswindMs: number;
  /** Flat-ground effort as a fraction of FTP for each ride profile; grade and wind scale it up. */
  easyEnduranceCruise: number;
  enduranceCruise: number;
  tempoCruise: number;
  hiitCruise: number;
  /** How sharply a climb raises effort per ride profile: FTP-fraction added per 1% of grade.
   *  Lower = zones jump at steeper grades (Z3 arrives later). */
  easyEnduranceClimbRise: number;
  enduranceClimbRise: number;
  tempoClimbRise: number;
  hiitClimbRise: number;
}

export const DEFAULT_TUNING: TuningConfig = {
  curvySinuosity: 1.15,
  urbanRadiusScale: 1.0,
  aeroMinLengthKm: 0.5,
  aeroMinGradePct: -2,
  aeroMaxGradePct: 3,
  aeroMaxCrosswindMs: 9,
  easyEnduranceCruise: RIDE_PROFILES.easyEndurance.cruiseFraction,
  enduranceCruise: RIDE_PROFILES.endurance.cruiseFraction,
  tempoCruise: RIDE_PROFILES.tempo.cruiseFraction,
  hiitCruise: RIDE_PROFILES.hiit.cruiseFraction,
  easyEnduranceClimbRise: RIDE_PROFILES.easyEndurance.climbRise,
  enduranceClimbRise: RIDE_PROFILES.endurance.climbRise,
  tempoClimbRise: RIDE_PROFILES.tempo.climbRise,
  hiitClimbRise: RIDE_PROFILES.hiit.climbRise,
};

export interface TuningKnob {
  key: keyof TuningConfig;
  label: string;
  group: 'Detection' | 'Aerobar gate' | 'Ride effort';
  /** When set, the knob only shows while this ride profile is selected. */
  profile?: RideProfileId;
  min: number;
  max: number;
  step: number;
  help: string;
  /** Optional mapping between the stored value and the slider value, e.g. a sinuosity threshold
   *  presented as a 0–100 % sensitivity. min/max/step describe the slider (display) range. */
  toDisplay?: (stored: number) => number;
  fromDisplay?: (display: number) => number;
}

// Curvy sensitivity is shown 0–100 % but stored as a sinuosity threshold: higher sensitivity =
// lower threshold = more curvy. These endpoints define what the percentage maps onto.
const CURVY_THRESHOLD_MIN = 1.02;
const CURVY_THRESHOLD_MAX = 1.5;
const curvyThresholdToPct = (threshold: number) =>
  Math.round(((CURVY_THRESHOLD_MAX - threshold) / (CURVY_THRESHOLD_MAX - CURVY_THRESHOLD_MIN)) * 100);
const curvyPctToThreshold = (pct: number) =>
  CURVY_THRESHOLD_MAX - (pct / 100) * (CURVY_THRESHOLD_MAX - CURVY_THRESHOLD_MIN);

/** Slider metadata for the tuning popup: a sensible range and step per knob. */
export const TUNING_KNOBS: TuningKnob[] = [
  { key: 'curvySinuosity', label: 'Curvy sensitivity (%)', group: 'Detection', min: 0, max: 100, step: 1,
    help: 'Higher = flags curvy sooner = more curvy sections (fewer aero).',
    toDisplay: curvyThresholdToPct, fromDisplay: curvyPctToThreshold },
  { key: 'urbanRadiusScale', label: 'Urban radius ×', group: 'Detection', min: 0.5, max: 3, step: 0.1,
    help: 'Scales the no-aero buffer around settlements.' },
  { key: 'aeroMinLengthKm', label: 'Min length (km)', group: 'Aerobar gate', min: 0.2, max: 3, step: 0.1,
    help: 'Shortest section allowed to go aero.' },
  { key: 'aeroMinGradePct', label: 'Min grade (%)', group: 'Aerobar gate', min: -6, max: 0, step: 0.5,
    help: 'Steepest descent still allowed for aero.' },
  { key: 'aeroMaxGradePct', label: 'Max grade (%)', group: 'Aerobar gate', min: 0, max: 8, step: 0.5,
    help: 'Steepest climb still allowed for aero.' },
  { key: 'aeroMaxCrosswindMs', label: 'Max crosswind (m/s)', group: 'Aerobar gate', min: 3, max: 15, step: 0.5,
    help: 'Crosswind above this disables aero.' },
  ...(['easyEndurance', 'endurance', 'tempo', 'hiit'] as RideProfileId[]).flatMap((profile): TuningKnob[] => [
    { key: `${profile}Cruise` as keyof TuningConfig, label: 'Cruise Effort (% FTP)', group: 'Ride effort', profile,
      min: 30, max: 100, step: 1,
      help: 'Flat-ground effort for this profile. Higher = climbs reach Z3 sooner.',
      toDisplay: (fraction) => Math.round(fraction * 100), fromDisplay: (pct) => pct / 100 },
    { key: `${profile}ClimbRise` as keyof TuningConfig, label: 'Climb Rise (% FTP per 1% grade)', group: 'Ride effort', profile,
      min: 0.5, max: 10, step: 0.05,
      help: 'How sharply climbs raise the zone. Lower = the jump to Z3 needs a steeper grade.',
      toDisplay: (fraction) => Math.round(fraction * 10000) / 100, fromDisplay: (perPct) => perPct / 100 },
  ]),
];

const STORAGE_KEY = 'bikecalc.tuning.v1';

function clampToKnobs(config: TuningConfig): TuningConfig {
  const clamped = { ...config };
  for (const knob of TUNING_KNOBS) {
    const value = clamped[knob.key];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      clamped[knob.key] = DEFAULT_TUNING[knob.key];
      continue;
    }
    // Clamp in stored space — for transformed knobs the slider min/max are display units.
    const boundA = knob.fromDisplay ? knob.fromDisplay(knob.min) : knob.min;
    const boundB = knob.fromDisplay ? knob.fromDisplay(knob.max) : knob.max;
    clamped[knob.key] = Math.min(Math.max(boundA, boundB), Math.max(Math.min(boundA, boundB), value));
  }
  return clamped;
}

export function loadTuning(): TuningConfig {
  const stored = readJson<Partial<TuningConfig>>(STORAGE_KEY);
  return clampToKnobs({ ...DEFAULT_TUNING, ...(stored ?? {}) });
}

let active: TuningConfig = loadTuning();

export function getTuning(): TuningConfig {
  return active;
}

export function setTuning(next: TuningConfig): TuningConfig {
  active = clampToKnobs(next);
  writeJson(STORAGE_KEY, active);
  return active;
}

export function resetTuning(): TuningConfig {
  return setTuning({ ...DEFAULT_TUNING });
}
