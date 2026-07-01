import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { POSITION_LABELS } from '../../lib/constants';
import { gradeCategory } from '../../lib/chunking/strategies';
import { bearingDeg, locationAtKm } from '../../lib/gpx/geometry';
import type { RoutePoint } from '../../lib/gpx/parse';
import type { Chunk } from '../../lib/ride/types';
import type { DaylightWindow } from '../../lib/weather/openMeteo';
import { crosswindKphFromWeather, headwindKphFromWeather } from '../../lib/ride/wind';
import { zoneForFraction, ZONE_META } from '../../lib/ride/zones';
import { exhaustionByChunk, exhaustionAtKm } from '../../lib/ride/exhaustion';
import { ZoneLegend } from './ZoneLegend';
import { formatMinutes, VELOCITY_EMPTY } from '../../lib/uiCopy';

const EXHAUSTION_COLOR = '#b91c1c';

interface VelocityChartProps {
  chunks: Chunk[];
  routePoints: RoutePoint[];
  startDateTime: string;
  daylightWindows: DaylightWindow[];
  ftpW: number;
  modelExhaustion: boolean;
  riderWeightKg: number;
  onHoverKm?: (km: number | null) => void;
}

interface ZoneBand {
  startKm: number;
  endKm: number;
  color: string;
}

function zoneBands(chunks: Chunk[], ftpW: number): ZoneBand[] {
  if (ftpW <= 0) return [];
  return chunks.map((chunk) => ({
    startKm: chunk.startKm,
    endKm: chunk.endKm,
    color: ZONE_META[zoneForFraction(chunk.effectivePower / ftpW)].color,
  }));
}

type MetricKey = 'velocity' | 'wind' | 'crosswind' | 'rain' | 'elevation' | 'temperature' | 'daylight';

interface MetricConfig {
  key: MetricKey;
  label: string;
  color: string;
}

const METRICS: MetricConfig[] = [
  { key: 'velocity', label: 'Velocity', color: '#3457d5' },
  { key: 'elevation', label: 'Elevation', color: '#8a6f47' },
  { key: 'temperature', label: 'Temperature', color: '#f97316' },
  { key: 'wind', label: 'Head-/Tailwind', color: '#c8463a' },
  { key: 'crosswind', label: 'Crosswind', color: '#8b5cf6' },
  { key: 'rain', label: 'Rain', color: '#5fa9e8' },
  { key: 'daylight', label: 'Daylight', color: '#eab308' },
];

interface ChartPoint {
  km: number;
  velocity: number;
  headwind: number | null;
  tailwind: number | null;
  crosswind: number;
  rain: number;
  elevation: number;
  temperature: number;
  daylight: number;
  chunkIndex: number;
}

const TWILIGHT_MS = 45 * 60 * 1000;

function daylightLevel(timeMs: number, windows: DaylightWindow[]): number {
  for (const window of windows) {
    if (timeMs >= window.rise && timeMs <= window.set) return 1;
    if (timeMs >= window.rise - TWILIGHT_MS && timeMs < window.rise) {
      return (timeMs - (window.rise - TWILIGHT_MS)) / TWILIGHT_MS;
    }
    if (timeMs > window.set && timeMs <= window.set + TWILIGHT_MS) {
      return 1 - (timeMs - window.set) / TWILIGHT_MS;
    }
  }
  return 0;
}

const SAMPLE_STEP_KM = 0.2;

function formatClockTime(startDateTime: string, offsetMin: number): string {
  if (!startDateTime) return '—';
  const start = new Date(startDateTime);
  if (Number.isNaN(start.getTime())) return '—';
  const at = new Date(start.getTime() + offsetMin * 60_000);
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function chunkAtKm(chunks: Chunk[], km: number): Chunk {
  for (const chunk of chunks) {
    if (km >= chunk.startKm && km <= chunk.endKm) return chunk;
  }
  return km < chunks[0].startKm ? chunks[0] : chunks[chunks.length - 1];
}

function nearestRouteIndex(points: RoutePoint[], km: number): number {
  if (points.length === 0) return 0;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].cumKm <= km) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].cumKm - km) <= Math.abs(points[hi].cumKm - km) ? lo : hi;
}

