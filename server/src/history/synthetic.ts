import type { BeachConfig, HistoricalObservation } from '@seastate/shared';
import { zonedParts } from '@seastate/shared';
import { DAY_MS, HOUR_MS } from '../lib/time';

/*
 * Synthetic history: plausible hourly conditions for a beach, built from Southern California
 * climatology. It stands in until SeaState has recorded a year of its own observations, and
 * everything downstream of it (summaries, charts) is the same code that real records will use.
 *
 * What it models, roughly as the Southern California Bight behaves:
 *   - Swell: Southern Hemisphere groundswell (S–SSW, long period) mostly April–October, North Pacific
 *     swell (W–WNW) mostly November–March, each arriving as multi-day events on top of a background.
 *     Periods run long at the start of an event and shorten as it fades, as real swell does.
 *   - Wind: light land breeze overnight and early morning, an onshore sea breeze building to a mid-
 *     afternoon peak, and occasional Santa Ana (offshore, northeast) events from fall into winter.
 *   - Water: ~58°F in late winter to ~69°F in August, with multi-day warm and cold spells.
 *   - Tide: the four main constituents of the Los Angeles tide, mixed semidiurnal like the real one.
 *
 * The ocean is regional, so the swell, wind, and water are generated from one shared seed: every
 * beach sees the same swell on the same day, and differs only through its SurfProfile (a sheltered
 * beach records smaller surf from the same swell). The result is deterministic: the same dates always
 * come out the same.
 */

/** Everything is generated forward from here, so any given date always gets the same weather. */
const EPOCH = Date.UTC(2024, 0, 1);
const REGION_SEED = 0x5ea57a7e;

interface SwellEvent {
  startMs: number;
  peakMs: number;
  endMs: number;
  peakHeightM: number;
  periodS: number;
  dirDeg: number;
}

interface DayState {
  waterAnomalyC: number;
  airAnomalyC: number;
  santaAna: boolean;
  storm: boolean;
}

export function synthesizeObservations(beach: BeachConfig, fromMs: number, toMs: number): HistoricalObservation[] {
  const rand = mulberry32(REGION_SEED);
  const beachSeed = REGION_SEED ^ hash(beach.id);
  const start = Math.max(EPOCH, Math.floor(fromMs / HOUR_MS) * HOUR_MS);
  const end = Math.floor(toMs / HOUR_MS) * HOUR_MS;

  // Day-by-day regional state, generated from the epoch so every request agrees on the past.
  const days: DayState[] = [];
  const southEvents: SwellEvent[] = [];
  const westEvents: SwellEvent[] = [];
  let waterAnomaly = 0;
  let airAnomaly = 0;
  let santaAnaDaysLeft = 0;
  let stormDaysLeft = 0;
  const dayCount = Math.ceil((end - EPOCH) / DAY_MS) + 1;

  for (let d = 0; d < dayCount; d++) {
    const dayMs = EPOCH + d * DAY_MS;
    const doy = dayOfYear(dayMs);
    const summer = seasonal(doy, 200);
    const winter = seasonal(doy, 15);

    waterAnomaly = waterAnomaly * 0.93 + gaussian(rand) * 0.35;
    airAnomaly = airAnomaly * 0.8 + gaussian(rand) * 1.2;

    if (rand() < 0.1 * (0.35 + 0.65 * summer)) {
      southEvents.push(swellEvent(rand, dayMs, 0.6 + rand() * 1.1, 14 + rand() * 5, 185 + rand() * 30));
    }
    if (rand() < 0.12 * (0.3 + 0.7 * winter)) {
      const event = swellEvent(rand, dayMs, 0.8 + rand() * 1.6, 12 + rand() * 5, 262 + rand() * 38);
      westEvents.push(event);
      if (event.peakHeightM > 1.9 && rand() < 0.4) stormDaysLeft = 1;
    }
    const month = new Date(dayMs).getUTCMonth();
    if (santaAnaDaysLeft === 0 && (month >= 9 || month <= 1) && rand() < 0.035) {
      santaAnaDaysLeft = 1 + Math.floor(rand() * 3);
    }

    days.push({
      waterAnomalyC: waterAnomaly,
      airAnomalyC: airAnomaly,
      santaAna: santaAnaDaysLeft > 0,
      storm: stormDaysLeft > 0,
    });
    santaAnaDaysLeft = Math.max(0, santaAnaDaysLeft - 1);
    stormDaysLeft = Math.max(0, stormDaysLeft - 1);
  }

  // Sheltered beaches are shallower and warmer.
  const waterOffsetC = (1 - beach.surf.exposure) * 1.0;
  const rows: HistoricalObservation[] = [];

  for (let ms = start; ms <= end; ms += HOUR_MS) {
    const day = days[Math.floor((ms - EPOCH) / DAY_MS)];
    if (!day) continue;
    const doy = dayOfYear(ms);
    const summer = seasonal(doy, 200);
    const winter = seasonal(doy, 15);
    const hour = zonedParts(ms, beach.timezone).hour;

    const south = swellAt(southEvents, ms, 0.22 + 0.2 * summer, 12.5, 195);
    const west = swellAt(westEvents, ms, 0.28 + 0.32 * winter, 10.5, 278);
    const [primary, secondary] = south.heightM >= west.heightM ? [south, west] : [west, south];

    // Local gusts differ a little between beaches; seeded per hour so any hour always comes out the same.
    const wind = windAt(hour, day, summer, mulberry32(beachSeed ^ Math.floor(ms / HOUR_MS)));
    const onshore = wind.dirDeg > 190 && wind.dirDeg < 310;
    const windWaveHeightM = Math.max(0.05, 0.06 * wind.speedMps + (onshore ? 0.05 : 0));

    const waterTempC =
      17.5 + 3.3 * Math.cos((2 * Math.PI * (doy - 225)) / 365) + day.waterAnomalyC + waterOffsetC +
      0.15 * Math.sin((2 * Math.PI * (hour - 10)) / 24);
    const airTempC =
      19 + 4 * Math.cos((2 * Math.PI * (doy - 230)) / 365) + day.airAnomalyC + (day.santaAna ? 6 : 0) +
      3.5 * Math.sin((2 * Math.PI * (hour - 9)) / 24);

    rows.push({
      time: new Date(ms).toISOString(),
      swellHeightM: round(primary.heightM),
      swellPeriodS: round(primary.periodS, 1),
      swellDirDeg: Math.round(primary.dirDeg),
      secondarySwellHeightM: round(secondary.heightM),
      secondarySwellPeriodS: round(secondary.periodS, 1),
      secondarySwellDirDeg: Math.round(secondary.dirDeg),
      windWaveHeightM: round(windWaveHeightM),
      windWavePeriodS: round(2.5 + 0.45 * wind.speedMps, 1),
      windWaveDirDeg: Math.round(wind.dirDeg),
      windSpeedMps: round(wind.speedMps, 1),
      windDirDeg: Math.round(wind.dirDeg),
      waterTempC: round(waterTempC, 1),
      airTempC: round(airTempC, 1),
      tideM: round(tideAt(ms)),
    });
  }
  return rows;
}

