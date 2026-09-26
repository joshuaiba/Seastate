import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IsoTime } from '@seastate/shared';
import { FIXTURES_DIR } from '../paths';
import { HOUR_MS } from './time';

/*
 * Offline ("fixture") mode
 *
 * `npm run fixtures` saves raw NOAA responses for the configured stations to server/fixtures/, with a
 * manifest recording when they were captured. With SEASTATE_DATA_MODE=fixture the server reads those
 * files instead of calling NOAA and runs them through the same parsers. It then shifts every
 * timestamp forward by a whole number of hours so the newest reading is less than an hour old. That
 * keeps "last 48 hours" windows, "now" markers, and "updated N minutes ago" labels working while you
 * build the UI offline. The values are real; only the dates move.
 */

export const MANIFEST_FILE = 'manifest.json';

export interface FixtureManifest {
  capturedAt: IsoTime;
  stations: { ndbc: string; coops: string };
}

/** Reads a file from server/fixtures, with a helpful error if it hasn't been captured yet. */
export async function readFixture(relativePath: string): Promise<string> {
  try {
    return await readFile(path.join(FIXTURES_DIR, relativePath), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No fixture at server/fixtures/${relativePath}. Run \`npm run fixtures\` while online to capture data for the configured stations.`,
      );
    }
    throw error;
  }
}

/** Shifts fixture rows forward by whole hours so the capture time lands within the hour before `now`. */
export async function retimeFixture<T extends { time: IsoTime }>(rows: T[], now = Date.now()): Promise<T[]> {
  const manifest = JSON.parse(await readFixture(MANIFEST_FILE)) as FixtureManifest;
  const offsetMs = Math.max(0, Math.floor((now - Date.parse(manifest.capturedAt)) / HOUR_MS) * HOUR_MS);
  return rows.map((row) => ({ ...row, time: new Date(Date.parse(row.time) + offsetMs).toISOString() }));
}
