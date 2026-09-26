import type { Activity } from './activities';
import type { AnalysisCore } from './analyze';

/*
 * "Which of my beaches is best today?" Each beach is judged on the best it offers for the rest of
 * today (or tomorrow, once today is done), so a beach that's great at dawn isn't punished at noon.
 */

export interface BeachStanding {
  beachId: string;
  /** Best score still ahead for each activity. */
  outlook: Record<Activity, number>;
}

export interface Comparison {
  standings: BeachStanding[];
  /** The beach to pick for each activity, or null when nothing is worth recommending. */
  bestFor: Record<Activity, string | null>;
}

/** Below this, "best" isn't a recommendation, just the least bad. */
const RECOMMEND_FLOOR: Record<Activity, number> = { surf: 30, run: 55, beach: 55 };

export function compareBeaches(analyses: readonly AnalysisCore[]): Comparison {
  const standings = analyses.map((a): BeachStanding => {
    const outlook = (activity: Activity) =>
      Math.max(a.now.scores[activity].score, a.upcoming[activity]?.window.peakScore ?? 0);
    return { beachId: a.beach.id, outlook: { surf: outlook('surf'), run: outlook('run'), beach: outlook('beach') } };
  });

  const bestFor = {} as Record<Activity, string | null>;
  for (const activity of ['surf', 'run', 'beach'] as const) {
    const top = [...standings].sort((a, b) => b.outlook[activity] - a.outlook[activity])[0];
    bestFor[activity] = top && top.outlook[activity] >= RECOMMEND_FLOOR[activity] ? top.beachId : null;
  }
  return { standings, bestFor };
}
