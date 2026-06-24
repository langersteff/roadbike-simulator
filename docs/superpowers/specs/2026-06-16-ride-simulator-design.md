# Ride Simulator — Design

## Goal

A second sub-application reachable from the dashboard. The user uploads a GPX
route, the app auto-splits it into chunks, prefills each chunk with terrain
data (from the GPX) and weather data (from Open-Meteo) at the expected
arrival time, and produces a per-chunk velocity/time prediction. The result
is shown as a colored polyline on a map and a velocity-vs-distance chart with
hover details. Each chunk's settings can be overridden, and chunks can be
manually split or merged.

## Non-goals (v1)

- Stops/breaks accounting (lights, food, mechanicals).
- Backend / file upload / database — everything is in-browser.
- Multiple concurrent routes — one route at a time.
- Route editing on the map (only chunk-boundary editing).
- Multi-user / sharing.
- Mobile-first layout (desktop assumed, but should not break on mobile).

## User flow

1. From the dashboard, the user clicks the "Ride simulator" tile.
2. The user uploads a GPX file. The track is parsed and decimated if needed.
3. The user picks a start date+time (default: now + 1 h), optional "Ride in
   reverse" toggle, and a global rider/bike profile (weight, tire, default
   power, default position).
4. The user picks one or more auto-split strategies and clicks Re-split.
5. The app computes chunks, fetches weather for each chunk at its ETA, and
   produces a route plan: map polyline + velocity chart + chunks table.
6. The user can:
   - Edit any chunk's overrides (power, slope, headwind, position, …).
   - Manually insert a split between two trackpoints, or merge two chunks.
   - Toggle the polyline color scale between speed / effort / slope.
   - Switch units (metric / US).
7. On any edit, downstream ETAs cascade; if ETAs shift by ≥30 min, the
   affected chunks' weather is refetched (debounced).

## Architecture

```
src/
  views/
    Dashboard.tsx                (existing — add tile)
    CalculatorComparison.tsx     (existing)
    RideSimulator.tsx            (new — orchestrates)
  components/
    DashboardTile.tsx            (existing)
    CalculatorCard.tsx           (existing)
    ride-simulator/
      GpxUpload.tsx
      RiderProfileForm.tsx
      StartTimeInput.tsx
      ReverseRouteToggle.tsx
      SplitStrategyPicker.tsx
      ChunkList.tsx
      ChunkRow.tsx               (collapsible)
      RouteMap.tsx               (react-leaflet)
      VelocityChart.tsx          (recharts)
      ColorScaleToggle.tsx
      RouteSummary.tsx
  lib/
    calc.ts                      (existing — reused unchanged)
    units.ts                     (existing — reused)
    constants.ts                 (existing — reused)
    gpx/
      parse.ts                   (DOMParser → RoutePoint[])
      geometry.ts                (haversine, bearing, RDP, cumulative km)
    chunking/
      strategies.ts              (slope / distance / bearing / forecastHour)
      merge.ts                   (union breakpoints + min-length merge)
    weather/
      openMeteo.ts               (fetch hourly forecast, batched)
    simulate.ts                  (per-chunk velocity, ETA cascade)
    storage/
      rideSimulator.ts           (localStorage IO + size cap)
  router.ts                      (+ 'ride-simulator' view)
  styles.css                     (extended)
```

### Reuse

`lib/calc.ts` already computes power↔velocity from rider/bike/wind/slope.
`simulate.ts` builds one `CalculatorInputs`-equivalent per chunk
(resolving overrides → effective inputs) and calls `computeOutputs` per
chunk. No duplication.

## Data model

