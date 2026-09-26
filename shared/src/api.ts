import type { DataMode, IsoTime, StationRef } from './common';
import type { CoopsPayload } from './coops';
import type { NdbcPayload } from './ndbc';

/**
 * Every data source the server proxies, keyed by id, with the payload its endpoint returns.
 * To add a source, add an entry here, then write and register a loader in server/src/sources/.
 */
export interface SourcePayloads {
  ndbc: NdbcPayload;
  coops: CoopsPayload;
}

export type SourceId = keyof SourcePayloads;

/** Response of GET /api/sources/:id. */
export interface SourceResponse<K extends SourceId = SourceId> {
  source: K;
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
  location: '/api/location',
  source: (id: SourceId) => `/api/sources/${id}`,
} as const;
