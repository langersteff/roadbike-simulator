import type { Surface } from '../../types';
import type { RoutePoint } from '../gpx/parse';
import { toRad } from '../gpx/geometry';
import { DEFAULT_SURFACE } from '../constants';

interface OverpassWay {
  type: 'node' | 'way' | 'relation';
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements?: OverpassWay[];
}

export interface SurfaceWay {
  surface: Surface;
  geometry: Array<{ lat: number; lon: number }>;
}

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Beyond this distance a GPX point is considered off any mapped way → asphalt fallback. */
const MATCH_MAX_KM = 0.06;
/** Spatial-index cell size in degrees (~220 m), comfortably above MATCH_MAX_KM. */
const CELL_DEG = 0.002;

const SURFACE_TAG_MAP: Record<string, Surface> = {
  asphalt: 'asphalt',
  paved: 'asphalt',
  concrete: 'asphalt',
  'concrete:lanes': 'asphalt',
  'concrete:plates': 'asphalt',
  chipseal: 'asphalt',
  metal: 'asphalt',
  wood: 'asphalt',
  sett: 'cobbles',
  cobblestone: 'cobbles',
  unhewn_cobblestone: 'cobbles',
  paving_stones: 'cobbles',
  grass_paver: 'cobbles',
  compacted: 'compacted',
  fine_gravel: 'compacted',
  pebblestone: 'compacted',
  gravel: 'gravel',
  ground: 'gravel',
  dirt: 'gravel',
  earth: 'gravel',
  mud: 'gravel',
  sand: 'gravel',
  grass: 'gravel',
  woodchips: 'gravel',
  unpaved: 'gravel',
};

const TRACKTYPE_MAP: Record<string, Surface> = {
  grade1: 'compacted',
  grade2: 'gravel',
  grade3: 'gravel',
  grade4: 'gravel',
  grade5: 'gravel',
};

const PAVED_HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'road', 'cycleway',
]);

const UNPAVED_HIGHWAYS: Record<string, Surface> = {
  track: 'compacted',
  path: 'gravel',
  bridleway: 'gravel',
};

/** Resolve a single canonical surface from OSM tags: surface > tracktype > highway > asphalt. */
export function classifySurface(tags: Record<string, string>): Surface {
  const surface = tags.surface && SURFACE_TAG_MAP[tags.surface];
  if (surface) return surface;
  const tracktype = tags.tracktype && TRACKTYPE_MAP[tags.tracktype];
  if (tracktype) return tracktype;
  const highway = tags.highway;
  if (highway) {
    if (UNPAVED_HIGHWAYS[highway]) return UNPAVED_HIGHWAYS[highway];
    if (PAVED_HIGHWAYS.has(highway)) return 'asphalt';
  }
  return DEFAULT_SURFACE;
}

export async function fetchRoadSurfaces(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  signal?: AbortSignal,
): Promise<SurfaceWay[]> {
  const bbox = `${minLat.toFixed(5)},${minLon.toFixed(5)},${maxLat.toFixed(5)},${maxLon.toFixed(5)}`;
  const query = `
    [out:json][timeout:25];
    way["highway"](${bbox});
    out geom;
  `.trim();
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal,
  });
  if (!response.ok) return [];
  const data = (await response.json()) as OverpassResponse;
  const ways: SurfaceWay[] = [];
  for (const element of data.elements ?? []) {
    if (element.type !== 'way' || !element.geometry || element.geometry.length < 2) continue;
    ways.push({ surface: classifySurface(element.tags ?? {}), geometry: element.geometry });
  }
  return ways;
}

interface LatLon {
  lat: number;
  lon: number;
}

/** Point-to-segment distance (km) via a local equirectangular projection — exact enough at road scale. */
function pointToSegmentKm(point: LatLon, start: LatLon, end: LatLon): number {
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos(toRad((start.lat + end.lat) / 2));
  const segX = (end.lon - start.lon) * metersPerDegLon;
  const segY = (end.lat - start.lat) * metersPerDegLat;
  const pointX = (point.lon - start.lon) * metersPerDegLon;
  const pointY = (point.lat - start.lat) * metersPerDegLat;
  const lengthSq = segX * segX + segY * segY;
  const projection = lengthSq > 0 ? (pointX * segX + pointY * segY) / lengthSq : 0;
  const clamped = Math.max(0, Math.min(1, projection));
  const closestX = clamped * segX;
  const closestY = clamped * segY;
  return Math.hypot(pointX - closestX, pointY - closestY) / 1000;
}

interface IndexedSegment {
  start: LatLon;
  end: LatLon;
  surface: Surface;
}

/** Bucket every way segment into the grid cells its bounding box spans. */
function buildSegmentIndex(ways: SurfaceWay[]): Map<string, IndexedSegment[]> {
  const index = new Map<string, IndexedSegment[]>();
  for (const way of ways) {
    for (let node = 0; node < way.geometry.length - 1; node += 1) {
      const start = way.geometry[node];
      const end = way.geometry[node + 1];
      const segment: IndexedSegment = { start, end, surface: way.surface };
      const minLat = Math.min(start.lat, end.lat);
      const maxLat = Math.max(start.lat, end.lat);
      const minLon = Math.min(start.lon, end.lon);
      const maxLon = Math.max(start.lon, end.lon);
      for (let lat = Math.floor(minLat / CELL_DEG); lat <= Math.floor(maxLat / CELL_DEG); lat += 1) {
        for (let lon = Math.floor(minLon / CELL_DEG); lon <= Math.floor(maxLon / CELL_DEG); lon += 1) {
          const key = `${lat}:${lon}`;
          const bucket = index.get(key);
          if (bucket) bucket.push(segment);
          else index.set(key, [segment]);
        }
      }
    }
  }
  return index;
}

/**
 * Map-match each GPX point to the surface of its nearest road segment. Points with no way
 * within MATCH_MAX_KM fall back to asphalt. Uses a grid index so cost stays ~linear in points.
 */
export function surfaceForPoints(points: RoutePoint[], ways: SurfaceWay[]): Surface[] {
  if (ways.length === 0) return points.map(() => DEFAULT_SURFACE);
  const index = buildSegmentIndex(ways);
  return points.map((point) => {
    const baseLat = Math.floor(point.lat / CELL_DEG);
    const baseLon = Math.floor(point.lon / CELL_DEG);
    let nearest = MATCH_MAX_KM;
    let matched: Surface = DEFAULT_SURFACE;
    for (let lat = baseLat - 1; lat <= baseLat + 1; lat += 1) {
      for (let lon = baseLon - 1; lon <= baseLon + 1; lon += 1) {
        const bucket = index.get(`${lat}:${lon}`);
        if (!bucket) continue;
        for (const segment of bucket) {
          const distance = pointToSegmentKm(point, segment.start, segment.end);
          if (distance < nearest) {
            nearest = distance;
            matched = segment.surface;
          }
        }
      }
    }
    return matched;
  });
}