```ts
type ColorScale = 'speed' | 'effort' | 'slope';

interface RoutePoint {
  lat: number;
  lon: number;
  ele: number;     // meters
  cumKm: number;   // cumulative distance from start
}

interface SplitConfig {
  slope: boolean;                                    // bucket by gradient bands
  fixedDistance: { on: boolean; km: number };        // default km = 5
  bearing:       { on: boolean; thresholdDeg: number }; // default 45
  forecastHour:  boolean;                            // align to 1-h weather slots
  minChunkKm:    number;                             // default 0.5
}

interface RiderProfile {
  riderWeight: number;
  bikeWeight: number;
  tire: Tire;
  defaultPower: number;
  defaultPosition: Position;
}

interface WeatherSample {
  time: string;          // ISO
  windMs: number;
  windFromDeg: number;   // direction wind comes FROM, 0=N, 90=E
  tempC: number;
}

interface Chunk {
  index: number;
  startKm: number;
  endKm: number;
  avgBearingDeg: number;
  avgSlopePct: number;       // auto from GPX
  positionAuto: Position;    // heuristic
  weather?: WeatherSample;
  overrides: Partial<{
    power: number;
    riderWeight: number;
    bikeWeight: number;
    tire: Tire;
    position: Position;
    headwindKph: number;
    temperatureC: number;
    slopePct: number;
  }>;
  // computed (recomputed each simulate pass)
  effectivePower: number;
  effectiveVelocityKph: number;
  durationMin: number;
  etaFromStartMin: number;
}

interface RideSimulatorState {
  gpx: { name: string; points: RoutePoint[]; reversed: boolean } | null;
  startDateTime: string;     // datetime-local string
  split: SplitConfig;
  profile: RiderProfile;
  chunks: Chunk[];
  colorScale: ColorScale;
  units: UnitSystem;
}
```

## Data flow

1. **Parse**: `parseGpx(xml)` → `RoutePoint[]` → if >2000 points, RDP-simplify
   to ~2000 → assign cumulative km. Reverse if toggled.
2. **Auto-split**: for each enabled strategy compute breakpoint indices on the
   point array; union the sets; then sweep merging chunks shorter than
   `minChunkKm` into a neighbor.
3. **Initial pass**: compute `avgBearingDeg`, `avgSlopePct`, `positionAuto`.
   Build effective inputs from `profile` + (empty) overrides + zero wind. Run
   `computeOutputs` for each chunk → first-pass `durationMin`, `etaFromStartMin`.
4. **Fetch weather**: for each chunk, call Open-Meteo for the chunk's start
   coord at `startDateTime + etaFromStartMin`. Requests in parallel (limit
   ~10 concurrent). Cache by `(lat, lon rounded to 0.01, hour-bucket-ISO)`.
5. **Second pass**: with `headwindKph` and `temperatureC` from weather,
   recompute velocities/ETAs. Stop at 2 passes (residual error <forecast
   resolution).
6. **Edit**: when an override changes, recompute that chunk's velocity →
   cascade downstream ETAs → if any downstream chunk's ETA shifted by
   ≥30 min, mark its weather stale → refetch (debounced 500 ms) → simulate
   again.
7. **Render**: Leaflet `<Polyline>` segmented per chunk, each colored by the
   active `colorScale`. Recharts area/line chart underneath, x = `cumKm`,
   y = `effectiveVelocityKph`. Hover tooltip → velocity, time-at-this-point,
   headwind, position, power.

## Auto heuristics

- **positionAuto**: `chunkLengthKm ≥ 3 && bearingVariance < 15°` ⇒ `aerobar`;
  else `profile.defaultPosition` (typically `hoods`).
- **headwindKph**: project wind vector onto chunk's bearing
  `headwindKph = (windMs · 3.6) · cos(windFromDeg − bearingDeg)`.
  Positive = head, negative = tail (consumed by existing calc as negative
  headwind).
- **slopePct**: `(endEle − startEle) / chunkLengthMeters · 100`.

## Color scale projections

| Scale  | Metric per chunk                       | Palette                          |
|--------|----------------------------------------|----------------------------------|
| Speed  | `effectiveVelocityKph`                  | red (slow) → yellow → green     |
| Effort | `effectivePower / effectiveVelocityKph` | green (easy) → red (hard)       |
| Slope  | `effectiveSlopePct`                     | blue (down) → gray (flat) → red |

All normalized to this route's observed min/max so contrast is preserved.

## Persistence

`storage/rideSimulator.ts`:
- Key: `bikecalc.rideSimulator`.
- Stores the full `RideSimulatorState`. GPX track is kept as decimated
  `RoutePoint[]` (not raw XML) for size.
