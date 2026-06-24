import { describe, it, expect } from 'vitest';
import { classifySurface, surfaceForPoints, type SurfaceWay } from './surface';
import type { RoutePoint } from '../gpx/parse';

describe('classifySurface', () => {
  it('maps the surface tag first', () => {
    expect(classifySurface({ surface: 'asphalt', highway: 'track' })).toBe('asphalt');
    expect(classifySurface({ surface: 'gravel' })).toBe('gravel');
    expect(classifySurface({ surface: 'sett' })).toBe('cobbles');
    expect(classifySurface({ surface: 'fine_gravel' })).toBe('compacted');
  });

  it('falls back to tracktype, then highway, then asphalt', () => {
    expect(classifySurface({ highway: 'track', tracktype: 'grade1' })).toBe('compacted');
    expect(classifySurface({ highway: 'track', tracktype: 'grade4' })).toBe('gravel');
    expect(classifySurface({ highway: 'track' })).toBe('compacted');
    expect(classifySurface({ highway: 'path' })).toBe('gravel');
    expect(classifySurface({ highway: 'residential' })).toBe('asphalt');
    expect(classifySurface({})).toBe('asphalt');
  });
});

describe('surfaceForPoints', () => {
  const point = (lat: number, lon: number): RoutePoint =>
    ({ lat, lon, ele: 0, cumKm: 0 } as RoutePoint);

  it('returns all asphalt when no ways are supplied', () => {
    const result = surfaceForPoints([point(48.0, 11.0), point(48.001, 11.0)], []);
    expect(result).toEqual(['asphalt', 'asphalt']);
  });

  it('matches a point sitting on a gravel way and leaves far points on asphalt', () => {
    const ways: SurfaceWay[] = [
      { surface: 'gravel', geometry: [{ lat: 48.0, lon: 11.0 }, { lat: 48.0, lon: 11.01 }] },
    ];
    const onWay = point(48.00001, 11.005); // ~1 m off the segment
    const farAway = point(48.5, 11.5); // kilometres away
    expect(surfaceForPoints([onWay, farAway], ways)).toEqual(['gravel', 'asphalt']);
  });

  it('picks the nearest way when several are present', () => {
    const ways: SurfaceWay[] = [
      { surface: 'cobbles', geometry: [{ lat: 48.0, lon: 11.0 }, { lat: 48.0, lon: 11.01 }] },
      { surface: 'asphalt', geometry: [{ lat: 48.01, lon: 11.0 }, { lat: 48.01, lon: 11.01 }] },
    ];
    const nearCobbles = point(48.0002, 11.005);
    expect(surfaceForPoints([nearCobbles], ways)).toEqual(['cobbles']);
  });
});
