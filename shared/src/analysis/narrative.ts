import { celsiusToFahrenheit, degreesToCompass } from '../units';
import { formatClock, formatClockRange, localHour, MINUTE_MS } from '../zoned';
import type { Activity, ActivityFactor } from './activities';
import type { AnalysisCore, ForecastPoint, WindowInsight } from './analyze';
import { mean } from './math';
import { GOOD_SURF_SCORE, surfRating, type SurfEstimate, type WindQuality } from './surf';
import { uvLevel } from './weather';

/*
 * Plain-language summaries. Every sentence is assembled from facts in the analysis (scores, windows,
 * limiting factors), so it changes with the data; nothing here is canned per beach.
 */

export interface Summary {
  /** A word or two: "Fair to good", "Great". */
  label: string;
  /** One sentence. */
  text: string;
  /** An optional practical tip. */
  note: string | null;
}

export interface Verdict {
  tone: 'go' | 'maybe' | 'wait';
  /** "Worth going", "Tomorrow"… */
  eyebrow: string;
  headline: string;
  /** The activity the verdict is about. */
  activity: Activity | null;
}

type Texture = 'glassy' | 'clean' | 'textured' | 'choppy' | 'blown out';
const TEXTURE_RANK: Record<Texture, number> = { glassy: 0, clean: 0, textured: 1, choppy: 2, 'blown out': 3 };

export function texture(wind: WindQuality | null): Texture {
  if (!wind) return 'textured';
  const mph = wind.speedMph;
  switch (wind.relation) {
    case 'calm':
      return 'glassy';
    case 'offshore':
    case 'cross-offshore':
      return mph < 22 ? 'clean' : 'textured';
    case 'cross-shore':
      return mph < 7 ? 'clean' : mph < 14 ? 'textured' : 'choppy';
    default:
      return mph < 5 ? 'textured' : mph < 13 ? 'choppy' : 'blown out';
  }
}

export function windPhrase(wind: WindQuality | null): string {
  if (!wind) return 'unknown wind';
  const mph = wind.speedMph;
  switch (wind.relation) {
    case 'calm':
      return 'barely any wind';
    case 'offshore':
    case 'cross-offshore':
      return mph < 6 ? 'light offshore wind' : mph < 15 ? 'offshore wind' : 'strong offshore wind';
    case 'cross-shore':
      return mph < 7 ? 'light cross-shore wind' : mph < 15 ? 'cross-shore wind' : 'strong cross-shore wind';
    default:
      return mph < 6 ? 'a light onshore breeze' : mph < 13 ? 'onshore wind' : 'strong onshore wind';
  }
}

/** "waist to chest high", "head high", "flat". */
export function sizePhrase(surf: SurfEstimate): string {
  if (surf.maxFt === 0) return 'flat';
  const ref = surf.bodyRef.toLowerCase();
  // "head high" and "overhead" already say it; "knee to thigh" needs the "high".
  return ref.endsWith(' high') || ref.includes('overhead') || ref.endsWith('+') ? ref : `${ref} high`;
}

/** "long-period SSW groundswell", "short-period windswell". */
export function swellPhrase(surf: SurfEstimate): string {
  const d = surf.dominant;
  if (!d) return 'no real swell';
  const dir = degreesToCompass(d.dirDeg);
  if (d.kind === 'wind' || d.periodS < 9) return `short-period ${dir} windswell`;
  return d.periodS >= 13 ? `long-period ${dir} groundswell` : `mid-period ${dir} swell`;
}

/** "This morning", "Tomorrow afternoon"… for a window starting at `ms`. */
function whenPhrase(ms: number, dayOffset: number, timeZone: string): string {
  const h = localHour(ms, timeZone);
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return dayOffset === 0 ? `This ${part}` : `Tomorrow ${part}`;
}

function partOfDay(ms: number, timeZone: string): string {
  const h = localHour(ms, timeZone);
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 18) return 'afternoon';
  return 'evening';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const roundTo = (ms: number, step: number) => Math.round(ms / step) * step;
const fahrenheit = (c: number | null | undefined) => (c == null ? null : Math.round(celsiusToFahrenheit(c)));

function isDaylight(core: AnalysisCore): boolean {
  const today = core.days[0];
  return core.now.sample.sunElevationDeg > -6 && (!today || core.now.ms < today.sun.sunset);
}

function range(w: WindowInsight, core: AnalysisCore): string {
  return formatClockRange(w.window.startMs, w.window.endMs, core.beach.timezone);
}

