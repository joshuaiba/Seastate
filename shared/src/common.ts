/**
 * An ISO-8601 timestamp in UTC, e.g. "2026-09-26T04:56:00.000Z".
 * Everything the API returns is in UTC; convert to the beach's timezone only for display.
 */
export type IsoTime = string;

/** A value and the time it was observed. */
export interface Reading<T = number> {
  value: T;
  time: IsoTime;
}

/** Where the server gets its data: live NOAA requests, or responses captured in server/fixtures. */
export type DataMode = 'live' | 'fixture';

/** A station in one of the upstream networks. */
export interface StationRef {
  id: string;
  name: string;
}
