const EARTH_RADIUS_KM = 6371;

export const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function angleDiffDeg(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

interface SimplifiableLL {
  lat: number;
  lon: number;
}

function perpendicularDistance<T extends SimplifiableLL>(
  pt: T,
  lineStart: T,
  lineEnd: T,
): number {
  const x = pt.lon;
  const y = pt.lat;
  const x1 = lineStart.lon;
  const y1 = lineStart.lat;
  const x2 = lineEnd.lon;
  const y2 = lineEnd.lat;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }
  return Math.abs(dx * (y1 - y) - (x1 - x) * dy) / Math.hypot(dx, dy);
}

export function simplifyRdp<T extends SimplifiableLL>(points: T[], toleranceDeg: number): T[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i += 1) {
      const dist = perpendicularDistance(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxIndex !== -1 && maxDist > toleranceDeg) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex]);
      stack.push([maxIndex, end]);
    }
  }

  const result: T[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

export function simplifyToTarget<T extends SimplifiableLL>(points: T[], target: number): T[] {
  if (points.length <= target) return points.slice();
  let lo = 0;
  let hi = 0.01;
  let result = points;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    result = simplifyRdp(points, mid);
    if (result.length > target) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(result.length - target) < target * 0.05) break;
  }
  return result;
}

export interface CumPoint extends LatLon {
  ele: number;
  cumKm: number;
}

export function withCumulativeKm<T extends LatLon & { ele: number }>(points: T[]): Array<T & { cumKm: number }> {
  let cum = 0;
  return points.map((point, index) => {
    if (index > 0) cum += haversineKm(points[index - 1], point);
    return { ...point, cumKm: cum };
  });
}

export function locationAtKm<T extends LatLon & { cumKm: number }>(points: T[], km: number): { lat: number; lon: number } | null {
  if (points.length === 0) return null;
  if (km <= points[0].cumKm) return { lat: points[0].lat, lon: points[0].lon };
  const last = points[points.length - 1];
  if (km >= last.cumKm) return { lat: last.lat, lon: last.lon };

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].cumKm <= km) lo = mid;
    else hi = mid;
  }
  const loPoint = points[lo];
  const hiPoint = points[hi];
  const span = hiPoint.cumKm - loPoint.cumKm;
  if (span <= 0) return { lat: loPoint.lat, lon: loPoint.lon };
  const t = (km - loPoint.cumKm) / span;
  return {
    lat: loPoint.lat + (hiPoint.lat - loPoint.lat) * t,
    lon: loPoint.lon + (hiPoint.lon - loPoint.lon) * t,
  };
}
