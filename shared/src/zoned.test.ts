import { describe, expect, it } from 'vitest';
import { addLocalDays, formatClock, formatClockRange, localDayKey, localHour, startOfLocalDay, zonedTime } from './zoned';

const LA = 'America/Los_Angeles';

describe('local days', () => {
  it('finds local midnight, which is 07:00 UTC in summer', () => {
    expect(new Date(startOfLocalDay(Date.parse('2026-09-26T19:30:00Z'), LA)).toISOString()).toBe(
      '2026-09-26T07:00:00.000Z',
    );
  });

  it('keeps the local date when UTC has already rolled over', () => {
    // 9 PM on Sept 26 in California.
    expect(localDayKey(Date.parse('2026-09-27T04:00:00Z'), LA)).toBe('2026-09-26');
  });

  it('steps across the fall DST change to the next local midnight, 25 hours later', () => {
    const saturday = zonedTime(LA, 2026, 10, 31);
    const sunday = addLocalDays(saturday, 1, LA);
    const monday = addLocalDays(saturday, 2, LA);

    expect(new Date(sunday).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(new Date(monday).toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('reads the local hour', () => {
    expect(localHour(Date.parse('2026-09-26T13:30:00Z'), LA)).toBe(6.5);
  });
});

describe('formatClock', () => {
  it('drops :00 and joins ranges on one AM/PM', () => {
    const at = (iso: string) => Date.parse(iso);
    expect(formatClock(at('2026-09-26T18:00:00Z'), LA)).toBe('11 AM');
    expect(formatClockRange(at('2026-09-26T13:30:00Z'), at('2026-09-26T16:00:00Z'), LA)).toBe('6:30–9 AM');
    expect(formatClockRange(at('2026-09-26T18:00:00Z'), at('2026-09-26T21:00:00Z'), LA)).toBe('11 AM–2 PM');
  });
});
