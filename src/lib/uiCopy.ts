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

export const SUMMARY_EMPTY = 'Upload a GPX file to see distance, elevation, duration and arrival time.';
export const CHUNKS_EMPTY = 'Upload a GPX file to generate per-chunk plans you can edit and override.';
export const VELOCITY_EMPTY = 'Velocity chart appears here once a route is loaded.';
