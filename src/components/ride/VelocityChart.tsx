import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { POSITION_LABELS } from '../../lib/constants';
import { gradeCategory } from '../../lib/chunking/strategies';
import { bearingDeg, locationAtKm } from '../../lib/gpx/geometry';
import type { RoutePoint } from '../../lib/gpx/parse';
import type { Chunk, RideBreak } from '../../lib/ride/types';
import type { DaylightWindow } from '../../lib/weather/openMeteo';
import { crosswindKphFromWeather, headwindKphFromWeather } from '../../lib/ride/wind';
import { resolveBreaks } from '../../lib/ride/simulate';
import { zoneForFraction, ZONE_META } from '../../lib/ride/zones';
import { cumulativeLoadByChunk, loadAtKm } from '../../lib/ride/load';
import { ZoneLegend } from './ZoneLegend';
import { formatBreakMarker, formatClockTime, formatMinutes, VELOCITY_EMPTY } from '../../lib/uiCopy';

const BREAK_COLOR = '#6b7280';

const LOAD_COLOR = '#b91c1c';

interface VelocityChartProps {
  chunks: Chunk[];
  routePoints: RoutePoint[];
  startDateTime: string;
  daylightWindows: DaylightWindow[];
  breaks: RideBreak[];
  ftpW: number;
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

// Several metrics can share one Y-axis (wind + crosswind), so map each metric to its axis id. The
// axis of the first-selected metric is drawn on the left (main); every other axis goes right.
const METRIC_AXIS: Record<MetricKey, string> = {
  velocity: 'speed',
  wind: 'wind',
  crosswind: 'wind',
  rain: 'rain',
  elevation: 'elevation',
  temperature: 'temperature',
  daylight: 'daylight',
};

interface MetricConfig {
  key: MetricKey;
  label: string;
  color: string;
}

const METRICS: MetricConfig[] = [
  { key: 'velocity', label: 'Speed', color: '#3457d5' },
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
  load?: number;
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

function localBearingAtKm(points: RoutePoint[], km: number, windowKm = SAMPLE_STEP_KM): number {
  if (points.length < 2) return 0;
  const lookbehind = locationAtKm(points, Math.max(0, km - windowKm / 2));
  const lookahead = locationAtKm(points, km + windowKm / 2);
  if (!lookbehind || !lookahead) return 0;
  return bearingDeg(lookbehind, lookahead);
}

// The physics model resolves one average speed per chunk, so plotting it verbatim yields a
// staircase. We instead anchor each chunk's speed at its midpoint and linearly interpolate between
// neighbouring midpoints, giving a continuous line that a monotone curve then smooths.
function speedInterpolator(chunks: Chunk[]): (km: number) => number {
  const centers = chunks.map((chunk) => ({
    km: (chunk.startKm + chunk.endKm) / 2,
    speed: chunk.effectiveVelocityKph,
  }));
  return (km: number) => {
    if (km <= centers[0].km) return centers[0].speed;
    const last = centers[centers.length - 1];
    if (km >= last.km) return last.speed;
    for (let index = 0; index < centers.length - 1; index += 1) {
      const lower = centers[index];
      const upper = centers[index + 1];
      if (km >= lower.km && km <= upper.km) {
        const fraction = (km - lower.km) / (upper.km - lower.km);
        return lower.speed + (upper.speed - lower.speed) * fraction;
      }
    }
    return last.speed;
  };
}

function buildPoints(
  chunks: Chunk[],
  routePoints: RoutePoint[],
  startDateTime: string,
  daylightWindows: DaylightWindow[],
): ChartPoint[] {
  if (chunks.length === 0) return [];
  const totalKm = chunks[chunks.length - 1].endKm;
  const speedAtKm = speedInterpolator(chunks);
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
      velocity: speedAtKm(kmValue),
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
  shown: Set<MetricKey>;
  showLoad: boolean;
}

function ChunkTooltip({ active, payload, chunks, startDateTime, shown, showLoad }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const chunk = chunks[point.chunkIndex];
  if (!chunk) return null;
  const offsetMin = chunk.etaFromStartMin + chunk.durationMin / 2;
  const windValue = point.headwind ?? point.tailwind ?? 0;
  return (
    <div className="velocity-chart__tooltip">
      <div className="velocity-chart__tooltip-title">Chunk {chunk.index + 1}</div>
      <div>At {point.km.toFixed(2)} km</div>
      <div>Grade: {chunk.effectiveGradePct.toFixed(1)} % · {gradeCategory(chunk.effectiveGradePct)}</div>
      <div>Power: {chunk.effectivePower.toFixed(0)} W</div>
      {shown.has('velocity') && <div>Speed: {point.velocity.toFixed(1)} km/h</div>}
      {shown.has('elevation') && <div>Elevation: {point.elevation.toFixed(0)} m</div>}
      {shown.has('temperature') && <div>Temperature: {point.temperature.toFixed(0)} °C</div>}
      {shown.has('wind') && (
        <div>
          Wind: {windValue >= 0 ? 'head ' : 'tail '}
          {Math.abs(windValue).toFixed(1)} km/h
        </div>
      )}
      {shown.has('crosswind') && <div>Crosswind: {point.crosswind.toFixed(1)} km/h</div>}
      {shown.has('rain') && <div>Rain: {point.rain.toFixed(1)} mm/h</div>}
      {shown.has('daylight') && <div>Daylight: {point.daylight >= 0.5 ? 'day' : 'night'}</div>}
      {showLoad && point.load !== undefined && (
        <div>Training load: {point.load.toFixed(0)} TSS</div>
      )}
      <div>Position: {POSITION_LABELS[chunk.effectivePosition]}</div>
      <div>ETA: {formatMinutes(offsetMin)} from start</div>
      <div>Time: {formatClockTime(startDateTime, offsetMin)}</div>
    </div>
  );
}

export function VelocityChart({
  chunks,
  routePoints,
  startDateTime,
  daylightWindows,
  breaks,
  ftpW,
  onHoverKm,
}: VelocityChartProps) {
  const [shownOrder, setShownOrder] = useState<MetricKey[]>(['velocity']);
  const [showZones, setShowZones] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const shown = useMemo(() => new Set(shownOrder), [shownOrder]);
  const data = useMemo(
    () => buildPoints(chunks, routePoints, startDateTime, daylightWindows),
    [chunks, routePoints, startDateTime, daylightWindows],
  );
  const bands = useMemo(() => zoneBands(chunks, ftpW), [chunks, ftpW]);
  const breakMarkers = useMemo(() => resolveBreaks(chunks, breaks), [chunks, breaks]);
  const chartData = useMemo(() => {
    if (ftpW <= 0) return data;
    const byChunk = cumulativeLoadByChunk(chunks, ftpW);
    return data.map((point) => ({ ...point, load: loadAtKm(point.km, chunks, byChunk) }));
  }, [data, chunks, ftpW]);

  if (chunks.length === 0) {
    return <div className="velocity-chart velocity-chart--empty">{VELOCITY_EMPTY}</div>;
  }

  const toggle = (key: MetricKey) => {
    setShownOrder((prev) => (prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]));
  };

  const resetGraph = () => {
    setShownOrder(['velocity']);
    setShowZones(false);
    setShowLoad(false);
  };

  const primaryAxisId = shownOrder.length > 0 ? METRIC_AXIS[shownOrder[0]] : null;
  const axisOrientation = (axisId: string): 'left' | 'right' => (primaryAxisId === axisId ? 'left' : 'right');
  const axisLabelPosition = (axisId: string): 'insideLeft' | 'insideRight' =>
    primaryAxisId === axisId ? 'insideLeft' : 'insideRight';

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
        <label className="velocity-chart__toggle">
          <input
            type="checkbox"
            checked={showLoad}
            onChange={() => setShowLoad((value) => !value)}
          />
          <span className="velocity-chart__swatch" style={{ background: LOAD_COLOR }} />
          Training load
        </label>
        <button type="button" className="velocity-chart__reset" onClick={resetGraph}>
          Reset
        </button>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={chartData}
          margin={{ top: 32, right: 24, bottom: 8, left: 0 }}
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
          {showZones && (
            <YAxis
              yAxisId="zoneband"
              domain={[0, 1]}
              width={0}
              tick={false}
              axisLine={false}
              tickLine={false}
            />
          )}
          {showZones && (
            <Line
              yAxisId="zoneband"
              dataKey={() => 0}
              stroke="none"
              dot={false}
              legendType="none"
              isAnimationActive={false}
            />
          )}
          {showZones &&
            bands.map((band, index) => (
              <ReferenceArea
                key={index}
                yAxisId="zoneband"
                y1={0}
                y2={1}
                x1={band.startKm}
                x2={band.endKm}
                fill={band.color}
                fillOpacity={0.45}
                stroke="none"
              />
            ))}
          {breakMarkers.length > 0 && (
            <YAxis
              yAxisId="breakaxis"
              domain={[0, 1]}
              width={0}
              tick={false}
              axisLine={false}
              tickLine={false}
            />
          )}
          {breakMarkers.length > 0 && (
            <Line
              yAxisId="breakaxis"
              dataKey={() => 0}
              stroke="none"
              dot={false}
              legendType="none"
              isAnimationActive={false}
            />
          )}
          {breakMarkers.map((marker) => (
            <ReferenceLine
              key={marker.id}
              yAxisId="breakaxis"
              x={marker.km}
              stroke={BREAK_COLOR}
              strokeDasharray="4 3"
              label={{ value: formatBreakMarker(marker.durationMin), position: 'top', fontSize: 14, fill: BREAK_COLOR }}
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
          {showSpeedAxis && (
            <YAxis
              yAxisId="speed"
              orientation={axisOrientation('speed')}
              width={52}
              tickFormatter={(value: number) => value.toFixed(0)}
              label={{ value: 'km/h', angle: -90, position: axisLabelPosition('speed'), fill: '#3457d5' }}
              stroke="#3457d5"
              tickLine={false}
            />
          )}
          {showTemperatureAxis && (
            <YAxis
              yAxisId="temperature"
              orientation={axisOrientation('temperature')}
              width={52}
              tickFormatter={(value: number) => value.toFixed(0)}
              label={{ value: '°C', angle: -90, position: axisLabelPosition('temperature'), fill: '#f97316' }}
              stroke="#f97316"
              tickLine={false}
            />
          )}
          {showRainAxis && (
            <YAxis
              yAxisId="rain"
              orientation={axisOrientation('rain')}
              width={52}
              tickFormatter={(value: number) => value.toFixed(1)}
              label={{ value: 'mm/h', angle: -90, position: axisLabelPosition('rain'), fill: '#5fa9e8' }}
              stroke="#5fa9e8"
              tickLine={false}
              domain={[0, 'auto']}
            />
          )}
          {showElevationAxis && (
            <YAxis
              yAxisId="elevation"
              orientation={axisOrientation('elevation')}
              width={52}
              tickFormatter={(value: number) => value.toFixed(0)}
              label={{ value: 'm', angle: -90, position: axisLabelPosition('elevation'), fill: '#8a6f47' }}
              stroke="#8a6f47"
              tickLine={false}
            />
          )}
          {showWindAxis && (
            <YAxis
              yAxisId="wind"
              orientation={axisOrientation('wind')}
              width={56}
              tickFormatter={(value: number) => value.toFixed(0)}
              label={{ value: 'wind km/h', angle: -90, position: axisLabelPosition('wind'), fill: '#c8463a' }}
              stroke="#c8463a"
              tickLine={false}
            />
          )}
          {showDaylightAxis && (
            <YAxis
              yAxisId="daylight"
              orientation={axisOrientation('daylight')}
              width={52}
              domain={[0, 1]}
              ticks={[0, 1]}
              tickFormatter={(value: number) => (value >= 0.5 ? 'day' : 'night')}
              label={{ value: 'sun', angle: -90, position: axisLabelPosition('daylight'), fill: '#eab308' }}
              stroke="#eab308"
              tickLine={false}
            />
          )}
          {showLoad && (
            <YAxis
              yAxisId="load"
              orientation="right"
              width={52}
              domain={[0, 'auto']}
              tickFormatter={(value: number) => value.toFixed(0)}
              label={{ value: 'TSS', angle: -90, position: 'insideRight', fill: LOAD_COLOR }}
              stroke={LOAD_COLOR}
              tickLine={false}
            />
          )}
          <Tooltip
            content={
              <ChunkTooltip
                chunks={chunks}
                startDateTime={startDateTime}
                shown={shown}
                showLoad={showLoad}
              />
            }
          />
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
              type="monotone"
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
          {showLoad && (
            <Line
              type="monotone"
              dataKey="load"
              yAxisId="load"
              stroke={LOAD_COLOR}
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
