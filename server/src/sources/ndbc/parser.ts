import {
  isCompassPoint,
  type BuoyObservation,
  type CompassPoint,
  type IsoTime,
  type WaveSteepness,
  type WaveSummary,
} from '@seastate/shared';

/*
 * NDBC realtime2 text files
 * -------------------------
 * Every NDBC station publishes its last 45 days of observations as plain text at
 *   https://www.ndbc.noaa.gov/data/realtime2/<STATION>.<ext>
 * This module parses two of them (field definitions: https://www.ndbc.noaa.gov/faq/measdes.shtml):
 *   .txt   standard meteorological data: wind, waves, pressure, air and water temperature
 *   .spec  spectral wave summary: the sea state split into swell and wind waves
 *
 * Both share one layout: two header lines, then one row per observation, NEWEST FIRST.
 *
 *   #YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
 *   #yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
 *   2026 09 26 04 56  MM   MM   MM   0.7    13   4.4 198     MM    MM  22.6    MM   MM   MM    MM
 *
 * - Line 1 names the columns and line 2 gives their units. Both start with "#".
 * - The first five columns are the observation time in UTC: year, month, day, hour, minute.
 * - The file looks fixed-width, but every cell is always filled in: a missing value is written as "MM".
 *   So splitting each line on whitespace is reliable. Columns are looked up by header name rather than
 *   position, so stations with extra or fewer columns still parse.
 * - Other placeholders show up in practice too: "N/A" in .spec text columns, and out-of-range numbers
 *   such as -99 for a missing direction. Those are treated as missing.
 * - Stations only fill in the columns they have sensors for. A CDIP wave buoy, for example, reports
 *   waves and water temperature but writes MM in every wind column.
 */

/** An NDBC realtime2 file split into cells. Rows are oldest first. */
export interface NdbcTable {
  columns: string[];
  units: string[];
  rows: NdbcRow[];
  /** Data lines that couldn't be read: the wrong number of cells, or a bad timestamp. */
  skippedLines: number;
}

export interface NdbcRow {
  time: IsoTime;
  /** Raw cell text by column name, e.g. { WVHT: "0.7", WDIR: "MM" }. */
  cells: Record<string, string>;
}

const MISSING = new Set(['MM', 'N/A']);
const FEET_TO_METERS = 0.3048;

export function parseNdbcTable(text: string): NdbcTable {
  const lines = text.split(/\r?\n/);
  const [columnLine, unitLine] = lines.filter((line) => line.startsWith('#'));
  if (!columnLine) throw new Error('Not an NDBC realtime file: no "#" header line');
  const columns = splitHeader(columnLine);
  const units = unitLine ? splitHeader(unitLine) : [];

  const rows: NdbcRow[] = [];
  let skippedLines = 0;
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const values = line.trim().split(/\s+/);
    if (values.length !== columns.length) {
      skippedLines++;
      continue;
    }
    const cells = Object.fromEntries(columns.map((column, i) => [column, values[i]!]));
    const time = parseTime(cells);
    if (time === null) {
      skippedLines++;
      continue;
    }
    rows.push({ time, cells });
  }

  rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return { columns, units, rows, skippedLines };
}

/** Parses realtime2/<STATION>.txt (standard meteorological data). SI units, oldest first. */
export function parseStandardMet(text: string): BuoyObservation[] {
  return parseNdbcTable(text).rows.map((row) => {
    const tideFt = numberCell(row, 'TIDE');
    return {
      time: row.time,
      windDirDeg: numberCell(row, 'WDIR', 'degrees'),
      windSpeedMps: numberCell(row, 'WSPD', 'nonNegative'),
      windGustMps: numberCell(row, 'GST', 'nonNegative'),
      waveHeightM: numberCell(row, 'WVHT', 'nonNegative'),
      dominantPeriodS: numberCell(row, 'DPD', 'nonNegative'),
      averagePeriodS: numberCell(row, 'APD', 'nonNegative'),
      meanWaveDirDeg: numberCell(row, 'MWD', 'degrees'),
      pressureHpa: numberCell(row, 'PRES', 'nonNegative'),
      airTempC: numberCell(row, 'ATMP'),
      waterTempC: numberCell(row, 'WTMP'),
      dewPointC: numberCell(row, 'DEWP'),
      visibilityNmi: numberCell(row, 'VIS', 'nonNegative'),
      pressureTendencyHpa: numberCell(row, 'PTDY'),
      tideM: tideFt === null ? null : Math.round(tideFt * FEET_TO_METERS * 1000) / 1000,
    };
  });
}

/** Parses realtime2/<STATION>.spec (spectral wave summary). SI units, oldest first. */
export function parseWaveSummary(text: string): WaveSummary[] {
  return parseNdbcTable(text).rows.map((row) => ({
    time: row.time,
    significantHeightM: numberCell(row, 'WVHT', 'nonNegative'),
    swellHeightM: numberCell(row, 'SwH', 'nonNegative'),
    swellPeriodS: numberCell(row, 'SwP', 'nonNegative'),
    swellDir: compassCell(row, 'SwD'),
    windWaveHeightM: numberCell(row, 'WWH', 'nonNegative'),
    windWavePeriodS: numberCell(row, 'WWP', 'nonNegative'),
    windWaveDir: compassCell(row, 'WWD'),
    steepness: steepnessCell(row),
    averagePeriodS: numberCell(row, 'APD', 'nonNegative'),
    meanWaveDirDeg: numberCell(row, 'MWD', 'degrees'),
  }));
}

function splitHeader(line: string): string[] {
  return line.replace(/^#/, '').trim().split(/\s+/);
}

/** The row's UTC time from its YY MM DD hh mm cells. (YY holds a four-digit year despite its name.) */
function parseTime(cells: Record<string, string>): IsoTime | null {
  const [year = NaN, month = NaN, day = NaN, hour = NaN, minute = NaN] = ['YY', 'MM', 'DD', 'hh', 'mm'].map(
    (column) => Number(cells[column]),
  );
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

type NumberKind = 'any' | 'nonNegative' | 'degrees';

/** A numeric cell, or null if it's missing, unparseable, or physically impossible for its kind. */
function numberCell(row: NdbcRow, column: string, kind: NumberKind = 'any'): number | null {
  const raw = row.cells[column];
  if (raw === undefined || MISSING.has(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (kind === 'nonNegative' && value < 0) return null;
  if (kind === 'degrees' && (value < 0 || value > 360)) return null;
  return value;
}

function compassCell(row: NdbcRow, column: string): CompassPoint | null {
  const raw = row.cells[column];
  return raw !== undefined && isCompassPoint(raw) ? raw : null;
}

const STEEPNESS = new Set<string>(['SWELL', 'AVERAGE', 'STEEP', 'VERY_STEEP'] satisfies WaveSteepness[]);

function steepnessCell(row: NdbcRow): WaveSteepness | null {
  const raw = row.cells.STEEPNESS;
  return raw !== undefined && STEEPNESS.has(raw) ? (raw as WaveSteepness) : null;
}