function localBearingAtKm(points: RoutePoint[], km: number, windowKm = 0.2): number {
  if (points.length < 2) return 0;
  const lookbehind = locationAtKm(points, Math.max(0, km - windowKm / 2));
  const lookahead = locationAtKm(points, km + windowKm / 2);
  if (!lookbehind || !lookahead) return 0;
  return bearingDeg(lookbehind, lookahead);
}

function buildPoints(
  chunks: Chunk[],
  routePoints: RoutePoint[],
  startDateTime: string,
  daylightWindows: DaylightWindow[],
): ChartPoint[] {
  if (chunks.length === 0) return [];
  const totalKm = chunks[chunks.length - 1].endKm;
  const stops = new Set<number>();
  for (const chunk of chunks) {
    stops.add(chunk.startKm);
    stops.add(chunk.endKm);
  }
  let km = 0;
  while (km <= totalKm) {
    stops.add(Math.round(km * 1000) / 1000);
    km += SAMPLE_STEP_KM;
  }
  const sortedKm = Array.from(stops).filter((value) => value <= totalKm).sort((a, b) => a - b);

  const startMs = startDateTime ? new Date(startDateTime).getTime() : NaN;
  const haveStart = !Number.isNaN(startMs);

  return sortedKm.map((kmValue) => {
    const chunk = chunkAtKm(chunks, kmValue);

    const elapsedToKmMin =
      chunk.startKm < kmValue
        ? chunk.etaFromStartMin + (chunk.durationMin * (kmValue - chunk.startKm)) / Math.max(1e-6, chunk.lengthKm)
        : chunk.etaFromStartMin;
    const daylightFlag =
      haveStart && daylightWindows.length > 0
        ? daylightLevel(startMs + elapsedToKmMin * 60_000, daylightWindows)
        : 0;

    let localHeadwind: number;
    let localCrosswind: number;
    if (chunk.weather && routePoints.length >= 2) {
      const localBearing = localBearingAtKm(routePoints, kmValue);
      localHeadwind =
        chunk.overrides.headwindKph !== undefined
          ? chunk.overrides.headwindKph
          : headwindKphFromWeather(chunk.weather, localBearing);
      localCrosswind = crosswindKphFromWeather(chunk.weather, localBearing);
    } else {
      localHeadwind = chunk.overrides.headwindKph ?? chunk.effectiveHeadwindKph;
      localCrosswind = 0;
    }

    const elevationM = routePoints.length > 0 ? routePoints[nearestRouteIndex(routePoints, kmValue)].ele : 0;

    return {
      km: kmValue,
      velocity: chunk.effectiveVelocityKph,
      headwind: localHeadwind >= 0 ? localHeadwind : null,
      tailwind: localHeadwind < 0 ? localHeadwind : null,
      crosswind: localCrosswind,
      rain: chunk.effectivePrecipitationMmH,
      elevation: elevationM,
      temperature: chunk.effectiveTemperatureC,
      daylight: daylightFlag,
      chunkIndex: chunk.index,
    };
  });
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  chunks: Chunk[];
  startDateTime: string;
}

function ChunkTooltip({ active, payload, chunks, startDateTime }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const chunk = chunks[point.chunkIndex];
  if (!chunk) return null;
  const offsetMin = chunk.etaFromStartMin + chunk.durationMin / 2;
  return (
    <div className="velocity-chart__tooltip">
      <div className="velocity-chart__tooltip-title">Chunk {chunk.index + 1}</div>
      <div>At {point.km.toFixed(2)} km</div>
      <div>Velocity: {chunk.effectiveVelocityKph.toFixed(1)} km/h</div>
      <div>Power: {chunk.effectivePower.toFixed(0)} W</div>
      <div>Grade: {chunk.effectiveGradePct.toFixed(1)} % · {gradeCategory(chunk.effectiveGradePct)}</div>
      <div>
        Wind: {chunk.effectiveHeadwindKph >= 0 ? 'head ' : 'tail '}
        {Math.abs(chunk.effectiveHeadwindKph).toFixed(1)} km/h
      </div>
      <div>Rain: {chunk.effectivePrecipitationMmH.toFixed(1)} mm/h</div>
      <div>Temperature: {chunk.effectiveTemperatureC.toFixed(0)} °C</div>
      <div>ETA: {formatMinutes(offsetMin)} from start</div>
      <div>Time: {formatClockTime(startDateTime, offsetMin)}</div>
      <div>Position: {POSITION_LABELS[chunk.effectivePosition]}</div>
    </div>
  );
}

