import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, Marker, Tooltip, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RoutePoint } from '../../lib/gpx/parse';
import type { Chunk, ChunkOverrides, ColorScale, RiderProfile } from '../../lib/ride/types';
import { chunkColors } from '../../lib/ride/colorScale';
import { deriveFtpW } from '../../lib/ride/zones';
import { ChunkPopup } from './ChunkPopup';

export interface JumpRequest {
  lat: number;
  lon: number;
  nonce: number;
}

interface RouteMapProps {
  points: RoutePoint[];
  chunks: Chunk[];
  colorScale: ColorScale;
  profile: RiderProfile;
  autoAerobar: boolean;
  highlightChunkIndex: number | null;
  hoveredPoint: { lat: number; lon: number } | null;
  jumpRequest: JumpRequest | null;
  onChunkOverrideChange: (chunkIndex: number, next: ChunkOverrides) => void;
}

const DEFAULT_CENTER: L.LatLngTuple = [47.0, 8.0];

function FitBounds({ points }: { points: RoutePoint[] }) {
  const map = useMap();
  const fingerprint = useMemo(() => {
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    return `${first.lat.toFixed(4)},${first.lon.toFixed(4)}|${last.lat.toFixed(4)},${last.lon.toFixed(4)}|${points.length}`;
  }, [points]);

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]));
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, fingerprint, points]);
  return null;
}

function JumpTo({ request }: { request: JumpRequest | null }) {
  const map = useMap();
  useEffect(() => {
    if (!request) return;
    map.flyTo([request.lat, request.lon], 15, { duration: 0.8 });
  }, [map, request]);
  return null;
}

const startEndIcon = (color: string) =>
  L.divIcon({
    className: 'route-pin',
    html: `<span style="background:${color}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

export function RouteMap({
  points,
  chunks,
  colorScale,
  profile,
  autoAerobar,
  highlightChunkIndex,
  hoveredPoint,
  jumpRequest,
  onChunkOverrideChange,
}: RouteMapProps) {
  const colors = useMemo(
    () => chunkColors(chunks, colorScale, deriveFtpW(profile.baselinePower)),
    [chunks, colorScale, profile.baselinePower],
  );

  if (points.length === 0) {
    return (
      <div className="route-map route-map--empty">
        Upload a GPX file to see the route on the map.
      </div>
    );
  }

  const start = points[0];
  const end = points[points.length - 1];

  return (
    <div className="route-map">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={10}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds points={points} />
        <JumpTo request={jumpRequest} />
        {chunks.map((chunk, index) => {
          const segment = points.slice(chunk.startIndex, chunk.endIndex + 1);
          if (segment.length < 2) return null;
          const isHighlighted = highlightChunkIndex === index;
          return (
            <Polyline
              key={chunk.index}
              positions={segment.map((point) => [point.lat, point.lon])}
              pathOptions={{
                color: colors[index] ?? '#3457d5',
                weight: isHighlighted ? 8 : 5,
                opacity: isHighlighted ? 1 : 0.85,
              }}
            >
              <Tooltip sticky>
                Chunk {chunk.index + 1} · {chunk.lengthKm.toFixed(1)} km ·{' '}
                {chunk.effectiveVelocityKph.toFixed(1)} km/h
              </Tooltip>
              <Popup className="chunk-popup-wrap" minWidth={220} maxWidth={260}>
                <ChunkPopup
                  chunk={chunk}
                  profile={profile}
                  autoAerobar={autoAerobar}
                  onChange={(next) => onChunkOverrideChange(chunk.index, next)}
                />
              </Popup>
            </Polyline>
          );
        })}
        <Marker position={[start.lat, start.lon]} icon={startEndIcon('#1d9d6a')}>
          <Tooltip permanent direction="top" offset={[0, -8]}>
            Start
          </Tooltip>
        </Marker>
        <Marker position={[end.lat, end.lon]} icon={startEndIcon('#c8463a')}>
          <Tooltip permanent direction="top" offset={[0, -8]}>
            End
          </Tooltip>
        </Marker>
        {hoveredPoint && (
          <CircleMarker
            center={[hoveredPoint.lat, hoveredPoint.lon]}
            radius={8}
            pathOptions={{
              color: '#1c1f26',
              weight: 2,
              fillColor: '#ffffff',
              fillOpacity: 1,
            }}
            interactive={false}
          />
        )}
      </MapContainer>
    </div>
  );
}
