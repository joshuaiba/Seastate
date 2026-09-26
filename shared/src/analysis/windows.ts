/*
 * Windows: stretches of time when a score stays high. "Best surf window 6:30–9:00 AM" is the
 * longest-running stretch near the day's peak, not just the peak itself, because a session needs time.
 */

export interface ScoredPoint {
  ms: number;
  score: number;
}

export interface TimeWindow {
  startMs: number;
  /** End of the last qualifying step. */
  endMs: number;
  peakMs: number;
  peakScore: number;
  meanScore: number;
}

/** Contiguous runs of points scoring at least `threshold`. Points must be evenly spaced by `stepMs`. */
export function findWindows(points: readonly ScoredPoint[], threshold: number, stepMs: number): TimeWindow[] {
  const windows: TimeWindow[] = [];
  let run: ScoredPoint[] = [];
  const flush = () => {
    if (run.length > 0) windows.push(summarize(run, stepMs));
    run = [];
  };
  for (const point of points) {
    const contiguous = run.length === 0 || point.ms - run[run.length - 1]!.ms <= stepMs * 1.5;
    if (!contiguous) flush();
    if (point.score >= threshold) run.push(point);
    else flush();
  }
  flush();
  return windows;
}

export interface BestWindowOptions {
  stepMs: number;
  /** Never call anything below this a window. */
  floor: number;
  /** A window includes everything within this many points of the peak. */
  tolerance: number;
  /** Ignore blips shorter than this. */
  minDurationMs: number;
  /** Trim longer windows to their best stretch of this length, so the advice stays specific. */
  maxDurationMs?: number;
}

/**
 * The best window in `points`: the stretch around the highest score, widened to include everything
 * within `tolerance` of it. If that's too short to be useful, the tolerance is relaxed a step or two
 * (never below `floor`). Null if nothing reaches `floor` for long enough.
 */
export function bestWindow(points: readonly ScoredPoint[], options: BestWindowOptions): TimeWindow | null {
  const peak = points.reduce<ScoredPoint | null>((best, p) => (!best || p.score > best.score ? p : best), null);
  if (!peak || peak.score < options.floor) return null;

  // Prefer a strong, long window over a short spike: mean score, nudged by length.
  const rank = (w: TimeWindow) => w.meanScore + Math.min(8, (w.endMs - w.startMs) / 3_600_000) * 1.5;
  for (const widen of [1, 1.5, 2]) {
    const threshold = Math.max(options.floor, peak.score - options.tolerance * widen);
    const candidates = findWindows(points, threshold, options.stepMs).filter(
      (w) => w.endMs - w.startMs >= options.minDurationMs,
    );
    const best = candidates.reduce<TimeWindow | null>((top, w) => (!top || rank(w) > rank(top) ? w : top), null);
    if (best) return options.maxDurationMs ? trim(best, points, options.maxDurationMs, options.stepMs) : best;
  }
  return null;
}

/** The highest-scoring stretch of `maxMs` inside `window`. */
function trim(window: TimeWindow, points: readonly ScoredPoint[], maxMs: number, stepMs: number): TimeWindow {
  if (window.endMs - window.startMs <= maxMs) return window;
  const inside = points.filter((p) => p.ms >= window.startMs && p.ms < window.endMs);
  const size = Math.max(1, Math.round(maxMs / stepMs));
  let bestStart = 0;
  let bestSum = -Infinity;
  let sum = 0;
  for (let i = 0; i < inside.length; i++) {
    sum += inside[i]!.score;
    if (i >= size) sum -= inside[i - size]!.score;
    if (i >= size - 1 && sum > bestSum) {
      bestSum = sum;
      bestStart = i - size + 1;
    }
  }
  return summarize(inside.slice(bestStart, bestStart + size), stepMs);
}

function summarize(run: readonly ScoredPoint[], stepMs: number): TimeWindow {
  const peak = run.reduce((best, p) => (p.score > best.score ? p : best));
  return {
    startMs: run[0]!.ms,
    endMs: run[run.length - 1]!.ms + stepMs,
    peakMs: peak.ms,
    peakScore: peak.score,
    meanScore: run.reduce((total, p) => total + p.score, 0) / run.length,
  };
}
