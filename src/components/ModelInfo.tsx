import { useEffect, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import {
  G,
  DRIVETRAIN_EFF,
  SURFACE_CRR,
  POSITION_CDA,
  CDA_REF_WEIGHT_KG,
  CDA_REF_HEIGHT_CM,
  WIND_HEIGHT_FACTOR,
  DESCENT_MAX_KPH,
  LATERAL_ACCEL_MAX_MS2,
  URBAN_STOPS_PER_KM,
  STOP_DWELL_S,
  STOP_ACCEL_PENALTY_S,
  METABOLIC_EFF_MULTIPLIER,
} from '../lib/constants';

const drivetrainLossPct = Math.round((1 - DRIVETRAIN_EFF) * 100);
const windReductionPct = Math.round((1 - WIND_HEIGHT_FACTOR) * 100);

export function ModelInfoButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button className="btn btn--ghost" onClick={() => setOpen(true)} title="How the calculation works">
        <BookOpen width={16} height={16} strokeWidth={2} />
        How it works
      </button>
      {open && (
        <div className="model-info__backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            className="model-info"
            role="dialog"
            aria-modal="true"
            aria-label="Calculation model"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="model-info__header">
              <h2>How the calculation works</h2>
              <button className="model-info__close" onClick={() => setOpen(false)} aria-label="Close">
                <X width={18} height={18} strokeWidth={2} />
              </button>
            </header>
            <div className="model-info__body">
              <ModelInfoContent />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModelInfoContent() {
  return (
    <>
      <section>
        <h3>The force balance</h3>
        <p>
          At a steady speed the rider's power (minus a {drivetrainLossPct}% drivetrain loss) exactly
          overcomes four resistances:
        </p>
        <ul>
          <li>
            <strong>Air drag</strong> — ½ · ρ · CdA · v<sub>air</sub>² · v. Grows with the cube of
            speed, so it dominates on the flat and on descents.
          </li>
          <li>
            <strong>Rolling resistance</strong> — Crr · m · g · cos(slope). On asphalt Crr ≈{' '}
            {SURFACE_CRR.clincher.asphalt} road, {SURFACE_CRR.gravel.asphalt} gravel,{' '}
            {SURFACE_CRR.mtb.asphalt} MTB; it climbs on rough surfaces and wet roads.
          </li>
          <li>
            <strong>Gravity</strong> — m · g · sin(slope) on climbs (g = {G} m/s²). Negative
            on descents, where it drives the bike forward.
          </li>
        </ul>
        <p>
          The equation is solved for speed with Newton's method per segment. Acceleration/braking
          energy between steady states is not modelled directly (see limitations).
        </p>
      </section>

      <section>
        <h3>Following the real profile (not just the average)</h3>
        <p>
          Each route chunk is integrated <em>point by point</em> along the GPX track rather than
          solved once at its average gradient. Because speed is non-linear in gradient, averaging
          first makes rolling terrain read too fast — you lose more time on the climbs than you ever
          win back on the dips. Per-segment integration removes that optimistic bias.
        </p>
      </section>

      <section>
        <h3>Descents</h3>
        <p>
          On steep descents the rider stops pedalling and coasts toward terminal velocity. Speed is
          then capped to what is actually rideable: a cornering limit of v = √(a · R) with lateral
          grip a = {LATERAL_ACCEL_MAX_MS2} m/s² (tighter bends ⇒ lower speed), and an absolute
          ceiling of {DESCENT_MAX_KPH} km/h. Without this, the physics alone would predict
          implausible descent speeds.
        </p>
      </section>

      <section>
        <h3>Aerodynamics &amp; rider size</h3>
        <p>
          CdA (drag area) depends on body position — from ~{POSITION_CDA.aerobar} m² on the aerobars
          to ~{POSITION_CDA.bartops} m² sitting up on the tops. Those values describe a reference
          rider of {CDA_REF_WEIGHT_KG} kg / {CDA_REF_HEIGHT_CM} cm and are scaled to your own body
          using body-surface-area (frontal area grows with both weight and height), so a taller or
          heavier rider gets a realistically larger drag area.
        </p>
      </section>

      <section>
        <h3>Air &amp; wind</h3>
        <p>
          Air density falls with temperature and altitude, which the model accounts for. Forecast
          wind is given at 10 m height; a rider sits lower in the slower boundary layer, so it is
          reduced by ~{windReductionPct}% and split into a head/tailwind component (along your
          direction) and a crosswind component, both folded into the apparent wind.
        </p>
      </section>

      <section>
        <h3>Pacing &amp; towns</h3>
        <p>
          By default power scales with gradient like a constant-effort rider (harder uphill, easing
          off downhill); "keep power steady" holds it flat instead. In urban chunks an allowance for
          stops at lights and junctions is added — about {URBAN_STOPS_PER_KM} stops/km at roughly{' '}
          {STOP_DWELL_S + STOP_ACCEL_PENALTY_S}s each (wait plus re-acceleration) — time the
          steady-state physics would otherwise ignore.
        </p>
      </section>

      <section>
        <h3>Energy</h3>
        <p>
          Calorie burn assumes ~{Math.round(METABOLIC_EFF_MULTIPLIER * 100)}% gross efficiency
          turning food energy into pedal work. The "weight loss" figure is the fat-equivalent of
          that energy — a rough indicator, not a diet plan.
        </p>
      </section>

      <section>
        <h3>Assumptions &amp; limitations</h3>
        <ul>
          <li>Power is an input; there is no fitness/fatigue model checking it is sustainable.</li>
          <li>No full kinetic-energy model — only urban stops stand in for repeated accelerations.</li>
          <li>Surface is assumed smooth tarmac (plus a wet-road penalty); gravel/cobbles are not modelled.</li>
          <li>Weather is a forecast: its uncertainty is usually the largest source of error.</li>
        </ul>
        <p>
          Expect roughly ±5–10% on a steady, non-technical ride — best treated as a well-grounded
          estimate, not a stopwatch.
        </p>
      </section>
    </>
  );
}
