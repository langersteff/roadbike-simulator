export type ZoneId = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
export type RideProfileId = 'easyEndurance' | 'endurance' | 'tempo' | 'hiit';

export const ZONE_IDS: ZoneId[] = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

// Baseline Power is entered as the rider's mid-Zone-2 effort, which sits at ~65% of FTP,
// so FTP is the baseline scaled back up by that fraction.
export const Z2_MID_FRACTION = 0.65;

export function deriveFtpW(baselinePowerW: number): number {
  return baselinePowerW / Z2_MID_FRACTION;
}

// Upper bounds (exclusive) of each zone as a fraction of FTP; Z5 is open-ended.
const ZONE_UPPER_BOUNDS: Array<{ id: ZoneId; below: number }> = [
  { id: 'Z1', below: 0.55 },
  { id: 'Z2', below: 0.76 },
  { id: 'Z3', below: 0.91 },
  { id: 'Z4', below: 1.06 },
];

export function zoneForFraction(fractionOfFtp: number): ZoneId {
  const match = ZONE_UPPER_BOUNDS.find((zone) => fractionOfFtp < zone.below);
  return match ? match.id : 'Z5';
}

export interface ZoneMeta {
  name: string;
  rangeLabel: string;
  color: string;
}

// Display metadata for the time-in-zone breakdown. rangeLabel mirrors the %FTP bands in
// ZONE_UPPER_BOUNDS; colors run cool→hot to match how training platforms shade intensity.
export const ZONE_META: Record<ZoneId, ZoneMeta> = {
  Z1: { name: 'Recovery', rangeLabel: '<55%', color: '#2bb3a3' },
  Z2: { name: 'Endurance', rangeLabel: '55–75%', color: '#4caf50' },
  Z3: { name: 'Tempo', rangeLabel: '76–90%', color: '#f4d03f' },
  Z4: { name: 'Threshold', rangeLabel: '91–105%', color: '#ef9234' },
  Z5: { name: 'VO2max+', rangeLabel: '≥106%', color: '#e0455e' },
};

export interface RideProfileSpec {
  cruiseFraction: number;
  ceilingFraction: number;
  /** FTP-fraction the climb demand adds per 1% of grade. Lower = climbs reach Z3 at steeper grades. */
  climbRise: number;
  label: string;
}

// cruiseFraction: effort on flat ground as a fraction of FTP (scaled by grade below).
// ceilingFraction: hardest sustained climb effort the profile allows.
// climbRise: how sharply climbs push the zone up — gentler on easy rides.
export const RIDE_PROFILES: Record<RideProfileId, RideProfileSpec> = {
  easyEndurance: { cruiseFraction: 0.4, ceilingFraction: 0.90, climbRise: 0.015, label: 'Easy endurance' },
  endurance: { cruiseFraction: 0.55, ceilingFraction: 0.90, climbRise: 0.025, label: 'Endurance' },
  tempo: { cruiseFraction: 0.78, ceilingFraction: 1.05, climbRise: 0.045, label: 'Tempo' },
  hiit: { cruiseFraction: 0.65, ceilingFraction: 1.20, climbRise: 0.05, label: 'High intensity' },
};
