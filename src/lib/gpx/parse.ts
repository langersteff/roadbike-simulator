import { simplifyToTarget, withCumulativeKm } from './geometry';

export interface RoutePoint {
  lat: number;
  lon: number;
  ele: number;
  cumKm: number;
}

export interface ParsedGpx {
  name: string;
  points: RoutePoint[];
  decimatedFrom: number | null;
}

const MAX_POINTS = 2000;

export class GpxParseError extends Error {}

export function parseGpx(xmlText: string, sourceName = 'route.gpx'): ParsedGpx {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new GpxParseError('Invalid GPX file: malformed XML.');
  }

  const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
  if (trkpts.length < 2) {
    throw new GpxParseError('GPX file has fewer than two track points.');
  }

  const rawPoints = trkpts.map((node) => {
    const lat = Number(node.getAttribute('lat'));
    const lon = Number(node.getAttribute('lon'));
    const eleNode = node.getElementsByTagName('ele')[0];
    const ele = eleNode ? Number(eleNode.textContent) : 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new GpxParseError('GPX file contains a trackpoint with invalid coordinates.');
    }
    return { lat, lon, ele: Number.isFinite(ele) ? ele : 0 };
  });

  const originalCount = rawPoints.length;
  const decimated = rawPoints.length > MAX_POINTS ? simplifyToTarget(rawPoints, MAX_POINTS) : rawPoints;
  const points = withCumulativeKm(decimated);

  const nameNode = doc.querySelector('trk > name') ?? doc.querySelector('metadata > name');
  const fallback = sourceName.replace(/\.gpx$/i, '');
  const name = nameNode?.textContent?.trim() || fallback || 'Route';

  return {
    name,
    points,
    decimatedFrom: decimated.length < originalCount ? originalCount : null,
  };
}

export function reverseRoute(points: RoutePoint[]): RoutePoint[] {
  const reversed = points.slice().reverse();
  const total = points[points.length - 1]?.cumKm ?? 0;
  return reversed.map((point) => ({ ...point, cumKm: total - point.cumKm }));
}