- Hard cap: if serialized JSON > 2 MB, do not persist; show a small inline
  notice "Route too large to save — will be lost on reload". Session-only
  fallback.

## External APIs

### Open-Meteo

- Endpoint: `https://api.open-meteo.com/v1/forecast`
- Params: `latitude`, `longitude`, `hourly=wind_speed_10m,wind_direction_10m,temperature_2m`,
  `timezone=auto`, `start_date`, `end_date` (one-day window covering the
  chunk's ETA).
- No API key required.
- Rate limit: ~10k requests/day per IP — well below expected usage.

### Tile provider

- OpenStreetMap raster tiles via Leaflet's default
  `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`.
- Attribution shown on the map.

## Dependencies to add

| Package           | Purpose            |
|-------------------|--------------------|
| `leaflet`         | map engine         |
| `@types/leaflet`  | types              |
| `react-leaflet`   | React bindings     |
| `recharts`        | velocity chart     |

(GPX parser and RDP simplification are written by hand — small and avoid extra deps.)

## UI layout

```
[← Dashboard]  Ride simulator                                [Metric | U.S.]

[ Upload GPX ]  Start: [datetime-local]  [□ Ride in reverse]
[ Profile: rider kg | bike kg | tire | default power W | default position ]
[ Splits: ☑ Slope  ☑ Distance(5 km)  ☑ Bearing(45°)  ☑ Hour |
          Min chunk: 0.5 km  [Re-split] ]

┌──────────────────────────────────────────────────────────────────┐
│ Map (Leaflet polyline, colored)                                  │
│ Color: ⦿ Speed  ⦾ Effort  ⦾ Slope                                │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│ Velocity chart (vs distance), tooltip on hover:                  │
│   v=28.4 km/h · t=00:34 · hw=+4 · pos=hoods · pwr=200            │
└──────────────────────────────────────────────────────────────────┘

Summary:  47.3 km  ·  +812 m  ·  1 h 52 m  ·  arrive 11:42

Chunks
 # | range          | slope | wind | temp | pos    | pwr | v     | time | ⋯
 1 | 0.0–2.3 km     | +1.2% | +4   | 14°  | hoods  | 200 | 28.4  | 4:51 | [▾]
   ↳ overrides expand here when ▾
   + split here ────────────────────────
 2 | 2.3–7.8 km     | +3.4% | +2   | 14°  | hoods  | 200 | 19.1  | 17:18| [▾]
```

## Tradeoffs / risks

- **Convergence**: 2 passes is a deliberate cap. If forecast resolution were
  finer (sub-hour), we'd add a third.
- **Heuristic position detection**: naive and easily wrong on rolling
  rouleur sections; user override is the safety valve.
- **Large GPX**: simplification is lossy. Document the 2000-point cap and
  why elevation gain might differ slightly from the raw file.
- **Weather refetch storm**: edits cascade. Debounce + 30-min ETA-shift
  threshold prevents most refetches; only large power changes trigger them.
- **No backend** means weather caching is per-session (in-memory). Reload
  loses the cache; first paint after reload may refetch. Acceptable.
- **Browser timezone**: relies on `Intl.DateTimeFormat().resolvedOptions().timeZone`.
  If the user uploads a route for a different country, weather will still be
  fetched at the correct UTC instant (`datetime-local` in browser TZ → UTC).
  Acceptable for v1.

## Testing

- Unit tests on:
  - `gpx/parse.ts` (one valid + one malformed GPX fixture).
  - `gpx/geometry.ts` (haversine, bearing, RDP — known reference distances).
  - `chunking/strategies.ts` (each strategy on a synthetic track).
  - `chunking/merge.ts` (min-length merging edge cases — first/last chunk).
  - `simulate.ts` (a 2-chunk route with known weather → known ETA).
- Manual verification: upload a real GPX, eyeball the polyline, hover the chart.

## Out of scope / followups

- Mobile-optimized layout polish.
- Sharing routes (URL encoding / clipboard).
- Importing FIT files.
- Stops/breaks model.
- A profile picker (multiple saved rider profiles).
- Manual route trimming.
