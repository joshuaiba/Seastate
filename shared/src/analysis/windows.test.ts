import { describe, expect, it } from 'vitest';
import { bestWindow, findWindows } from './windows';

const STEP = 15 * 60_000;
const points = (scores: number[]) => scores.map((score, i) => ({ ms: i * STEP, score }));

describe('findWindows', () => {
  it('returns each run at or above the threshold', () => {
    const windows = findWindows(points([10, 70, 80, 75, 20, 90, 30]), 70, STEP);

    expect(windows.map((w) => [w.startMs / STEP, w.endMs / STEP])).toEqual([
      [1, 4],
      [5, 6],
    ]);
    expect(windows[0]).toMatchObject({ peakMs: 2 * STEP, peakScore: 80, meanScore: 75 });
  });
});

describe('bestWindow', () => {
  const options = { stepMs: STEP, floor: 45, tolerance: 10, minDurationMs: 2 * STEP };

  it('widens around the peak to everything within tolerance', () => {
    const w = bestWindow(points([40, 60, 72, 78, 74, 50, 40]), options);

    expect(w && [w.startMs / STEP, w.endMs / STEP]).toEqual([2, 5]);
  });

  it('prefers a long strong window to a short spike', () => {
    const w = bestWindow(points([80, 40, 76, 75, 77, 76, 40]), options);

    expect(w && w.startMs / STEP).toBe(2);
  });

  it('returns null when nothing reaches the floor', () => {
    expect(bestWindow(points([10, 30, 44, 20]), options)).toBeNull();
  });
});
