import type { BuoyObservation, DataMode, WaveSummary } from '@seastate/shared';
import { loadRows, type Upstream } from '../../lib/upstream';
import { parseStandardMet, parseWaveSummary } from './parser';

/*
 * NOAA National Data Buoy Center (NDBC) client.
 * Files: https://www.ndbc.noaa.gov/data/realtime2/   About: https://www.ndbc.noaa.gov/faq/rt_data_access.shtml
 * No API key. A file is regenerated as new observations arrive (every 10 to 60 minutes, depending on
 * the station) and always holds 45 days, so fetch sparingly. NDBC itself sends Cache-Control:
 * max-age=600. Responses have no CORS headers, so a browser can't read them directly.
 */

const REALTIME2 = 'https://www.ndbc.noaa.gov/data/realtime2';

export interface NdbcFetchOptions {
  /** "fixture" reads server/fixtures/ndbc/ instead of calling NDBC. Default "live". */
  mode?: DataMode;
}

/** Standard meteorological observations (wind, waves, pressure, temperatures): 45 days, oldest first. */
export function fetchStandardMet(stationId: string, { mode = 'live' }: NdbcFetchOptions = {}): Promise<BuoyObservation[]> {
  return loadRows(realtimeFile(stationId, 'txt'), mode, parseStandardMet);
}

/** Spectral wave summary (swell vs. wind waves): 45 days, oldest first. Only wave-measuring stations have one. */
export function fetchWaveSummary(stationId: string, { mode = 'live' }: NdbcFetchOptions = {}): Promise<WaveSummary[]> {
  return loadRows(realtimeFile(stationId, 'spec'), mode, parseWaveSummary);
}

/** Station IDs are upper-case in realtime2 file names (e.g. LJPC1.txt). */
function realtimeFile(stationId: string, extension: 'txt' | 'spec'): Upstream {
  const file = `${stationId.toUpperCase()}.${extension}`;
  return { url: `${REALTIME2}/${file}`, fixture: `ndbc/${file}` };
}
