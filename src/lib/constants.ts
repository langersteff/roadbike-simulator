import type { Tire, Surface, Position } from '../types';

export const DEFAULT_SURFACE: Surface = 'asphalt';

/**
 * Rolling resistance as a function of both tire and surface. The same surface affects
 * each tire differently: a road clincher is fastest on asphalt but suffers badly on
 * gravel, while a knobby MTB tire barely slows down — an inversion a single surface
 * multiplier could not capture.
 *
 * Values sit within the published ranges for high-pressure road tyres (Crr ≈ 0.002–0.005)
 * up to coarse surfaces — see Wilson & Schmidt, "Bicycling Science" (4th ed., MIT Press,
 * 2020) and drum-test data at bicyclerollingresistance.com. Off-pavement figures fold in
 * surface impedance, not pure tyre Crr.
 */
export const SURFACE_CRR: Record<Tire, Record<Surface, number>> = {
  clincher: { asphalt: 0.005, compacted: 0.011, gravel: 0.020, cobbles: 0.025 },
  gravel: { asphalt: 0.010, compacted: 0.012, gravel: 0.016, cobbles: 0.022 },
  mtb: { asphalt: 0.013, compacted: 0.014, gravel: 0.017, cobbles: 0.020 },
};

// Drag area CdA (m²) by riding position for the reference rider below. Within published
// wind-tunnel/field ranges: aerobars ≈ 0.20–0.26, drops ≈ 0.30, hoods/upright ≈ 0.32–0.45
// (Wilson & Schmidt, "Bicycling Science"; García-López et al., J. Sports Sci. 26(3), 2008).
export const POSITION_CDA: Record<Position, number> = {
  hoods: 0.388,
  bartops: 0.445,
  barends: 0.420,
  drops: 0.300,
  aerobar: 0.233,
};

export const TIRE_LABELS: Record<Tire, string> = {
  clincher: 'Roadbike',
  gravel: 'Gravel',
  mtb: 'MTB',
};

export const SURFACE_LABELS: Record<Surface, string> = {
  asphalt: 'Asphalt',
  compacted: 'Compacted',
  gravel: 'Gravel',
  cobbles: 'Cobbles',
};

export const POSITION_LABELS: Record<Position, string> = {
  hoods: 'Hoods',
  bartops: 'Bartops',
  barends: 'Bar ends',
  drops: 'Drops',
  aerobar: 'Aerobar',
};

// m/s ↔ km/h: 1 m/s = 3.6 km/h (3600 s/h ÷ 1000 m/km).
export const MS_TO_KPH = 3.6;
export const KPH_TO_MS = 1 / MS_TO_KPH;

export const G = 9.8; // standard gravity, rounded (CGPM 1901: 9.80665 m/s²)
// Chain-drive efficiency; well-lubricated derailleur drivetrains measure ~95–98%
// (Spicer et al., J. Mech. Design 123(4), 2001; Martin et al. used ≈97.7%).
export const DRIVETRAIN_EFF = 0.95;
export const METABOLIC_EFF_MULTIPLIER = 0.24;
export const FAT_KJ_PER_KG = 32318;

// Air-density model — International Standard Atmosphere troposphere (ISO 2533) for pressure
// vs. elevation, then the ideal-gas law ρ = p / (R_air · T). See en.wikipedia.org/wiki/Density_of_air.
export const SEA_LEVEL_PRESSURE_PA = 101325; // ISA p0
export const SEA_LEVEL_TEMPERATURE_K = 288.15; // ISA T0 (15 °C)
export const TROPOSPHERE_LAPSE_RATE = 0.0065; // ISA L (K/m)
export const AIR_MOLAR_MASS = 0.0289644; // M, molar mass of dry air (kg/mol)
export const UNIVERSAL_GAS_CONSTANT = 8.31446; // R (J/(mol·K))
export const DRY_AIR_GAS_CONSTANT = 287.05; // specific gas constant for dry air (J/(kg·K))
export const KELVIN_OFFSET = 273.15;

// Speed-from-power solver bounds (bracketed Newton–Raphson). The ceiling is well above any
// rideable speed; descents are clamped to realism separately via cappedVelocityKph.
export const SOLVER_MAX_SPEED_MS = 45; // ~162 km/h bracket ceiling
export const SOLVER_TOLERANCE_MS = 0.01;
export const SOLVER_MAX_ITER = 40;

// POSITION_CDA values describe this reference rider. A real rider's CdA scales with
// frontal area, which tracks body-surface-area (Du Bois: BSA ∝ weight^0.425 · height^0.725).
export const CDA_REF_WEIGHT_KG = 75;
export const CDA_REF_HEIGHT_CM = 175;
export const BSA_WEIGHT_EXPONENT = 0.425;
export const BSA_HEIGHT_EXPONENT = 0.725;

// Weather forecasts report wind at 10 m; a rider sits ~1.5 m up inside the boundary layer,
// where mean wind is lower. Applied to forecast wind before resolving head-/crosswind.
export const WIND_HEIGHT_FACTOR = 0.79;

// Descent realism: a rider is limited by braking and cornering grip, not just power.
export const LATERAL_ACCEL_MAX_MS2 = 4;
export const DESCENT_MAX_KPH = 80;

// Urban riding loses time at lights/junctions that the steady-state balance never sees.
export const URBAN_STOPS_PER_KM = 1.2;
export const STOP_DWELL_S = 12;
export const STOP_ACCEL_PENALTY_S = 6;
