import { haversineKm } from '../gpx/geometry';
import { getTuning } from '../tuning';

export interface PlaceNode {
  lat: number;
  lon: number;
  radiusKm: number;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

const PLACE_RADIUS_KM: Record<string, number> = {
  city: 3.5,
  town: 1.1,
  suburb: 0.7,
  village: 0.45,
  neighbourhood: 0.4,
  hamlet: 0.4,
};

export async function fetchUrbanPlaces(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  signal?: AbortSignal,
): Promise<PlaceNode[]> {
  const bbox = `${minLat.toFixed(5)},${minLon.toFixed(5)},${maxLat.toFixed(5)},${maxLon.toFixed(5)}`;
  const placeKeys = Object.keys(PLACE_RADIUS_KM).join('|');
  const query = `
    [out:json][timeout:25];
    node["place"~"^(${placeKeys})$"](${bbox});
    out;
  `.trim();
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal,
  });
  if (!response.ok) return [];
  const data = (await response.json()) as OverpassResponse;
  const places: PlaceNode[] = [];
  for (const element of data.elements ?? []) {
    if (
      element.type !== 'node'
      || typeof element.lat !== 'number'
      || typeof element.lon !== 'number'
      || !element.tags?.place
    ) continue;
    const radiusKm = PLACE_RADIUS_KM[element.tags.place];
    if (!radiusKm) continue;
    places.push({ lat: element.lat, lon: element.lon, radiusKm });
  }
  return places;
}

export function pointInAnyPlace(lat: number, lon: number, places: PlaceNode[]): boolean {
  const radiusScale = getTuning().urbanRadiusScale;
  for (const place of places) {
    if (haversineKm({ lat, lon }, { lat: place.lat, lon: place.lon }) <= place.radiusKm * radiusScale) return true;
  }
  return false;
}
