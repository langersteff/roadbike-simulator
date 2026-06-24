import type { Position, Surface } from '../../types';
import type { ChunkOverrides } from './types';

export function setPowerOverride(
  overrides: ChunkOverrides,
  power: number | undefined,
): ChunkOverrides {
  const next = { ...overrides };
  if (power === undefined) delete next.power;
  else next.power = power;
  return next;
}

export function setPositionOverride(
  overrides: ChunkOverrides,
  position: Position | undefined,
): ChunkOverrides {
  const next = { ...overrides };
  if (position === undefined) delete next.position;
  else next.position = position;
  return next;
}

export function setSurfaceOverride(
  overrides: ChunkOverrides,
  surface: Surface | undefined,
): ChunkOverrides {
  const next = { ...overrides };
  if (surface === undefined) delete next.surface;
  else next.surface = surface;
  return next;
}
