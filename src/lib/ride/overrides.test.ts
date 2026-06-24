import { describe, expect, it } from 'vitest';
import { setPowerOverride, setPositionOverride, setSurfaceOverride } from './overrides';
import type { ChunkOverrides } from './types';

describe('setPowerOverride', () => {
  it('sets the power override without mutating the input', () => {
    const original: ChunkOverrides = { gradePct: 2 };
    const next = setPowerOverride(original, 240);
    expect(next).toEqual({ gradePct: 2, power: 240 });
    expect(original).toEqual({ gradePct: 2 });
  });

  it('clears the power override when given undefined', () => {
    const next = setPowerOverride({ power: 200, gradePct: 2 }, undefined);
    expect(next).toEqual({ gradePct: 2 });
  });
});

describe('setPositionOverride', () => {
  it('sets the position override', () => {
    const next = setPositionOverride({ power: 200 }, 'aerobar');
    expect(next).toEqual({ power: 200, position: 'aerobar' });
  });

  it('clears the position override when given undefined', () => {
    const original: ChunkOverrides = { position: 'aerobar', power: 200 };
    const next = setPositionOverride(original, undefined);
    expect(next).toEqual({ power: 200 });
    expect(original).toEqual({ position: 'aerobar', power: 200 });
  });
});

describe('setSurfaceOverride', () => {
  it('sets the surface override without mutating the input', () => {
    const original: ChunkOverrides = { power: 200 };
    const next = setSurfaceOverride(original, 'gravel');
    expect(next).toEqual({ power: 200, surface: 'gravel' });
    expect(original).toEqual({ power: 200 });
  });

  it('clears the surface override when given undefined', () => {
    const next = setSurfaceOverride({ surface: 'cobbles', power: 200 }, undefined);
    expect(next).toEqual({ power: 200 });
  });
});
