# Ride Load Estimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimate an intervals.icu-style ride training load (TSS) by guessing a training zone per chunk, anchored to an FTP derived from the rider's Baseline Power and bounded by a selectable ride profile.

**Architecture:** A pure `zones.ts` module defines the 5-zone %FTP model, FTP derivation, and per-profile effort bounds. `simulate.ts` replaces its fixed ×1.10 climb-power cap with a profile-driven effort ceiling that feeds both speed and load. A pure `load.ts` module rolls the resulting per-chunk power into NP/IF/TSS and a time-in-zone breakdown. UI adds a ride-profile picker, an FTP note, and a Ride Load card.

**Tech Stack:** TypeScript, React, Vitest. Pure functions in `src/lib/ride/`, components in `src/components/ride/`.

## Global Constraints

- No comments that restate the code; comment only the "why". (user CLAUDE.md)
- Import at the top of the file; never use inline package paths. (user CLAUDE.md)
- DTOs stay immutable and free of transient/auxiliary fields. (user CLAUDE.md) — do **not** add fields to the `Chunk` interface; recompute what load needs.
- No hardcoded magic values in components; use named constants. (user CLAUDE.md)
- Zone bands (fraction of FTP): Z1 `<0.55`, Z2 `0.55–<0.76`, Z3 `0.76–<0.91`, Z4 `0.91–<1.06`, Z5 `≥1.06`.
- FTP anchor: Baseline Power = mid-Zone-2 = 65% FTP → `FTP = baseline / 0.65`.
- Ride profiles (cruise fraction on flat / ceiling fraction on climb): endurance `0.65 / 0.90`, tempo `0.78 / 1.05`, hiit `0.65 / 1.20`.
- TSS uses **moving seconds only** — exclude urban stop-dwell time from the denominator.
- Power-only this iteration. No HR inputs, no hrTSS.
- Test commands: `npx vitest run <file>` (single file), `npx vitest run` (all).

---

### Task 1: Zone model, FTP derivation, ride-profile bounds

**Files:**
- Create: `src/lib/ride/zones.ts`
- Test: `src/lib/ride/zones.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports from project code).
- Produces:
  - `type ZoneId = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5'`
  - `type RideProfileId = 'endurance' | 'tempo' | 'hiit'`
  - `const Z2_MID_FRACTION = 0.65`
  - `function deriveFtpW(baselinePowerW: number): number`
  - `function zoneForFraction(fractionOfFtp: number): ZoneId`
  - `const ZONE_IDS: ZoneId[]`
  - `interface RideProfileSpec { cruiseFraction: number; ceilingFraction: number; label: string }`
  - `const RIDE_PROFILES: Record<RideProfileId, RideProfileSpec>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ride/zones.test.ts
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
  it('exposes cruise and ceiling fractions for every profile id', () => {
    expect(ZONE_IDS).toEqual(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
    expect(RIDE_PROFILES.endurance).toEqual({ cruiseFraction: 0.65, ceilingFraction: 0.90, label: 'Endurance' });
    expect(RIDE_PROFILES.tempo).toEqual({ cruiseFraction: 0.78, ceilingFraction: 1.05, label: 'Tempo' });
    expect(RIDE_PROFILES.hiit).toEqual({ cruiseFraction: 0.65, ceilingFraction: 1.20, label: 'High intensity' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ride/zones.test.ts`
Expected: FAIL — cannot resolve `./zones`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/ride/zones.ts
export type ZoneId = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
export type RideProfileId = 'endurance' | 'tempo' | 'hiit';

export const ZONE_IDS: ZoneId[] = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

// Baseline Power is entered as the rider's mid-Zone-2 effort, which sits at ~65% of FTP,
// so FTP is the baseline scaled back up by that fraction.
export const Z2_MID_FRACTION = 0.65;

export function deriveFtpW(baselinePowerW: number): number {
  return baselinePowerW / Z2_MID_FRACTION;
}