function swellEvent(rand: () => number, dayMs: number, peakHeightM: number, periodS: number, dirDeg: number): SwellEvent {
  const startMs = dayMs + Math.floor(rand() * 24) * HOUR_MS;
  const peakMs = startMs + (18 + rand() * 18) * HOUR_MS;
  return { startMs, peakMs, endMs: peakMs + (36 + rand() * 60) * HOUR_MS, peakHeightM, periodS, dirDeg };
}

/** Background swell plus every active event, as one train (the biggest event sets period and direction). */
function swellAt(events: readonly SwellEvent[], ms: number, backgroundM: number, backgroundPeriodS: number, backgroundDir: number) {
  let energy = backgroundM ** 2;
  let lead = { heightM: backgroundM, periodS: backgroundPeriodS, dirDeg: backgroundDir };
  for (const e of events) {
    if (ms < e.startMs || ms > e.endMs) continue;
    const rising = ms < e.peakMs;
    const t = rising ? (ms - e.startMs) / (e.peakMs - e.startMs) : (ms - e.peakMs) / (e.endMs - e.peakMs);
    const heightM = e.peakHeightM * (rising ? Math.sin((t * Math.PI) / 2) : (1 - t) ** 1.5);
    energy += heightM ** 2;
    if (heightM > lead.heightM) {
      // The long-period forerunners arrive first; period drops by a few seconds over the event.
      const progress = (ms - e.startMs) / (e.endMs - e.startMs);
      lead = { heightM, periodS: e.periodS + 2 - 4 * progress, dirDeg: e.dirDeg };
    }
  }
  return { ...lead, heightM: Math.sqrt(energy) };
}

function windAt(hour: number, day: DayState, summer: number, noise: () => number): { speedMps: number; dirDeg: number } {
  const jitter = () => (noise() - 0.5) * 2;
  if (day.santaAna) {
    return { speedMps: Math.max(0.5, (hour < 12 ? 8 : 5.5) + jitter() * 2), dirDeg: 40 + jitter() * 18 };
  }
  if (day.storm) return { speedMps: Math.max(1, 8.5 + jitter() * 2.5), dirDeg: 285 + jitter() * 15 };
  if (hour < 9) return { speedMps: Math.max(0.2, 1.1 + jitter() * 0.8), dirDeg: 50 + jitter() * 35 };
  if (hour < 11) return { speedMps: Math.max(0.2, 1.6 + jitter() * 0.9), dirDeg: 190 + jitter() * 60 };
  if (hour < 19) {
    // Sea breeze: builds from late morning, peaks mid-afternoon, stronger in spring and summer.
    const shape = Math.sin((Math.PI * (hour - 10)) / 10);
    return { speedMps: Math.max(0.5, (3.2 + 2.2 * summer) * shape + 0.8 + jitter()), dirDeg: 248 + jitter() * 20 };
  }
  return { speedMps: Math.max(0.2, 2 - (hour - 19) * 0.25 + jitter() * 0.6), dirDeg: 285 + jitter() * 30 };
}

/** Mixed semidiurnal tide from the main Los Angeles constituents, m above MLLW. */
function tideAt(ms: number): number {
  const hours = (ms - EPOCH) / HOUR_MS;
  const c = (amplitude: number, speedDegPerHour: number, phaseDeg: number) =>
    amplitude * Math.cos(((speedDegPerHour * hours - phaseDeg) * Math.PI) / 180);
  return 0.84 + c(0.51, 28.984, 160) + c(0.21, 30.0, 150) + c(0.35, 15.041, 210) + c(0.22, 13.943, 205);
}

/** 1 at `peakDoy`, 0 half a year away. */
function seasonal(doy: number, peakDoy: number): number {
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * (doy - peakDoy)) / 365);
}

function dayOfYear(ms: number): number {
  const date = new Date(ms);
  return (ms - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Deterministic PRNG, so a date always generates the same conditions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
