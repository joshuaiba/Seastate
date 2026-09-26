import type {
  IsoTime,
  TideExtreme,
  TidePoint,
  WaterLevelObservation,
  WaterTempObservation,
  WindObservation,
} from '@seastate/shared';

/*
 * NOAA CO-OPS Data API responses
 * ------------------------------
 * GET https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=...&station=...&begin_date=...
 * (parameters: https://api.tidesandcurrents.noaa.gov/api/prod/). The JSON is clean, with a few quirks:
 *
 * - Numbers are strings ("1.691"), and a missing value is an empty string.
 * - Timestamps look like "2026-09-26 05:24" with no offset. They're in whatever `time_zone` the request
 *   asked for; we always ask for GMT, so appending "Z" is safe.
 * - Errors often come back as HTTP 200 with {"error": {"message": "..."}}, e.g. when asking for water
 *   temperature at a station with no temperature sensor. Always check for `error` before reading data.
 * - Predictions arrive as {"predictions": [...]}; observations as {"metadata": {...}, "data": [...]}.
 *
 * Row fields by product, with units=metric:
 *   predictions (interval=hilo)  t, v = height (m), type = "H" | "L"
 *   predictions (interval=6)     t, v = height (m)
 *   water_level                  t, v = height (m), s = std. deviation of the 1-second samples,
 *                                f = QC flags, q = "p" (preliminary) | "v" (verified)
 *   water_temperature            t, v = °C, f = QC flags
 *   wind                         t, s = speed (m/s), d = direction FROM (degrees true),
 *                                dr = compass point, g = gust (m/s), f = QC flags
 * Heights are relative to the `datum` in the request. With MLLW, the default, 0 is the average of each
 * day's lower low tide, so negative values are unusually low tides.
 */

interface PredictionRow {
  t: string;
  v: string;
  type?: string;
}

interface WaterLevelRow {
  t: string;
  v: string;
  q?: string;
}

interface WaterTempRow {
  t: string;
  v: string;
}

interface WindRow {
  t: string;
  s: string;
  d: string;
  g: string;
}

export function parseTideExtremes(body: string): TideExtreme[] {
  return rowsOf<PredictionRow>(body, 'predictions').flatMap((row): TideExtreme[] => {
    const heightM = numeric(row.v);
    // Predictions use H and L. (The observed high_low product also has HH and LL: higher high, lower low.)
    const type = row.type?.startsWith('H') ? 'high' : row.type?.startsWith('L') ? 'low' : null;
    return heightM === null || type === null ? [] : [{ time: parseCoopsTime(row.t), heightM, type }];
  });
}

export function parseTideCurve(body: string): TidePoint[] {
  return rowsOf<PredictionRow>(body, 'predictions').flatMap((row): TidePoint[] => {
    const heightM = numeric(row.v);
    return heightM === null ? [] : [{ time: parseCoopsTime(row.t), heightM }];
  });
}

export function parseWaterLevel(body: string): WaterLevelObservation[] {
  return rowsOf<WaterLevelRow>(body, 'data').map(
    (row): WaterLevelObservation => ({
      time: parseCoopsTime(row.t),
      heightM: numeric(row.v),
      quality: row.q === 'v' ? 'verified' : 'preliminary',
    }),
  );
}

export function parseWaterTemperature(body: string): WaterTempObservation[] {
  return rowsOf<WaterTempRow>(body, 'data').map((row) => ({
    time: parseCoopsTime(row.t),
    tempC: numeric(row.v),
  }));
}

export function parseWind(body: string): WindObservation[] {
  return rowsOf<WindRow>(body, 'data').map((row) => ({
    time: parseCoopsTime(row.t),
    speedMps: numeric(row.s),
    gustMps: numeric(row.g),
    dirDeg: numeric(row.d),
  }));
}

/** "2026-09-26 05:24" (GMT) → "2026-09-26T05:24:00.000Z" */
export function parseCoopsTime(t: string): IsoTime {
  // Matched explicitly because Date.parse is lenient enough to accept garbage.
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(t.trim());
  if (!match) throw new Error(`Unrecognized CO-OPS timestamp "${t}"`);
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
}

/** "1.691" → 1.691; "" (missing) → null */
function numeric(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parses a response body and returns its row array, throwing CO-OPS's own error message if it sent one. */
function rowsOf<Row>(body: string, key: 'predictions' | 'data'): Row[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`CO-OPS returned something other than JSON: ${body.slice(0, 100)}`);
  }
  if (typeof json !== 'object' || json === null) throw new Error('CO-OPS returned an unexpected response');

  const response = json as { error?: { message?: string }; predictions?: unknown; data?: unknown };
  if (response.error) throw new Error(`CO-OPS: ${response.error.message?.trim() || 'unknown error'}`);
  const rows = response[key];
  if (!Array.isArray(rows)) throw new Error(`CO-OPS response has no "${key}" array`);
  return rows as Row[];
}
