import {
  API_ROUTES,
  type ApiErrorBody,
  type LocationInfo,
  type SourceId,
  type SourceResponse,
} from '@seastate/shared';

// The browser only ever calls this app's own /api. The server is what talks to NOAA.

export function fetchLocation(signal?: AbortSignal): Promise<LocationInfo> {
  return getJson(API_ROUTES.location, signal);
}

export function fetchSource<K extends SourceId>(id: K, signal?: AbortSignal): Promise<SourceResponse<K>> {
  return getJson(API_ROUTES.defaultSource(id), signal);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? `${response.status} ${response.statusText} from ${path}`);
  }
  return (await response.json()) as T;
}