export function VelocityChart({
  chunks,
  routePoints,
  startDateTime,
  daylightWindows,
  ftpW,
  modelExhaustion,
  riderWeightKg,
  onHoverKm,
}: VelocityChartProps) {
  const data = useMemo(
    () => buildPoints(chunks, routePoints, startDateTime, daylightWindows),
    [chunks, routePoints, startDateTime, daylightWindows],
  );
  const bands = useMemo(() => zoneBands(chunks, ftpW), [chunks, ftpW]);
  const chartData = useMemo(() => {
    if (!modelExhaustion || ftpW <= 0) return data;
    const byChunk = exhaustionByChunk(chunks, riderWeightKg, ftpW);
    return data.map((point) => ({ ...point, exhaustion: exhaustionAtKm(point.km, chunks, byChunk) }));
  }, [data, modelExhaustion, chunks, riderWeightKg, ftpW]);
  const [shown, setShown] = useState<Set<MetricKey>>(() => new Set<MetricKey>(['velocity']));
  const [showZones, setShowZones] = useState(false);
  const [showExhaustion, setShowExhaustion] = useState(false);

  if (chunks.length === 0) {
    return <div className="velocity-chart velocity-chart--empty">{VELOCITY_EMPTY}</div>;
  }

  const toggle = (key: MetricKey) => {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showSpeedAxis = shown.has('velocity');
  const showWindAxis = shown.has('wind') || shown.has('crosswind');
  const showRainAxis = shown.has('rain');
  const showElevationAxis = shown.has('elevation');
  const showTemperatureAxis = shown.has('temperature');
  const showDaylightAxis = shown.has('daylight');

  return (
    <div className="velocity-chart">
      <div className="velocity-chart__toggles">
        {METRICS.map((metric) => (
          <label key={metric.key} className="velocity-chart__toggle">
            <input
              type="checkbox"
              checked={shown.has(metric.key)}
              onChange={() => toggle(metric.key)}
            />
            {metric.key === 'wind' ? (
              <span className="velocity-chart__swatch-split">
                <span style={{ background: '#c8463a' }} />
                <span style={{ background: '#1d9d6a' }} />
              </span>
            ) : (
              <span className="velocity-chart__swatch" style={{ background: metric.color }} />
            )}
            {metric.label}
          </label>
        ))}
        <label className="velocity-chart__toggle">
          <input type="checkbox" checked={showZones} onChange={() => setShowZones((value) => !value)} />
          <span className="velocity-chart__swatch-split">
            <span style={{ background: ZONE_META.Z2.color }} />
            <span style={{ background: ZONE_META.Z4.color }} />
          </span>
          Zones
        </label>
        {modelExhaustion && (
          <label className="velocity-chart__toggle">
            <input
              type="checkbox"
              checked={showExhaustion}
              onChange={() => setShowExhaustion((value) => !value)}
            />
            <span className="velocity-chart__swatch" style={{ background: EXHAUSTION_COLOR }} />
            Exhaustion
          </label>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: 24, bottom: 8, left: 0 }}
          onMouseMove={(handlerState) => {
            if (!onHoverKm) return;
            const label = handlerState?.activeLabel;
            if (typeof label === 'number') {
              onHoverKm(label);
              return;
            }
            const idx = handlerState?.activeTooltipIndex;
            if (typeof idx === 'number' && chartData[idx]) {
              onHoverKm(chartData[idx].km);
            }
          }}
          onMouseLeave={() => onHoverKm?.(null)}
        >
          <CartesianGrid stroke="#e1e4ea" strokeDasharray="3 3" />
          {showZones &&
            bands.map((band, index) => (
              <ReferenceArea
                key={index}
                yAxisId="speed"
                x1={band.startKm}
                x2={band.endKm}
                fill={band.color}
                fillOpacity={0.22}
                stroke="none"
                ifOverflow="extendDomain"
              />
            ))}
          <XAxis
            dataKey="km"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) => value.toFixed(0)}
            label={{ value: 'km', position: 'insideBottomRight', offset: -2, fill: '#5a6373' }}
            stroke="#5a6373"
            tickLine={false}
          />
          <YAxis
            yAxisId="speed"
            orientation="left"
            tickFormatter={(value: number) => value.toFixed(0)}
            label={{ value: 'km/h', angle: -90, position: 'insideLeft', fill: '#3457d5' }}
            stroke="#3457d5"
            tickLine={false}
            hide={!showSpeedAxis}
          />
          <YAxis
            yAxisId="temperature"
            orientation="right"
            tickFormatter={(value: number) => value.toFixed(0)}
            label={{ value: '°C', angle: -90, position: 'insideRight', fill: '#f97316' }}
            stroke="#f97316"
            tickLine={false}
            hide={!showTemperatureAxis}
          />
          <YAxis
            yAxisId="rain"
            orientation="right"
            tickFormatter={(value: number) => value.toFixed(1)}
            label={{ value: 'mm/h', angle: -90, position: 'insideRight', fill: '#5fa9e8' }}
            stroke="#5fa9e8"
            tickLine={false}
            domain={[0, 'auto']}
            hide={!showRainAxis}
          />
          <YAxis
            yAxisId="elevation"
            orientation="right"
            tickFormatter={(value: number) => value.toFixed(0)}
            label={{ value: 'm', angle: -90, position: 'insideRight', fill: '#8a6f47' }}
            stroke="#8a6f47"
            tickLine={false}
            hide={!showElevationAxis}
          />
          <YAxis
            yAxisId="wind"
            orientation="right"
            tickFormatter={(value: number) => value.toFixed(0)}
            label={{ value: 'wind km/h', angle: -90, position: 'insideRight', fill: '#c8463a' }}
            stroke="#c8463a"
            tickLine={false}
            hide={!showWindAxis}
          />
          <YAxis
            yAxisId="daylight"
            orientation="right"
            domain={[0, 1]}
            ticks={[0, 1]}
            tickFormatter={(value: number) => (value >= 0.5 ? 'day' : 'night')}
            label={{ value: 'sun', angle: -90, position: 'insideRight', fill: '#eab308' }}
            stroke="#eab308"
            tickLine={false}
            hide={!showDaylightAxis}
          />
          <YAxis
            yAxisId="exhaustion"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(value: number) => value.toFixed(0)}
            label={{ value: '% exhausted', angle: -90, position: 'insideRight', fill: EXHAUSTION_COLOR }}
            stroke={EXHAUSTION_COLOR}
            tickLine={false}
            hide={!(modelExhaustion && showExhaustion)}
          />
          <Tooltip content={<ChunkTooltip chunks={chunks} startDateTime={startDateTime} />} />
          {shown.has('daylight') && (
            <Area
              type="linear"
              dataKey="daylight"
              yAxisId="daylight"
              fill="#eab308"
              fillOpacity={0.22}
              stroke="#eab308"
              strokeWidth={1.5}
              strokeLinejoin="round"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {shown.has('elevation') && (
            <Area
              type="linear"
              dataKey="elevation"
              yAxisId="elevation"
              fill="#ece1d0"
              fillOpacity={0.6}
              stroke="#8a6f47"
              strokeWidth={1.5}
              strokeLinejoin="round"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {shown.has('velocity') && (
            <Area
              type="stepAfter"
              dataKey="velocity"
              yAxisId="speed"
              fill="#e9eefc"
              stroke="#3457d5"
              strokeWidth={2}
              strokeLinejoin="round"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {shown.has('rain') && (
            <Area
              type="stepAfter"
              dataKey="rain"
              yAxisId="rain"
              fill="#dbecfa"
              stroke="#5fa9e8"
              strokeWidth={2}
              strokeLinejoin="round"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {shown.has('temperature') && (
            <Line
              type="monotone"
              dataKey="temperature"
              yAxisId="temperature"
              stroke="#f97316"
              strokeWidth={2}
              strokeLinejoin="round"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {shown.has('wind') && (
            <>
              <Line
                type="linear"
                dataKey="headwind"
                yAxisId="wind"
                stroke="#c8463a"
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeLinejoin="round"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="linear"
                dataKey="tailwind"
                yAxisId="wind"
                stroke="#1d9d6a"
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeLinejoin="round"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </>
          )}
          {shown.has('crosswind') && (
            <Line
              type="linear"
              dataKey="crosswind"
              yAxisId="wind"
              stroke="#8b5cf6"
              strokeWidth={2}
              strokeDasharray="2 4"
              strokeLinejoin="round"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {modelExhaustion && showExhaustion && (
            <Line
              type="monotone"
              dataKey="exhaustion"
              yAxisId="exhaustion"
              stroke={EXHAUSTION_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {showZones && <ZoneLegend />}
    </div>
  );
}