function tidePhrase(w: WindowInsight): string {
  if (w.tideTrend === 'rising') return ' on the incoming tide';
  if (w.tideTrend === 'falling') return ' on the dropping tide';
  return '';
}

export function surfSummary(core: AnalysisCore): Summary {
  const tz = core.beach.timezone;
  const { surf, wind } = core.now.scores.surf;
  const up = core.upcoming.surf;
  const today = core.days[0];
  const window = up ? `Best ${range(up, core)}${up.dayOffset === 1 ? ' tomorrow' : ''}${tidePhrase(up)}.` : null;

  if (!isDaylight(core)) {
    if (!up) return { label: 'Dark', text: 'Nothing worth a dawn patrol in the forecast.', note: null };
    const peak = up.peak.scores.surf;
    const when = whenPhrase(up.window.startMs, up.dayOffset, tz);
    return {
      label: surfRating(peak.score).label,
      text: `${when}: ${sizePhrase(peak.surf)} and ${texture(peak.wind)} from ${formatClock(up.window.startMs, tz)}.`,
      note: window,
    };
  }

  if (surf.maxFt === 0 && (today?.surf.maxFt ?? 0) === 0) {
    const tomorrow = core.days[1];
    return {
      label: 'Flat',
      text: `Flat today. Not much swell is reaching ${core.beach.name}.`,
      note: tomorrow && tomorrow.surf.maxFt > 0 ? `Tomorrow: ${tomorrow.surf.label}.` : null,
    };
  }

  const now = texture(wind);
  let text = `${cap(now)} ${partOfDay(core.now.ms, tz)} conditions with ${windPhrase(wind)}.`;

  // Say when the surface is about to get worse, the way someone deciding whether to hurry would want.
  const turn = firstChange(core, (p) => TEXTURE_RANK[texture(p.scores.surf.wind)] > TEXTURE_RANK[now]);
  if (turn && TEXTURE_RANK[now] === 0) {
    // Describe the wind once it has settled in, not mid-shift.
    const settled = core.points.find((p) => p.ms >= turn.ms + 60 * MINUTE_MS) ?? turn;
    const later = settled.scores.surf.wind;
    text = `${cap(now)} with ${windPhrase(wind)} until about ${formatClock(roundTo(turn.ms, 30 * MINUTE_MS), tz)}, when ${
      later && later.relation.includes('onshore') ? 'the onshore breeze fills in' : 'the wind picks up'
    }.`;
  } else if (up && !up.active && up.dayOffset === 0 && TEXTURE_RANK[texture(up.peak.scores.surf.wind)] < TEXTURE_RANK[now]) {
    text += ` Cleaner around ${formatClock(up.window.startMs, tz)}.`;
  }

  return { label: surfRating(core.now.scores.surf.score).label, text, note: window };
}

const RUN_ENDS: Record<ActivityFactor, string> = {
  heat: 'before temperatures rise',
  cold: 'before it cools off',
  uv: 'before the sun gets strong',
  wind: 'before the wind picks up',
  rain: 'before the rain moves in',
  dark: 'before dark',
  clouds: '',
};

const RUN_STARTS: Record<ActivityFactor, string> = {
  heat: ', once it cools off',
  cold: ', once it warms up',
  uv: ', once the sun eases',
  wind: ', once the wind eases',
  rain: ', after the rain',
  dark: '',
  clouds: '',
};

export function runSummary(core: AnalysisCore): Summary {
  const tz = core.beach.timezone;
  const run = core.now.scores.run;
  const up = core.upcoming.run;
  const feels = fahrenheit(core.now.sample.feelsLikeC ?? core.now.sample.airTempC);
  const note = up ? lowTideNote(core, up) : null;

  if (!isDaylight(core)) {
    if (!up) return { label: 'Dark', text: 'No good running window in the forecast.', note: null };
    const temp = fahrenheit(up.peak.sample.feelsLikeC);
    return {
      label: qualityLabel(up.window.peakScore),
      text: `${whenPhrase(up.window.startMs, up.dayOffset, tz)}: ${qualityLabel(up.window.peakScore).toLowerCase()} running weather ${range(up, core)}${temp === null ? '' : `, around ${temp}°F`}.`,
      note,
    };
  }

  if (run.score >= 65) {
    const word = run.score >= 82 ? 'Great' : 'Good';
    const end = firstChange(core, (p) => p.scores.run.score < 60);
    if (end) {
      const why = end.scores.run.limiting ? RUN_ENDS[end.scores.run.limiting] : '';
      return {
        label: word,
        text: `${word} running conditions until around ${formatClock(roundTo(end.ms, 30 * MINUTE_MS), tz)}${why ? ` ${why}` : ''}.`,
        note,
      };
    }
    return { label: word, text: `${word} running conditions for the rest of the day${feels ? `, around ${feels}°F` : ''}.`, note };
  }

  if (up?.dayOffset === 0) {
    return {
      label: qualityLabel(run.score),
      text: `Better from ${formatClock(up.window.startMs, tz)}${run.limiting ? RUN_STARTS[run.limiting] : ''}.`,
      note,
    };
  }
  if (up) {
    return {
      label: qualityLabel(run.score),
      text: `Not ideal today. Tomorrow ${range(up, core)} looks ${qualityLabel(up.window.peakScore).toLowerCase()}.`,
      note,
    };
  }
  return { label: qualityLabel(run.score), text: 'Not a great day for a run on the sand.', note: null };
}

