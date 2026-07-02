import { useState } from 'react';
import { Zap, HeartPulse, Check } from 'lucide-react';
import type { Chunk } from '../../lib/ride/types';
import type { RoutePoint } from '../../lib/gpx/parse';
import {
  formatMinutes,
  buildZoneIntervalsText,
  SUMMARY_EMPTY,
  RIDE_LOAD_CAVEAT,
  DURATION_TOOLTIP,
  ARRIVAL_TOOLTIP,
} from '../../lib/uiCopy';
import { totalMovingMinutes, type LoadSummary } from '../../lib/ride/load';
import { InfoTooltip } from '../InfoTooltip';
import { ZoneBreakdown } from './ZoneBreakdown';

type ZoneCopyTarget = 'power' | 'hr';

interface RouteSummaryProps {
  points: RoutePoint[];
  chunks: Chunk[];
  startDateTime: string;
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

export function RouteSummary({ points, chunks, startDateTime, load }: RouteSummaryProps) {
  const [copied, setCopied] = useState<ZoneCopyTarget | null>(null);

  const copyZones = async (target: ZoneCopyTarget) => {
    if (!load) return;
    await navigator.clipboard.writeText(buildZoneIntervalsText(load.zoneMinutes, target));
    setCopied(target);
    window.setTimeout(() => setCopied((current) => (current === target ? null : current)), 1800);
  };

  if (points.length === 0) {
    return <div className="route-summary route-summary--empty">{SUMMARY_EMPTY}</div>;
  }

  const totalDistanceKm = points[points.length - 1]?.cumKm ?? 0;
  const gainM = elevationGain(points);
  const movingMin = totalMovingMinutes(chunks);
  const elapsedMin = totalDuration(chunks);
  const avgKph = movingMin > 0 ? (totalDistanceKm / movingMin) * 60 : 0;

  return (
    <>
    <div className="route-summary">
      <div className="route-summary__item">
        <span className="route-summary__label">Distance</span>
        <span className="route-summary__value">
          {totalDistanceKm.toFixed(1)} km
        </span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">Elevation gain</span>
        <span className="route-summary__value">
          {gainM.toFixed(0)} m
        </span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">
          Duration
          <InfoTooltip content={DURATION_TOOLTIP} label="What the duration includes" />
        </span>
        <span className="route-summary__value">{formatMinutes(movingMin)}</span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">Avg speed</span>
        <span className="route-summary__value">
          {avgKph.toFixed(1)} km/h
        </span>
      </div>
      <div className="route-summary__item">
        <span className="route-summary__label">
          Arrival
          <InfoTooltip content={ARRIVAL_TOOLTIP} label="What the arrival time includes" />
        </span>
        <span className="route-summary__value">{formatArrival(startDateTime, elapsedMin)}</span>
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
        </>
      )}
    </div>
    {load && (
      <div className="route-summary__zones">
        <div className="route-summary__zones-header">
          <span className="route-summary__zones-title">Time in zone</span>
          <div className="route-summary__zones-actions">
            <button
              type="button"
              className="route-summary__zones-copy"
              title="Copy power zones for intervals.icu"
              aria-label="Copy power zones for intervals.icu"
              onClick={() => copyZones('power')}
            >
              {copied === 'power' ? <Check width={16} height={16} /> : <Zap width={16} height={16} />}
            </button>
            <button
              type="button"
              className="route-summary__zones-copy"
              title="Copy HR zones for intervals.icu"
              aria-label="Copy HR zones for intervals.icu"
              onClick={() => copyZones('hr')}
            >
              {copied === 'hr' ? <Check width={16} height={16} /> : <HeartPulse width={16} height={16} />}
            </button>
          </div>
        </div>
        <ZoneBreakdown load={load} />
      </div>
    )}
    {copied && (
      <div className="zone-copy-toast" role="status" aria-live="polite">
        Copied intervals.icu Zones description to clipboard
      </div>
    )}
    </>
  );
}
