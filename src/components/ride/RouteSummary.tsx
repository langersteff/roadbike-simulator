import type { Chunk } from '../../lib/ride/types';
import type { RoutePoint } from '../../lib/gpx/parse';
import type { UnitSystem } from '../../types';
import {
  distanceDisplay,
  elevationDisplay,
  speedDisplay,
  UNIT_LABELS,
} from '../../lib/units';
import { formatMinutes, SUMMARY_EMPTY, RIDE_LOAD_CAVEAT } from '../../lib/uiCopy';
import type { LoadSummary } from '../../lib/ride/load';
import { ZONE_IDS } from '../../lib/ride/zones';
import { InfoTooltip } from '../InfoTooltip';

interface RouteSummaryProps {
  points: RoutePoint[];
  chunks: Chunk[];
  startDateTime: string;
  units: UnitSystem;
  load: LoadSummary | null;
}

function elevationGain(points: RoutePoint[]): number {
  let gain = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index].ele - points[index - 1].ele;
    if (delta > 0) gain += delta;
  }
  return gain;
}

function totalDuration(chunks: Chunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.durationMin, 0);
}

function formatArrival(startDateTime: string, totalMin: number): string {
  if (!startDateTime) return '—';
  const start = new Date(startDateTime);
  if (Number.isNaN(start.getTime())) return '—';
  const arrival = new Date(start.getTime() + totalMin * 60_000);
  return arrival.toLocaleString();
}

export function RouteSummary({ points, chunks, startDateTime, units, load }: RouteSummaryProps) {
  if (points.length === 0) {
    return <div className="route-summary route-summary--empty">{SUMMARY_EMPTY}</div>;
  }

  const totalDistanceKm = points[points.length - 1]?.cumKm ?? 0;
  const gainM = elevationGain(points);
  const totalMin = totalDuration(chunks);
  const avgKph = totalMin > 0 ? (totalDistanceKm / totalMin) * 60 : 0;

  return (
    <div className="route-summary">
      <div className="route-summary__item">
        <span className="route-summary__label">Distance</span>
        <span className="route-summary__value">
          {distanceDisplay(totalDistanceKm, units).toFixed(1)} {UNIT_LABELS.distance(units)}
        </span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">Elevation gain</span>
        <span className="route-summary__value">
          {elevationDisplay(gainM, units).toFixed(0)} {UNIT_LABELS.elevation(units)}
        </span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">Duration</span>
        <span className="route-summary__value">{formatMinutes(totalMin)}</span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">Avg speed</span>
        <span className="route-summary__value">
          {speedDisplay(avgKph, units).toFixed(1)} {UNIT_LABELS.speed(units)}
        </span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">Arrival</span>
        <span className="route-summary__value">{formatArrival(startDateTime, totalMin)}</span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">Chunks</span>
        <span className="route-summary__value">{chunks.length}</span>
      </div>
      {load && (
        <>
          <div className="route-summary__item">
            <span className="route-summary__label">
              Training load
              <InfoTooltip content={RIDE_LOAD_CAVEAT} label="How training load is estimated" />
            </span>
            <span className="route-summary__value">{Math.round(load.tss)} TSS</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Intensity (IF)</span>
            <span className="route-summary__value">{load.intensityFactor.toFixed(2)}</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Normalized power</span>
            <span className="route-summary__value">{Math.round(load.npW)} W</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Estimated FTP</span>
            <span className="route-summary__value">{Math.round(load.ftpW)} W</span>
          </div>
          <div className="route-summary__item">
            <span className="route-summary__label">Time in zone</span>
            <span className="route-summary__value">
              {ZONE_IDS.map((id) => `${id} ${Math.round(load.zoneMinutes[id])}m`).join(' · ')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
