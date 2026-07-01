# Ride Load Estimation — Design

Date: 2026-07-01
Status: Approved for planning

## Goal

Estimate an intervals.icu-style **ride training load** (TSS-equivalent) for a simulated
ride. The load is driven by a per-chunk **training-zone guess**. Because the simulator's
grade-driven power is deliberately capped for speed realism (`POWER_MAX_FACTOR = 1.10`),
computing load straight from that power under-counts hard climbs. Instead we anchor the
rider to an FTP derived from a **Baseline Power**, model a continuous per-chunk effort
that is bounded by a selected **ride profile**, and roll the result up into TSS.

Power-only for this iteration. HR-based load (hrTSS) and HR inputs are explicitly
out of scope and reserved for a later iteration.

## Core idea

Baseline Power is treated as **mid-Zone-2 = 65% of FTP**, so:

```
FTP = baselinePower / 0.65
```

Per road segment we compute a continuous **effort power fraction** of FTP from grade,
clamp its ceiling to the selected ride profile's max climb zone, and use that single
power value for **both speed and load**. Zones are labels read off the fraction; load
rolls up to a TSS number for the whole ride.

Because effort power now also feeds speed, **existing simulated climb ETAs will shift
(faster), more so for harder profiles**. This is intended.

## Zone model

Simplified 5-zone view of the Coggan model, by %FTP:

| Zone | Name          | %FTP band  |
|------|---------------|------------|
| Z1   | Recovery      | < 55       |
| Z2   | Endurance     | 56 – 75    |
| Z3   | Tempo         | 76 – 90    |
| Z4   | Threshold     | 91 – 105   |
| Z5   | VO2max+       | ≥ 106      |

Zone boundaries and a per-zone representative fraction (used for the ceiling and for
labelling) live in `constants.ts`. Baseline on flat ground equals Z2-mid (65%) by
construction, so flats need no special-casing.

Z5 is open-ended in Coggan; for the effort ceiling we cap it at **120% FTP** (top of the
VO2max band).

## Effort-power model (replaces the ×1.10 cap in `simulate.ts`)

Per segment:

```
targetFrac    = 0.65 × powerFactorForGrade(grade)   // continuous, uncapped upward; downhill taper kept
effectiveFrac = min(targetFrac, profileCeilingFrac) // ceiling = top of profile's max climb zone
effectivePower = FTP × effectiveFrac × heatFactor
```

- **`POWER_MAX_FACTOR = 1.10` is removed.** The ride-profile ceiling replaces it as the
  upper bound on climb power. `POWER_MIN_FACTOR = 0` (downhill coast taper) is kept.
- Flats stay ≈ baseline power; climbs get more power (and speed) than today, bounded by
  the profile.
- `keepPowerSteady` still works and takes precedence: it bypasses the grade factor, so
  power = baseline everywhere (flat Z2). The profile ceiling is then moot.
- The grade→power curve (`POWER_UPHILL_PER_PERCENT = 0.04`) is unchanged for now, but is
  flagged as a future tuning candidate — with the cap gone, very steep grades are what
  push effort toward Z4/Z5, and the linear curve may under-reach on short steep climbs.

## Ride profiles (polarized) — new state field `rideProfile`

`rideProfile: 'endurance' | 'tempo' | 'hiit'`, stored on `RideSimulatorState` alongside
`autoAerobar` / `keepPowerSteady` / `heatEffect` (optional field, same `?? default`
pattern). Default: `'endurance'`.

Polarized shape — flats cruise easy, climbs get attacked up to the ceiling:

| Profile        | Flat cruise | Climb ceiling  |
|----------------|-------------|----------------|
| Endurance      | Z2          | Z3 (90% FTP)   |
| Tempo          | low-Z3      | Z4 (105% FTP)  |
| High Intensity | Z2          | Z5 (120% FTP)  |

Endurance never exceeds Z3. "Flat cruise" is the natural result of the effort model on
gentle grade; the profile primarily sets the **climb ceiling**. Tempo additionally lifts
the flat cruise floor to low-Z3.

## Rider profile / input changes

- Rename `RiderProfile.defaultPower` → `baselinePower`. Relabel the input to
  **"Baseline power"** with a tooltip explaining it is expected mid-Zone-2 effort.
- Add a live note under the field: *"Estimated FTP ≈ 308 W — baseline treated as
  mid-Zone-2 (65%)."* (value recomputed from the entered baseline).
- No HR fields this iteration.

## Load computation — new pure module `src/lib/ride/load.ts`

Input: the evaluated `Chunk[]`, `FTP`, and the urban-stop penalty already folded into
`durationMin`.

- **Moving seconds**: `Σ (chunk.durationMin × 60)` **minus urban stop-dwell time**. The
  denominator for TSS excludes time spent stopped at lights/junctions (no pedaling).
  Requires exposing the urban penalty per chunk (or recomputing it from `lengthKm`).
- **Normalized Power (NP)**: duration-weighted 4th-power mean across chunks —
  `NP = (Σ pᵢ⁴·tᵢ / Σ tᵢ)^¼`. This is a chunk-level approximation of the standard
  30-second rolling NP.
- **Intensity Factor**: `IF = NP / FTP`.
- **TSS**: `movingSeconds × NP × IF / (FTP × 3600) × 100`, i.e. `movingSeconds × IF² / 36`.
- **Zone distribution**: minutes in each zone, from each chunk's zone × its duration.
- Returns an immutable `LoadSummary` DTO: `{ ftpW, npW, intensityFactor, tss,
  movingSeconds, zoneMinutes }`.

## UI

- **Ride profile picker** (Endurance / Tempo / High Intensity) beside the existing
  toggles in `RideSimulator`.
- **RouteSummary** gains a *Ride Load* card: TSS, IF, NP, estimated FTP, and a
  time-in-zone bar (minutes per Z1–Z5).
- `uiCopy` gets a short caveat: the load is an estimate from modelled effort, not a
  measured value.

## Storage migration

- Bump `STORAGE_KEY` to `bikecalc.rideSimulator.v3`; add v2 to `LEGACY_STORAGE_KEYS`.
- Migrate `profile.defaultPower` → `profile.baselinePower`.
- Default `rideProfile` to `'endurance'` when absent.
- Keep the existing tire migration.

## Testing (mirror `calc.test.ts` / `simulate.test.ts` patterns)

- Zone mapping at each %FTP boundary (54/55, 75/76, 90/91, 105/106).
- FTP derivation from baseline (200 W → ~308 W).
- Per-profile ceiling clamp: a steep grade clamps to Z3 (endurance) / Z4 (tempo) /
  Z5 (hiit); flats stay Z2.
- NP / IF / TSS against hand-computed values for a small synthetic chunk set.
- Moving-seconds excludes urban dwell.
- Zone-distribution minutes sum to moving time.

## Out of scope (reserved)

- HR inputs (HRmax / HRrest) and hrTSS / HR-based load.
- Retuning the grade→power curve.
- Structured-interval ride profiles.
