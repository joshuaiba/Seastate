import { useEffect, useState } from 'react';
import { latestReadings, type IsoTime, type LocationInfo, type SourceResponse } from '@seastate/shared';
import { fetchLocation, fetchSource } from './api';

/*
 * "Hello data" page. It proves the whole pipeline works:
 *   browser → /api (Vite's dev proxy, or Express in production) → server cache → NOAA → parsers → here
 *
 * TODO(ui): Replace this page with the dashboard. It's deliberately bare: no layout, styling, or charts.
 */

interface PageData {
  location: LocationInfo;
  ndbc: SourceResponse<'ndbc'> | Error;
  coops: SourceResponse<'coops'> | Error;
}

export function App() {
  const [page, setPage] = useState<PageData>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [refreshes, setRefreshes] = useState(0);

  // TODO(ui): Poll every few minutes so the page stays current while it's left open. The server caches
  // upstream calls, so polling /api is cheap. A data-fetching library such as TanStack Query would also
  // handle retries and stale data.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    loadPage(signal)
      .then((data) => {
        if (signal.aborted) return;
        setPage(data);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!signal.aborted) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshes]);

  return (
    <main>
      <h1>Seastate</h1>
      {/* TODO(ui): Header with the beach name, local time, "updated N minutes ago", and a fixture-mode badge. */}
      <button type="button" onClick={() => setRefreshes((n) => n + 1)} disabled={loading}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
      {error && <pre>Could not reach the API: {error.message}</pre>}
      {page && <HelloData page={page} />}
    </main>
  );
}

function HelloData({ page }: { page: PageData }) {
  const { location, ndbc, coops } = page;
  return (
    <>
      <p>
        {location.name}, {location.region}. Data mode: {location.mode}. All times are UTC.
      </p>

      <h2>Current readings</h2>
      <pre>{JSON.stringify(currentReadings(page), null, 2)}</pre>

      {/*
        TODO(ui): Current-conditions panel: wave height, period, and direction; swell; water temperature;
        wind; tide now and next. Unit helpers are in @seastate/shared (metersToFeet, celsiusToFahrenheit,
        mpsToKnots, degreesToCompass).

        TODO(charts): Recharts is installed. Planned views and the data for each:
          - Wave height and period over time: ndbc.data.observations
          - Swell vs. wind waves: ndbc.data.waveSummary
          - Tide curve with high/low labels and a "now" line: coops.data.tideCurve + coops.data.tideExtremes
          - Water temperature, buoy vs. pier: ndbc.data.observations (waterTempC) + coops.data.waterTemperature
          - Wind speed, gusts, and direction: coops.data.wind

        TODO(style): Layout, typography, and theming.
      */}

      <h2>Raw API responses</h2>
      <RawJson label="GET /api/location" value={location} />
      <RawJson label="GET /api/sources/ndbc" value={ndbc} />
      <RawJson label="GET /api/sources/coops" value={coops} />
    </>
  );
}

function RawJson({ label, value }: { label: string; value: unknown }) {
  return (
    <details>
      <summary>{label}</summary>
      <pre>{value instanceof Error ? `Error: ${value.message}` : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

async function loadPage(signal: AbortSignal): Promise<PageData> {
  // One failing source shouldn't hide the other, so source errors are kept as values.
  const [location, ndbc, coops] = await Promise.all([
    fetchLocation(signal),
    fetchSource('ndbc', signal).catch(asError),
    fetchSource('coops', signal).catch(asError),
  ]);
  return { location, ndbc, coops };
}

/** The latest value of each reading, pulled out of the API responses. */
function currentReadings({ ndbc, coops }: PageData) {
  const now = new Date().toISOString();
  return {
    buoy:
      ndbc instanceof Error
        ? { error: ndbc.message }
        : {
            ...ndbc.data.latest,
            waveSummary: ndbc.data.waveSummary?.at(-1) ?? null,
            warnings: ndbc.warnings,
          },
    tideStation:
      coops instanceof Error
        ? { error: coops.message }
        : {
            waterLevel: latestOf(coops.data.waterLevel),
            waterTemperature: latestOf(coops.data.waterTemperature),
            wind: latestOf(coops.data.wind),
            nextTides: coops.data.tideExtremes?.filter((tide) => tide.time > now).slice(0, 4) ?? null,
            warnings: coops.warnings,
          },
  };
}

function latestOf<T extends { time: IsoTime }>(rows: T[] | null) {
  return rows && latestReadings(rows);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
