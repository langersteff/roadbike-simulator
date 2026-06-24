import type { CalculatorInputs, CalculatorOutputs } from '../types';
import {
  SURFACE_CRR,
  DEFAULT_SURFACE,
  POSITION_CDA,
  G,
  DRIVETRAIN_EFF,
  METABOLIC_EFF_MULTIPLIER,
  FAT_KJ_PER_KG,
  CDA_REF_WEIGHT_KG,
  CDA_REF_HEIGHT_CM,
  BSA_WEIGHT_EXPONENT,
  BSA_HEIGHT_EXPONENT,
  LATERAL_ACCEL_MAX_MS2,
  DESCENT_MAX_KPH,
  MS_TO_KPH,
  KPH_TO_MS,
  SEA_LEVEL_PRESSURE_PA,
  SEA_LEVEL_TEMPERATURE_K,
  TROPOSPHERE_LAPSE_RATE,
  AIR_MOLAR_MASS,
  UNIVERSAL_GAS_CONSTANT,
  DRY_AIR_GAS_CONSTANT,
  KELVIN_OFFSET,
  SOLVER_MAX_SPEED_MS,
  SOLVER_TOLERANCE_MS,
  SOLVER_MAX_ITER,
} from './constants';

/**
 * Air density (kg/m³). Pressure at the rider's elevation comes from the International Standard
 * Atmosphere troposphere model (ISO 2533); density follows from the ideal-gas law at the actual
 * air temperature:
 *   p = p0 · (1 − L·h / T0) ^ (g·M / (R·L))
 *   ρ = p / (R_air · T)
 */
export const airDensity = (tempC: number, elevationM: number): number => {
  const pressureExponent = (G * AIR_MOLAR_MASS) / (UNIVERSAL_GAS_CONSTANT * TROPOSPHERE_LAPSE_RATE);
  const pressure =
    SEA_LEVEL_PRESSURE_PA *
    (1 - (TROPOSPHERE_LAPSE_RATE * elevationM) / SEA_LEVEL_TEMPERATURE_K) ** pressureExponent;
  return pressure / (DRY_AIR_GAS_CONSTANT * (tempC + KELVIN_OFFSET));
};

/** Frontal-area multiplier vs the reference rider, from body-surface-area scaling. */
export const frontalAreaScale = (riderWeightKg: number, bodyHeightCm?: number): number => {
  const height = bodyHeightCm ?? CDA_REF_HEIGHT_CM;
  return (
    (riderWeightKg / CDA_REF_WEIGHT_KG) ** BSA_WEIGHT_EXPONENT *
    (height / CDA_REF_HEIGHT_CM) ** BSA_HEIGHT_EXPONENT
  );
};

/** Clamp a steady-state speed to what braking and cornering grip actually allow. */
export const cappedVelocityKph = (rawKph: number, turnRadiusM: number): number => {
  const corneringKph =
    turnRadiusM > 0 ? Math.sqrt(LATERAL_ACCEL_MAX_MS2 * turnRadiusM) * MS_TO_KPH : Infinity;
  return Math.min(rawKph, corneringKph, DESCENT_MAX_KPH);
};

/**
 * Speed (m/s) that balances rider power against aerodynamic drag, rolling resistance and gravity,
 * per the steady-state road-cycling power model (Martin et al., J. Appl. Biomech. 14(3):276, 1998):
 *
 *   η·P = v · ( ½·ρ·CdA · v_app² + m·g·(sin θ + Crr·cos θ) )
 *
 * with apparent wind v_app² = (v + headwind)² + crosswind². The left factor is `dragFactor`
 * (= ½·ρ·CdA) and the gravity+rolling term is `resistance`. Rearranged this is a cubic in v with
 * a single physical root; we find it with a bracketed Newton–Raphson (safeguarded by bisection,
 * the standard "rtsafe" scheme) so it converges on climbs, descents and tail/headwinds alike.
 */