// Upper bounds (exclusive) of each zone as a fraction of FTP; Z5 is open-ended.
const ZONE_UPPER_BOUNDS: Array<{ id: ZoneId; below: number }> = [
  { id: 'Z1', below: 0.55 },
  { id: 'Z2', below: 0.76 },
  { id: 'Z3', below: 0.91 },
  { id: 'Z4', below: 1.06 },
];

export function zoneForFraction(fractionOfFtp: number): ZoneId {
  const match = ZONE_UPPER_BOUNDS.find((zone) => fractionOfFtp < zone.below);
  return match ? match.id : 'Z5';
}

export interface RideProfileSpec {
  cruiseFraction: number;
  ceilingFraction: number;
  label: string;
}

// cruiseFraction: effort on flat ground as a fraction of FTP (scaled by grade below).
// ceilingFraction: hardest sustained climb effort the profile allows.
export const RIDE_PROFILES: Record<RideProfileId, RideProfileSpec> = {
  endurance: { cruiseFraction: 0.65, ceilingFraction: 0.90, label: 'Endurance' },
  tempo: { cruiseFraction: 0.78, ceilingFraction: 1.05, label: 'Tempo' },
  hiit: { cruiseFraction: 0.65, ceilingFraction: 1.20, label: 'High intensity' },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ride/zones.test.ts`
Expected: PASS (3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ride/zones.ts src/lib/ride/zones.test.ts
git commit -m "Add zone model, FTP derivation and ride-profile bounds"
```

---

### Task 2: Rename Baseline Power, add rideProfile state, storage migration

**Files:**
- Modify: `src/lib/ride/types.ts:14` (rename field), `src/lib/ride/types.ts:57-70` (add `rideProfile`)
- Modify: `src/lib/ride/storage.ts:4-5` (key bump), `src/lib/ride/storage.ts:37-41` (migration)
- Modify: `src/views/RideSimulator.tsx:58` and `:104-133` (default profile + initial state)
- Modify: `src/components/ride/RiderProfileForm.tsx:67-69`
- Modify: `src/components/ride/ChunkPopup.tsx:44`
- Modify: `src/components/ride/ChunkRow.tsx:140`
- Modify: `src/lib/ride/simulate.ts:403-404,438` (rename field reads)
- Modify: `src/lib/ride/simulate.test.ts:17,99` (rename in fixtures)
- Test: `src/lib/ride/storage.test.ts` (create)

**Interfaces:**
- Consumes: `RideProfileId` from Task 1 (`./zones`).
- Produces:
  - `RiderProfile.baselinePower: number` (was `defaultPower`)
  - `RideSimulatorState.rideProfile?: RideProfileId`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ride/storage.test.ts
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
    expect((loaded?.profile as Record<string, unknown>).defaultPower).toBeUndefined();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ride/storage.test.ts`
Expected: FAIL — v2 profile still has `defaultPower`, no migration.

- [ ] **Step 3: Rename the field in the type and add the state field**

In `src/lib/ride/types.ts` add the import at the top and edit the two interfaces:

```typescript
import type { RideProfileId } from './zones';
```

```typescript
export interface RiderProfile {
  riderWeight: number;
  bikeWeight: number;
  bodyHeightCm: number;
  tire: Tire;
  baselinePower: number;
  defaultPosition: Position;
}
```

Add to `RideSimulatorState` (after `heatEffect?`):

```typescript
  rideProfile?: RideProfileId;
```

- [ ] **Step 4: Update storage key and migration**

In `src/lib/ride/storage.ts`:

```typescript
const STORAGE_KEY = 'bikecalc.rideSimulator.v3';
const LEGACY_STORAGE_KEYS = ['bikecalc.rideSimulator.v1', 'bikecalc.rideSimulator.v2'];
```

Replace `migrateLegacyTire` with a combined migration (keep the tire logic, add the power rename). Note: legacy keys are removed at the top of `loadRideState`; the v2 payload is read from `STORAGE_KEY` only if a user's browser already advanced — to be safe, migrate the field regardless of which key produced the object:

```typescript
function migrateLegacyState(state: RideSimulatorState): RideSimulatorState {
  const rawProfile = state.profile as RiderProfile & { defaultPower?: number };
  const baselinePower = rawProfile.baselinePower ?? rawProfile.defaultPower ?? 200;
  const tire = (rawProfile.tire as string) === 'tubular' ? 'clincher' : rawProfile.tire;
  const { defaultPower: _legacyPower, ...rest } = rawProfile;
  return { ...state, profile: { ...rest, tire, baselinePower } };
}
```

Update `loadRideState` to call `migrateLegacyState(parsed)` instead of `migrateLegacyTire`, and read the legacy v2 payload before removing it. Since `LEGACY_STORAGE_KEYS.forEach(removeKey)` runs first and would delete v2 before it is read, adjust `loadRideState`:

```typescript
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
```

Add the `RiderProfile` import to `storage.ts` if not present:

```typescript
import type { RideSimulatorState, RiderProfile } from './types';
```

- [ ] **Step 5: Rename every remaining `defaultPower` read**

Apply these exact edits:

- `src/views/RideSimulator.tsx:58` — `defaultPower: 200,` → `baselinePower: 200,`
- `src/components/ride/RiderProfileForm.tsx:67-69`:
  ```tsx
        value={profile.baselinePower}
        decimals={0}
        onChange={(power) => patch({ baselinePower: power })}
  ```
  (label text is changed in Task 5)
- `src/components/ride/ChunkPopup.tsx:44` — `profile.defaultPower` → `profile.baselinePower`
- `src/components/ride/ChunkRow.tsx:140` — `profile.defaultPower` → `profile.baselinePower`
- `src/lib/ride/simulate.ts` lines 403, 404, 438 — `params.profile.defaultPower` → `params.profile.baselinePower` (all three occurrences)
- `src/lib/ride/simulate.test.ts:17` — `defaultPower: 200,` → `baselinePower: 200,`
- `src/lib/ride/simulate.test.ts:99` — `PROFILE.defaultPower` → `PROFILE.baselinePower`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/ride/storage.test.ts src/lib/ride/simulate.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — Expected: no errors (all `defaultPower` reads gone).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ride/types.ts src/lib/ride/storage.ts src/lib/ride/storage.test.ts \
  src/views/RideSimulator.tsx src/components/ride/RiderProfileForm.tsx \
  src/components/ride/ChunkPopup.tsx src/components/ride/ChunkRow.tsx \
  src/lib/ride/simulate.ts src/lib/ride/simulate.test.ts
git commit -m "Rename default power to baseline power and add ride-profile state with v3 migration"
```

---

### Task 3: Profile-driven effort model in simulate.ts

**Files:**
- Modify: `src/lib/ride/simulate.ts` (remove cap, thread `rideProfile`, effort math)
- Modify: `src/lib/ride/simulate.test.ts` (helper default + new tests)
- Modify: `src/views/RideSimulator.tsx` (pass `rideProfile` at all `simulate`/`evaluateChunk` call sites)

**Interfaces:**
- Consumes: `RIDE_PROFILES`, `deriveFtpW`, `RideProfileId` from `./zones`.
- Produces:
  - `evaluateChunk` and `simulate` options gain `rideProfile: RideProfileId` (required).
  - `powerFactorForGrade` no longer caps uphill (still floors downhill at 0).
  - `export function urbanStopPenaltyMin(lengthKm: number): number` (now exported for Task 4).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ride/simulate.test.ts`. Note the existing `evaluate()` helper passes `keepPowerSteady: true`; these tests override it to `false` so the effort model runs, and add `rideProfile`:

```typescript
import { RIDE_PROFILES, deriveFtpW } from './zones';

describe('profile-driven effort model', () => {
  // 8% climb, 1 km segments — steep enough to hit each profile ceiling.
  const climb = straightRoute([0, 80], 1);

  it('endurance flat effort equals baseline power', () => {
    const flat = straightRoute([100, 100], 1);
    const chunk = evaluate(flat, { keepPowerSteady: false, rideProfile: 'endurance' });
    expect(chunk.effectivePower).toBeCloseTo(200, 0);
  });

  it('endurance clamps a steep climb to the Z3 ceiling (90% FTP)', () => {
    const chunk = evaluate(climb, { keepPowerSteady: false, rideProfile: 'endurance' });
    const ceilingW = deriveFtpW(200) * RIDE_PROFILES.endurance.ceilingFraction;
    expect(chunk.effectivePower).toBeCloseTo(ceilingW, 0);
  });

  it('high intensity allows more climb power than endurance', () => {
    const enduranceChunk = evaluate(climb, { keepPowerSteady: false, rideProfile: 'endurance' });
    const hiitChunk = evaluate(climb, { keepPowerSteady: false, rideProfile: 'hiit' });
    expect(hiitChunk.effectivePower).toBeGreaterThan(enduranceChunk.effectivePower);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ride/simulate.test.ts`
Expected: FAIL — `evaluate` does not accept `rideProfile`; `evaluateChunk` has no `rideProfile`.

- [ ] **Step 3: Remove the fixed cap from `powerFactorForGrade`**

In `src/lib/ride/simulate.ts` delete the `POWER_MAX_FACTOR` constant (line 46) and change the function (lines 96-101) to:

```typescript
export function powerFactorForGrade(gradePct: number): number {
  if (gradePct >= 0) {
    return 1 + gradePct * POWER_UPHILL_PER_PERCENT;
  }
  return Math.max(POWER_MIN_FACTOR, 1 + gradePct * POWER_DOWNHILL_PER_PERCENT);
}
```

- [ ] **Step 4: Add `rideProfile` to the physics params and apply the effort ceiling**

Add the import at the top of `simulate.ts`:

```typescript
import { RIDE_PROFILES, deriveFtpW, type RideProfileId } from './zones';
```

Add `rideProfile` to `ChunkPhysicsParams` (after `heatEffect`):

```typescript
  rideProfile: RideProfileId;
```

Replace the power assignment inside `integrateChunkPhysics` (lines ~399-404) with:

```typescript
    const ftpW = deriveFtpW(params.profile.baselinePower);
    const spec = RIDE_PROFILES[params.rideProfile];
    const effortFraction = Math.min(
      spec.cruiseFraction * powerFactorForGrade(grade),
      spec.ceilingFraction,
    );
    const power =
      heatFactor *
      (params.powerOverride ??
        (params.keepPowerSteady
          ? params.profile.baselinePower
          : ftpW * effortFraction));
```

`ftpW`/`spec` are recomputed per segment; that is fine and keeps the loop self-contained. If a reviewer objects, hoist both above the `for` loop — they do not depend on the segment.

- [ ] **Step 5: Export the urban penalty and thread `rideProfile` through options**

In `simulate.ts`:
- Change `function urbanStopPenaltyMin` (line ~443) to `export function urbanStopPenaltyMin`.
- Add `rideProfile: RideProfileId;` to `BuildChunkOptions` and to `SimulateOptions`.
- In `evaluateChunk`, destructure `rideProfile` from options and pass it into the `integrateChunkPhysics({ ... })` params object.
- In `simulate`, destructure `rideProfile` and pass it into each `evaluateChunk({ ... })` call.

- [ ] **Step 6: Update the test helper and all app call sites**

In `src/lib/ride/simulate.test.ts`, add `rideProfile: 'endurance'` to the defaults object inside the `evaluate()` helper (alongside `keepPowerSteady`).

In `src/views/RideSimulator.tsx`, at every `evaluateChunk({...})` and `simulate({...})` call (the seed at ~262, `finalChunks` at ~303, the dedupe re-sim at ~328, and `reSimulate` at ~366), add:

```typescript
            rideProfile: state.rideProfile ?? 'endurance',
```

Add `state.rideProfile` to the dependency arrays of the two `useCallback`s at lines ~357 and ~383.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/ride/simulate.test.ts`
Expected: PASS, including the three new effort tests. If any pre-existing test that used `keepPowerSteady: false` on a graded route now asserts an old capped speed/power, update its expected value to the new effort-model result and note the change in the commit body.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ride/simulate.ts src/lib/ride/simulate.test.ts src/views/RideSimulator.tsx
git commit -m "Replace fixed climb-power cap with ride-profile effort ceiling"
```

---

### Task 4: Load computation module

**Files:**
- Create: `src/lib/ride/load.ts`
- Test: `src/lib/ride/load.test.ts`

**Interfaces:**
- Consumes: `Chunk` from `./types`; `zoneForFraction`, `ZoneId`, `ZONE_IDS` from `./zones`; `urbanStopPenaltyMin` from `./simulate`.
- Produces:
  - `interface LoadSummary { ftpW: number; npW: number; intensityFactor: number; tss: number; movingSeconds: number; zoneMinutes: Record<ZoneId, number> }`
  - `function computeLoadSummary(chunks: Chunk[], ftpW: number): LoadSummary`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ride/load.test.ts
import { describe, it, expect } from 'vitest';
import { computeLoadSummary } from './load';
import type { Chunk } from './types';

function chunk(partial: Partial<Chunk>): Chunk {
  return {
    index: 0, startIndex: 0, endIndex: 1, startKm: 0, endKm: 1, lengthKm: 1,
    avgBearingDeg: 0, bearingVarianceDeg: 0, avgGradePct: 0, avgElevationM: 0,
    positionAuto: 'hoods', surfaceAuto: 'asphalt', urban: false, curvy: false,
    weather: null, overrides: {}, effectivePower: 200, effectivePosition: 'hoods',
    effectiveHeadwindKph: 0, effectiveTemperatureC: 15, effectivePrecipitationMmH: 0,
    effectiveSurface: 'asphalt', effectiveGradePct: 0, effectiveVelocityKph: 30,
    durationMin: 60, etaFromStartMin: 0, ...partial,
  };
}

describe('computeLoadSummary', () => {
  it('computes IF and TSS for one hour at threshold power', () => {
    const summary = computeLoadSummary([chunk({ effectivePower: 300, durationMin: 60 })], 300);
    expect(summary.ftpW).toBe(300);
    expect(summary.npW).toBeCloseTo(300, 5);
    expect(summary.intensityFactor).toBeCloseTo(1.0, 5);
    expect(summary.tss).toBeCloseTo(100, 1);
    expect(summary.movingSeconds).toBe(3600);
  });

  it('excludes urban stop-dwell time from moving seconds', () => {
    const urbanChunk = chunk({ urban: true, lengthKm: 10, durationMin: 60, effectivePower: 300 });
    const summary = computeLoadSummary([urbanChunk], 300);
    // URBAN_STOPS_PER_KM 1.2 × 10 km × (12+6)s/60 = 36 min of dwell removed.
    expect(summary.movingSeconds).toBeCloseTo((60 - 36) * 60, 1);
  });

  it('accumulates minutes into the correct zones', () => {
    const summary = computeLoadSummary(
      [
        chunk({ effectivePower: 150, durationMin: 30 }), // 0.5 FTP -> Z1
        chunk({ effectivePower: 200, durationMin: 20 }), // 0.667 FTP -> Z2
        chunk({ effectivePower: 260, durationMin: 10 }), // 0.867 FTP -> Z3
      ],
      300,
    );
    expect(summary.zoneMinutes.Z1).toBeCloseTo(30, 5);
    expect(summary.zoneMinutes.Z2).toBeCloseTo(20, 5);
    expect(summary.zoneMinutes.Z3).toBeCloseTo(10, 5);
    expect(summary.zoneMinutes.Z4).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ride/load.test.ts`
Expected: FAIL — cannot resolve `./load`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/ride/load.ts
import type { Chunk } from './types';
import { zoneForFraction, ZONE_IDS, type ZoneId } from './zones';
import { urbanStopPenaltyMin } from './simulate';

export interface LoadSummary {
  ftpW: number;
  npW: number;
  intensityFactor: number;
  tss: number;
  movingSeconds: number;
  zoneMinutes: Record<ZoneId, number>;
}

function emptyZoneMinutes(): Record<ZoneId, number> {
  return ZONE_IDS.reduce((acc, id) => {
    acc[id] = 0;
    return acc;
  }, {} as Record<ZoneId, number>);
}

export function computeLoadSummary(chunks: Chunk[], ftpW: number): LoadSummary {
  const zoneMinutes = emptyZoneMinutes();
  let movingSeconds = 0;
  let weightedFourthPower = 0;

  for (const chunk of chunks) {
    const dwellMin = chunk.urban ? urbanStopPenaltyMin(chunk.lengthKm) : 0;
    const movingMin = Math.max(0, chunk.durationMin - dwellMin);
    const seconds = movingMin * 60;
    if (seconds <= 0) continue;

    movingSeconds += seconds;
    weightedFourthPower += chunk.effectivePower ** 4 * seconds;
    if (ftpW > 0) {
      zoneMinutes[zoneForFraction(chunk.effectivePower / ftpW)] += movingMin;
    }
  }

  const npW = movingSeconds > 0 ? (weightedFourthPower / movingSeconds) ** 0.25 : 0;
  const intensityFactor = ftpW > 0 ? npW / ftpW : 0;
  const tss = ftpW > 0 ? ((movingSeconds * npW * intensityFactor) / (ftpW * 3600)) * 100 : 0;

  return { ftpW, npW, intensityFactor, tss, movingSeconds, zoneMinutes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ride/load.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ride/load.ts src/lib/ride/load.test.ts
git commit -m "Add power-based ride load (NP/IF/TSS) and time-in-zone computation"
```

---

### Task 5: Rider inputs — Baseline label, FTP note, ride-profile picker

**Files:**
- Modify: `src/lib/uiCopy.ts` (add tooltip + caveat constants)
- Modify: `src/components/ride/RiderProfileForm.tsx` (label, tooltip, FTP note)
- Create: `src/components/ride/RideProfilePicker.tsx`
- Modify: `src/views/RideSimulator.tsx` (mount the picker)

**Interfaces:**
- Consumes: `deriveFtpW`, `RIDE_PROFILES`, `RideProfileId` from `../../lib/ride/zones`.
- Produces: `RideProfilePicker` component `{ value: RideProfileId; onChange: (next: RideProfileId) => void }`.

- [ ] **Step 1: Add copy constants**

In `src/lib/uiCopy.ts` add:

```typescript
export const BASELINE_POWER_TOOLTIP = [
  'Your steady, all-day effort — the power you could hold on flat ground for hours.',
  'Treated as mid-Zone-2 (65% of FTP); the simulator estimates FTP and training zones from it.',
].join('\n');

export const RIDE_PROFILE_TOOLTIP = [
  'How hard the rider works on this route:',
  '• Endurance — easy flats, climbs no harder than Tempo (Z3).',
  '• Tempo — flats at Tempo, climbs up to Threshold (Z4).',
  '• High intensity — easy flats, climbs attacked into VO2max (Z5).',
].join('\n');

export const RIDE_LOAD_CAVEAT = 'Training load is estimated from modelled effort, not measured power.';
```

- [ ] **Step 2: Update the Baseline Power field and add the FTP note**

In `src/components/ride/RiderProfileForm.tsx` add imports at the top:

```typescript
import { deriveFtpW } from '../../lib/ride/zones';
import { BASELINE_POWER_TOOLTIP } from '../../lib/uiCopy';
```

Change the power row (lines ~64-70) to use the new label, tooltip, and field, and add a note directly after it:

```tsx
      <NumberInputRow
        label="Baseline power"
        unitSuffix="W"
        value={profile.baselinePower}
        decimals={0}
        tooltip={BASELINE_POWER_TOOLTIP}
        onChange={(power) => patch({ baselinePower: power })}
      />
      <p className="profile-form__note">
        Estimated FTP ≈ {Math.round(deriveFtpW(profile.baselinePower))} W — baseline treated as
        mid-Zone-2 (65%).
      </p>
```

If `NumberInputRow` does not accept a `tooltip` prop, drop that line (the `SelectInputRow` above accepts one; verify `NumberInputRow`'s props in `src/components/InputRow.tsx` and match its actual signature — do not invent a prop).

- [ ] **Step 3: Create the ride-profile picker**

```tsx
// src/components/ride/RideProfilePicker.tsx
import { RIDE_PROFILES, type RideProfileId } from '../../lib/ride/zones';
import { InfoTooltip } from '../InfoTooltip';
import { RIDE_PROFILE_TOOLTIP } from '../../lib/uiCopy';

const PROFILE_IDS = Object.keys(RIDE_PROFILES) as RideProfileId[];

interface RideProfilePickerProps {
  value: RideProfileId;
  onChange: (next: RideProfileId) => void;
}

export function RideProfilePicker({ value, onChange }: RideProfilePickerProps) {
  return (
    <label className="reverse-toggle">
      Ride profile
      <select value={value} onChange={(event) => onChange(event.target.value as RideProfileId)}>
        {PROFILE_IDS.map((id) => (
          <option key={id} value={id}>
            {RIDE_PROFILES[id].label}
          </option>
        ))}
      </select>
      <InfoTooltip content={RIDE_PROFILE_TOOLTIP} label="How ride profiles work" />
    </label>
  );
}
```

- [ ] **Step 4: Mount the picker in the rider-profile section**

In `src/views/RideSimulator.tsx` add the import:

```typescript
import { RideProfilePicker } from '../components/ride/RideProfilePicker';
```

Inside the `<section className="ride-section">` for "Rider profile" (after `<RiderProfileForm .../>`, before the Auto-aerobar `<label>` at ~731), add:

```tsx
        <RideProfilePicker
          value={state.rideProfile ?? 'endurance'}
          onChange={(rideProfile) => setState((prev) => ({ ...prev, rideProfile }))}
        />
```

- [ ] **Step 5: Verify compile and run the suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/uiCopy.ts src/components/ride/RiderProfileForm.tsx \
  src/components/ride/RideProfilePicker.tsx src/views/RideSimulator.tsx
git commit -m "Add ride-profile picker, Baseline Power label and estimated-FTP note"
```

---

### Task 6: Ride Load card in the summary

**Files:**
- Modify: `src/components/ride/RouteSummary.tsx` (accept + render load)
- Modify: `src/views/RideSimulator.tsx` (compute `LoadSummary`, pass it in)
- Modify: `src/styles.css` (zone-breakdown styling — optional, minimal)

**Interfaces:**
- Consumes: `LoadSummary` from `../../lib/ride/load`; `ZONE_IDS` from `../../lib/ride/zones`; `RIDE_LOAD_CAVEAT`, `formatMinutes` from `../../lib/uiCopy`; `InfoTooltip`.
- Produces: `RouteSummary` gains a required-nullable prop `load: LoadSummary | null`.

- [ ] **Step 1: Extend `RouteSummary` to render the load card**

In `src/components/ride/RouteSummary.tsx` add imports:

```typescript
import type { LoadSummary } from '../../lib/ride/load';
import { ZONE_IDS } from '../../lib/ride/zones';
import { formatMinutes, SUMMARY_EMPTY, RIDE_LOAD_CAVEAT } from '../../lib/uiCopy';
import { InfoTooltip } from '../InfoTooltip';
```

Add `load` to the props interface:

```typescript
interface RouteSummaryProps {
  points: RoutePoint[];
  chunks: Chunk[];
  startDateTime: string;
  units: UnitSystem;
  load: LoadSummary | null;
}
```

Destructure `load` in the component signature and, before the closing `</div>` of `.route-summary`, render the load items when `load` is present:

```tsx
      {load && (
        <>
          <div className="route-summary__item">
            <span className="route-summary__label">
              Training load
              <InfoTooltip content={RIDE_LOAD_CAVEAT} label="How training load is estimated" />
            </span>
            <span className="route-summary__value">{Math.round(load.tss)} TSS</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Intensity (IF)</span>
            <span className="route-summary__value">{load.intensityFactor.toFixed(2)}</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Normalized power</span>
            <span className="route-summary__value">{Math.round(load.npW)} W</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Estimated FTP</span>
            <span className="route-summary__value">{Math.round(load.ftpW)} W</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Time in zone</span>
            <span className="route-summary__value">
              {ZONE_IDS.map((id) => `${id} ${Math.round(load.zoneMinutes[id])}m`).join(' · ')}
            </span>
          </div>
        </>
      )}
```

- [ ] **Step 2: Compute and pass the load summary**

In `src/views/RideSimulator.tsx` add imports:

```typescript
import { computeLoadSummary } from '../lib/ride/load';
import { deriveFtpW } from '../lib/ride/zones';
```

Add a memo near the other derived values (after `state` is available, e.g. alongside existing `useMemo`s):

```typescript
  const load = useMemo(
    () =>
      state.chunks.length > 0
        ? computeLoadSummary(state.chunks, deriveFtpW(state.profile.baselinePower))
        : null,
    [state.chunks, state.profile.baselinePower],
  );
```

Pass it to the summary (at ~809):

```tsx
        <RouteSummary
            points={orientedPoints}
            chunks={state.chunks}
            startDateTime={state.startDateTime}
            units={state.units}
            load={load}
        />
```

- [ ] **Step 3: Optional zone-breakdown styling**

If the "Time in zone" text wraps poorly, add to `src/styles.css` (match existing `.route-summary__value` rules; only add if visually needed):

```css
.route-summary__item:has(> .route-summary__label) .route-summary__value {
  text-align: right;
}
```

Skip this step if the default layout reads fine.

- [ ] **Step 4: Verify compile and full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: all suites PASS.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, load a GPX with a real climb, and confirm: the FTP note updates with Baseline Power; switching ride profile changes climb speeds and the TSS/zone breakdown; endurance never shows Z4/Z5 minutes.

- [ ] **Step 6: Commit**

```bash
git add src/components/ride/RouteSummary.tsx src/views/RideSimulator.tsx src/styles.css
git commit -m "Show estimated ride training load and time-in-zone in the summary"
```

---

## Self-Review

**Spec coverage:**
- FTP from baseline (65%) → Task 1 (`deriveFtpW`), shown in Task 5 note. ✓
- 5-zone model → Task 1 (`zoneForFraction`). ✓
- Effort ceiling replaces ×1.10 cap, feeds speed + load → Task 3. ✓
- Ride profiles endurance/tempo/hiit, polarized → Task 1 constants, Task 3 math, Task 5 picker. ✓
- Rename Baseline Power + FTP note → Task 2 (field), Task 5 (label/note). ✓
- Load module NP/IF/TSS, moving seconds excl. urban dwell, zone distribution → Task 4. ✓
- Ride Load card in RouteSummary → Task 6. ✓
- Storage migration v3 → Task 2. ✓
- HR out of scope → not implemented anywhere. ✓
- Testing per section → each task is TDD with boundary/known-value tests. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The one conditional ("if NumberInputRow lacks a tooltip prop") points the implementer to verify a real signature rather than invent one, and the optional CSS step is gated on a visual check. ✓

**Type consistency:** `baselinePower`, `RideProfileId`, `rideProfile`, `deriveFtpW`, `zoneForFraction`, `RIDE_PROFILES`, `computeLoadSummary`, `LoadSummary`, `urbanStopPenaltyMin`, `ZONE_IDS` are used with the same names/signatures across all tasks. ✓