export function beachSummary(core: AnalysisCore): Summary {
  const tz = core.beach.timezone;
  const [today, tomorrow] = core.days;
  if (!today) return { label: '—', text: 'No forecast available.', note: null };

  // Talk about this afternoon until it's over, then tomorrow's.
  const useToday = localHour(core.now.ms, tz) < 16.5;
  const day = useToday ? today : (tomorrow ?? today);
  const hourBetween = (p: ForecastPoint, from: number, to: number) => {
    const h = localHour(p.ms, tz);
    return h >= from && h < to;
  };
  const afternoon = day.points.filter((p) => hourBetween(p, 12, 17) && (!useToday || p.ms >= core.now.ms - 30 * MINUTE_MS));
  const focus = afternoon.length > 0 ? afternoon : day.points.filter((p) => hourBetween(p, 12, 17));
  const values = (get: (p: ForecastPoint) => number | null) =>
    focus.flatMap((p) => {
      const v = get(p);
      return v === null ? [] : [v];
    });

  const feels = mean(values((p) => p.sample.feelsLikeC ?? p.sample.airTempC));
  const feelsF = feels === null ? null : celsiusToFahrenheit(feels);
  const cloud = mean(values((p) => p.sample.cloudCoverPct)) ?? 0;
  const uvMax = Math.max(0, ...values((p) => p.sample.uvIndex));
  const windMph = (mean(values((p) => p.sample.windSpeedMps)) ?? 0) * 2.23694;
  const rain = Math.max(0, ...values((p) => p.sample.precipProbabilityPct));

  const temp =
    feelsF === null ? 'Mild'
    : feelsF < 60 ? 'Cool'
    : feelsF < 68 ? 'Mild'
    : feelsF < 80 ? 'Comfortable'
    : feelsF < 88 ? 'Warm'
    : feelsF < 95 ? 'Hot'
    : 'Very hot';
  const uv = `${uvLevel(uvMax)} UV`;
  const wind = windMph < 8 ? 'light wind' : windMph < 14 ? 'a steady breeze' : 'strong wind';

  // The Southern California classic: a gray morning that clears by lunch.
  const morning = day.points.filter((p) => hourBetween(p, 7, 10));
  const morningCloud = mean(morning.flatMap((p) => (p.sample.cloudCoverPct === null ? [] : [p.sample.cloudCoverPct])));
  const burnoff =
    morningCloud !== null && morningCloud >= 75 && cloud <= 50
      ? day.points.find((p) => hourBetween(p, 9, 15) && (p.sample.cloudCoverPct ?? 100) < 50)
      : undefined;

  let text: string;
  if (rain >= 40) {
    text = `${temp} with a ${Math.round(rain / 10) * 10}% chance of rain this afternoon.`;
  } else if (burnoff) {
    text = `Marine layer burns off around ${formatClock(roundTo(burnoff.ms, 30 * MINUTE_MS), tz)} to a ${temp.toLowerCase()} afternoon with ${uv} and ${wind}.`;
  } else {
    const sky = cloud < 25 ? ', sunny' : cloud < 50 ? ', mostly sunny' : cloud < 80 ? ', partly cloudy' : ', overcast';
    text = `${temp}${sky} afternoon with ${uv} and ${wind}.`;
  }
  if (day !== today) text = `Tomorrow: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;

  const peakUv = focus.reduce<ForecastPoint | null>(
    (best, p) => ((p.sample.uvIndex ?? 0) > (best?.sample.uvIndex ?? 0) ? p : best),
    null,
  );
  const note =
    uvMax >= 6 && peakUv
      ? `UV peaks at ${Math.round(uvMax)} around ${formatClock(roundTo(peakUv.ms, 60 * MINUTE_MS), tz)}. Bring shade.`
      : null;
  return { label: qualityLabel(Math.max(0, ...focus.map((p) => p.scores.beach.score))), text, note };
}

export function verdict(core: AnalysisCore): Verdict {
  const tz = core.beach.timezone;
  const { surf, run, beach } = core.now.scores;
  const up = core.upcoming;
  const temp = fahrenheit(core.now.sample.airTempC);
  const tempText = temp === null ? '' : `${temp}°`;

  if (!isDaylight(core)) {
    const next = up.surf;
    const when = next ? whenPhrase(next.window.startMs, next.dayOffset, tz) : 'Tomorrow';
    if (next && next.window.peakScore >= 45) {
      return {
        tone: 'maybe',
        eyebrow: when,
        headline: `${surfRating(next.window.peakScore).label} surf from ${formatClock(next.window.startMs, tz)}`,
        activity: 'surf',
      };
    }
    const sunrise = core.days[1]?.sun.sunrise;
    return {
      tone: 'wait',
      eyebrow: 'Quiet night',
      headline: sunrise ? `Small surf tomorrow · sunrise ${formatClock(sunrise, tz)}` : 'Small surf tomorrow',
      activity: null,
    };
  }

  if (surf.score >= GOOD_SURF_SCORE) {
    const until = up.surf?.active ? ` until ${formatClock(up.surf.window.endMs, tz)}` : '';
    const messy = TEXTURE_RANK[texture(surf.wind)] >= 2;
    // Enough size to ride, but say so plainly when the wind has roughed it up.
    return {
      tone: messy ? 'maybe' : 'go',
      eyebrow: messy ? 'Rideable, not pretty' : 'Worth going',
      headline: `${cap(texture(surf.wind))}, ${sizePhrase(surf.surf)}${until}`,
      activity: 'surf',
    };
  }
  if (up.surf && up.surf.dayOffset === 0 && !up.surf.active && up.surf.window.peakScore >= GOOD_SURF_SCORE) {
    return {
      tone: 'maybe',
      eyebrow: 'Worth waiting',
      headline: `Surf lines up ${range(up.surf, core)}`,
      activity: 'surf',
    };
  }
  if (beach.score >= 70) {
    return {
      tone: 'go',
      eyebrow: 'Good beach day',
      headline: `${tempText} and ${surf.surf.maxFt === 0 ? 'flat' : sizePhrase(surf.surf)} surf`.trim(),
      activity: 'beach',
    };
  }
  if (run.score >= 75) {
    return { tone: 'go', eyebrow: 'Go for a run', headline: `${tempText} with ${windPhrase(surf.wind)}`.trim(), activity: 'run' };
  }
  if (up.beach && up.beach.dayOffset === 0 && !up.beach.active) {
    return {
      tone: 'maybe',
      eyebrow: 'Better later',
      headline: `Beach weather from ${formatClock(up.beach.window.startMs, tz)}`,
      activity: 'beach',
    };
  }
  return {
    tone: 'wait',
    eyebrow: 'Mellow day',
    headline: `${cap(surf.surf.maxFt === 0 ? 'flat' : sizePhrase(surf.surf))} and ${texture(surf.wind)}${tempText ? ` · ${tempText}` : ''}`,
    activity: null,
  };
}

export function qualityLabel(score: number): string {
  if (score >= 82) return 'Great';
  if (score >= 65) return 'Good';
  if (score >= 45) return 'Fair';
  return 'Poor';
}

/** The first point later today (before sunset) where `test` holds for at least an hour straight. */
function firstChange(core: AnalysisCore, test: (p: ForecastPoint) => boolean): ForecastPoint | null {
  const today = core.days[0];
  if (!today) return null;
  const ahead = core.points.filter((p) => p.ms > core.now.ms && p.ms <= today.sun.sunset);
  for (let i = 0; i < ahead.length; i++) {
    if (ahead.slice(i, i + 4).length === 4 && ahead.slice(i, i + 4).every(test)) return ahead[i]!;
  }
  return null;
}

function lowTideNote(core: AnalysisCore, w: WindowInsight): string | null {
  const low = core.conditions.tide.extremes.find(
    (e) => e.type === 'low' && e.ms >= w.window.startMs - 60 * MINUTE_MS && e.ms <= w.window.endMs + 30 * MINUTE_MS,
  );
  return low ? `Low tide at ${formatClock(low.ms, core.beach.timezone)}: firm sand along the water.` : null;
}
