import { ZONE_IDS, type ZoneId } from './ride/zones';

export const WIND_SIGN_TOOLTIP = [
  'Sign convention:',
  '• Positive value = headwind (slows you down)',
  '• Negative value = tailwind (helps you along)',
].join('\n');

export const TIRE_TOOLTIP = [
  'Sets the rolling resistance coefficient (Crr):',
  '• Roadbike — narrow clincher, Crr ≈ 0.005',
  '• Gravel — semi-slick, mixed terrain, Crr ≈ 0.010',
  '• MTB — XC knobby, Crr ≈ 0.013',
].join('\n');

export const SURFACE_TOOLTIP = [
  'The road surface the tire rolls on. Crr depends on both together:',
  '• Asphalt — smooth pavement (baseline)',
  '• Compacted — hardpack / fine gravel',
  '• Gravel — loose gravel or dirt',
  '• Cobbles — pavé / sett',
  'A road tire loses far more off pavement than an MTB tire does.',
].join('\n');

export function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min < 0) return '—';
  const hours = Math.floor(min / 60);
  const minutes = Math.round(min - hours * 60);
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes} min`;
}

// intervals.icu duration syntax: "2h", "45m", "1h5m" — no spaces, whole hours drop minutes.
function formatIntervalsDuration(min: number): string {
  const total = Math.round(min);
  const hours = Math.floor(total / 60);
  const minutes = total - hours * 60;
  if (hours > 0 && minutes > 0) return `${hours}h${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

// Builds an intervals.icu workout description from time-in-zone, one step per zone with time.
// HR target appends " HR" so intervals.icu reads the same Z1..Z5 bands as heart-rate zones.
export function buildZoneIntervalsText(
  zoneMinutes: Readonly<Record<ZoneId, number>>,
  target: 'power' | 'hr',
): string {
  const suffix = target === 'hr' ? ' HR' : '';
  return ZONE_IDS.filter((id) => Math.round(zoneMinutes[id]) > 0)
    .map((id) => `- ${formatIntervalsDuration(zoneMinutes[id])} ${id}${suffix}`)
    .join('\n');
}

export const SUMMARY_EMPTY = 'Upload a GPX file to see distance, elevation, duration and arrival time.';
export const CHUNKS_EMPTY = 'Upload a GPX file to generate per-chunk plans you can edit and override.';
export const VELOCITY_EMPTY = 'Velocity chart appears here once a route is loaded.';

export const BASELINE_POWER_TOOLTIP = [
  'Your steady, all-day effort — the power you could hold on flat ground for hours.',
  'Treated as mid-Zone-2 (65% of FTP); the simulator estimates FTP and training zones from it.',
].join('\n');

export const RIDE_PROFILE_TOOLTIP = [
  'How hard the rider works on this route:',
  '• Endurance — easy flats, climbs no harder than Tempo (Z3).',
  '• Tempo — flats at Tempo, climbs up to Threshold (Z4).',
  '• High intensity — easy flats, climbs attacked into VO2max (Z5).',
].join('\n');

export const RIDE_LOAD_CAVEAT = 'Training load is estimated from modelled effort, not measured power.';