export const solveVelocityFromPower = (
  dragFactor: number,
  headwind: number,
  crosswind: number,
  resistance: number,
  efficiency: number,
  power: number,
): number => {
  const drivePower = efficiency * power;
  // No drive power on the flat or a climb means no movement; on a descent (resistance < 0)
  // gravity still drives a coasting terminal velocity, so fall through to the solver.
  if (drivePower <= 0 && resistance >= 0) return 0;
  const crosswind2 = crosswind * crosswind;

  // Net force the rider must still overcome at speed v; the solution is its positive root.
  const netForce = (v: number): number => {
    const along = v + headwind;
    const apparent2 = along * along + crosswind2;
    const signedDrag = along >= 0 ? dragFactor : -dragFactor;
    return v * (signedDrag * apparent2 + resistance) - drivePower;
  };
  const netForceSlope = (v: number): number => {
    const along = v + headwind;
    const apparent2 = along * along + crosswind2;
    const signedDrag = along >= 0 ? dragFactor : -dragFactor;
    return signedDrag * (apparent2 + 2 * v * along) + resistance;
  };

  // netForce(0) = −drivePower < 0; bracket the root against an upper speed bound.
  let low = 0;
  let high = SOLVER_MAX_SPEED_MS;
  if (netForce(high) < 0) return high;

  let velocity = 0.5 * (low + high);
  for (let iteration = 0; iteration < SOLVER_MAX_ITER; iteration += 1) {
    const force = netForce(velocity);
    if (force > 0) high = velocity;
    else low = velocity;

    const slope = netForceSlope(velocity);
    const newtonStep = slope !== 0 ? velocity - force / slope : NaN;
    const next =
      Number.isFinite(newtonStep) && newtonStep > low && newtonStep < high
        ? newtonStep
        : 0.5 * (low + high);

    if (Math.abs(next - velocity) < SOLVER_TOLERANCE_MS) return next;
    velocity = next;
  }
  return velocity;
};

/** Closed-form power for a given velocity (m/s) using apparent-wind magnitude. */
export const powerFromVelocity = (
  v: number,
  headwind: number,
  crosswind: number,
  resistance: number,
  dragFactor: number,
  efficiency: number,
): number => {
  const along = v + headwind;
  const apparent2 = along * along + crosswind * crosswind;
  const signedDrag = along >= 0 ? dragFactor : -dragFactor;
  return (v * resistance + v * apparent2 * signedDrag) / efficiency;
};

/** Drive the calculation in SI units and return display-ready outputs. */
export const computeOutputs = (inputs: CalculatorInputs): CalculatorOutputs => {
  const totalWeight = G * (inputs.riderWeight + inputs.bikeWeight);
  const density = airDensity(inputs.temperature, inputs.elevation);
  const cda = POSITION_CDA[inputs.position] * frontalAreaScale(inputs.riderWeight, inputs.bodyHeightCm);
  const dragFactor = 0.5 * cda * density;
  const effectiveCrr =
    SURFACE_CRR[inputs.tire][inputs.surface ?? DEFAULT_SURFACE] * (inputs.crrMultiplier ?? 1);
  const slopeRad = Math.atan(inputs.grade / 100);
  const resistance = totalWeight * (Math.sin(slopeRad) + effectiveCrr * Math.cos(slopeRad));
  const headwindMs = inputs.headwind * KPH_TO_MS;
  const crosswindMs = (inputs.crosswind ?? 0) * KPH_TO_MS;
  const distanceM = inputs.distance * 1000;

  let velocityMs: number;
  let powerW: number;

  if (inputs.mode === 'power') {
    powerW = inputs.power;
    velocityMs = solveVelocityFromPower(dragFactor, headwindMs, crosswindMs, resistance, DRIVETRAIN_EFF, powerW);
  } else {
    velocityMs = inputs.velocity * KPH_TO_MS;
    powerW = powerFromVelocity(velocityMs, headwindMs, crosswindMs, resistance, dragFactor, DRIVETRAIN_EFF);
  }

  const velocityKph = velocityMs * MS_TO_KPH;
  const timeMin = velocityMs > 0 ? distanceM / velocityMs / 60 : 0;
  const energyKJ = timeMin * powerW * METABOLIC_EFF_MULTIPLIER;
  const weightLossKg = energyKJ / FAT_KJ_PER_KG;

  return { velocityKph, powerW, timeMin, energyKJ, weightLossKg };
};
