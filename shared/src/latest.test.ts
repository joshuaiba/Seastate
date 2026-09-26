import { describe, expect, it } from 'vitest';
import { latestReadings } from './latest';

describe('latestReadings', () => {
  it('takes the most recent non-null value of each field, regardless of row order', () => {
    const rows = [
      { time: '2026-09-26T04:00:00.000Z', waveHeightM: 0.9, windSpeedMps: 3 },
      { time: '2026-09-26T05:00:00.000Z', waveHeightM: null, windSpeedMps: 4 },
      { time: '2026-09-26T03:00:00.000Z', waveHeightM: 1.2, windSpeedMps: null },
    ];

    expect(latestReadings(rows)).toEqual({
      waveHeightM: { value: 0.9, time: '2026-09-26T04:00:00.000Z' },
      windSpeedMps: { value: 4, time: '2026-09-26T05:00:00.000Z' },
    });
  });

  it('leaves out fields that were never reported', () => {
    const rows = [{ time: '2026-09-26T04:00:00.000Z', waveHeightM: 0.9, windSpeedMps: null }];

    expect(latestReadings(rows)).toEqual({ waveHeightM: { value: 0.9, time: '2026-09-26T04:00:00.000Z' } });
    expect(latestReadings([])).toEqual({});
  });
});
