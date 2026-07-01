import { describe, it, expect } from 'vitest';
import { buildZoneIntervalsText } from './uiCopy';

describe('buildZoneIntervalsText', () => {
  it('formats power steps in intervals.icu duration syntax', () => {
    const zoneMinutes = { Z1: 45, Z2: 65, Z3: 120, Z4: 0, Z5: 0 };
    expect(buildZoneIntervalsText(zoneMinutes, 'power')).toBe(
      ['- 45m Z1', '- 1h5m Z2', '- 2h Z3'].join('\n'),
    );
  });

  it('appends " HR" to every step for the HR target', () => {
    const zoneMinutes = { Z1: 30, Z2: 90, Z3: 0, Z4: 0, Z5: 0 };
    expect(buildZoneIntervalsText(zoneMinutes, 'hr')).toBe(
      ['- 30m Z1 HR', '- 1h30m Z2 HR'].join('\n'),
    );
  });

  it('skips zones that round to zero minutes', () => {
    const zoneMinutes = { Z1: 0.4, Z2: 20, Z3: 0, Z4: 0, Z5: 0 };
    expect(buildZoneIntervalsText(zoneMinutes, 'power')).toBe('- 20m Z2');
  });

  it('returns an empty string when no zone has time', () => {
    const zoneMinutes = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
    expect(buildZoneIntervalsText(zoneMinutes, 'power')).toBe('');
  });
});
