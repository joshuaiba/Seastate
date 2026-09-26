import type { DataMode, IsoTime, StationRef } from './common';
import type { CoopsPayload } from './coops';
import type { NdbcPayload } from './ndbc';
import type { OpenMeteoPayload } from './openmeteo';

/**
 * Every data source the server proxies, keyed by id, with the payload its endpoint returns.
 * To add a source, add an entry here, then write and register a loader in server/src/sources/.
 */
export interface SourcePayloads {
  ndbc: NdbcPayload;
  coops: CoopsPayload;
  openmeteo: OpenMeteoPayload;
}

export type SourceId = keyof SourcePayloads;

/** Response of GET /api/beaches/:beach/sources/:id. */
export interface SourceResponse<K extends SourceId = SourceId> {
  source: K;
  /** The beach this data was loaded for. Beaches that share a station share its cached data. */
  beachId: string;
  station: StationRef;
  mode: DataMode;
  /** When the server fetched this data from upstream. If products were cached separately, the oldest. */
  fetchedAt: IsoTime;
  /** Non-fatal problems, such as a product this station doesn't offer. That payload field will be null. */
  warnings: string[];
  data: SourcePayloads[K];
}

/** Body of every non-2xx /api response. */
export interface ApiErrorBody {
  error: { message: string };
}

export const API_ROUTES = {
  health: '/api/health',
  beaches: '/api/beaches',
  source: (beachId: string, id: SourceId) => `/api/beaches/${encodeURIComponent(beachId)}/sources/${id}`,
  /** The original single-beach routes. They answer for the default (first) beach. */
  location: '/api/location',
  defaultSource: (id: SourceId) => `/api/sources/${id}`,
} as const;
