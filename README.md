# Seastate
A live dashboard that pulls real-time NOAA buoy, tide, water-temperature, and swell data for a single beach into one page for planning surf and beach days.

**Status:** the data pipeline is done. A small Node proxy fetches, parses, and caches NOAA data and serves it as typed JSON. The UI is currently a bare "hello data" page that dumps the current readings; the dashboard itself (charts, layout, styling) is next.

Stack: React + Vite + TypeScript on the front end, Express on the back end, Recharts for charts, npm workspaces. It deploys as a single Node process with no database.

## Quick start

Requires Node 22.12 or newer (24 LTS recommended).

```sh
npm install
npm run dev          # API on :3001 + Vite on :5173. Open http://localhost:5173
npm run dev:offline  # same, but serves captured data from server/fixtures (no network needed)
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Express API (`tsx watch`) and Vite dev server together. Vite forwards `/api/*` to the API. |
| `npm run dev:offline` | `dev` with `SEASTATE_DATA_MODE=fixture` |
| `npm run build` | Typecheck everything, then build `client/dist` and bundle the server into `server/dist` |
| `npm start` | Production: one process serves the built client and the API on `PORT` (default 3001) |
| `npm test` | Vitest: parsers, cache, fixtures |
| `npm run typecheck` | `tsc` across all packages |
| `npm run fixtures` | Re-capture offline data for the configured stations (run while online) |

> On Node 25, npm installs Vitest 4, because Vitest 5 only supports Node 22, 24, and 26+. Node 25 is already past end-of-life. After moving to Node 24 or 26, you can upgrade with `npm install -D vitest@latest`.

## Configuration

**`seastate.config.ts`** is the one file to edit to change beaches. It holds the beach (name, coordinates, timezone), the NDBC buoy ID, the CO-OPS tide station ID, and some optional tuning (history window, tide window, cache lifetimes). It ships with **La Jolla Shores** defaults and a `TODO(you)` to confirm the stations. The file's comments explain how to find stations and list a few other SoCal pairs.

The config is compiled into the server, so restart `dev` (automatic under `tsx watch`) or rebuild after changing it. Run `npm run fixtures` too, so offline mode has data for the new stations.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API port. The Vite dev proxy reads it too. |
| `SEASTATE_DATA_MODE` | `live` | `fixture` serves `server/fixtures` instead of calling NOAA |
| `SEASTATE_USER_AGENT` | `seastate/0.1 (…)` | User-Agent sent to NOAA |

## How it works

```
browser ──/api──▶ Vite dev proxy (dev) or Express (prod)
                    └─▶ source loader ─▶ TTL cache ─▶ client ─▶ NOAA (or server/fixtures)
                                                         └─ parser ─▶ typed rows
```

- **The browser never calls NOAA.** NDBC sends no CORS headers, and one server-side cache keeps traffic low. Upstream URLs are built only from the config; nothing from the incoming request is forwarded.
- **Caching:** each upstream request is cached in memory (NDBC 10 min, CO-OPS observations 6 min, predictions 60 min). Concurrent requests share one fetch. If a refresh fails, the last good data is served with a warning. Failures are remembered for a minute, so a product a station doesn't offer isn't re-requested on every page load.
- **Partial failure:** each source is made of several products, e.g. CO-OPS tides, water level, water temperature, and wind. A missing product becomes `null` plus a message in `warnings`. A source only fails (502) if all of its products do.

```
seastate.config.ts        the beach and stations (edit this to change location)
shared/src/               types + helpers used by client and server (TypeScript source, no build step)
  api.ts                  SourcePayloads registry, response envelope, route paths
  ndbc.ts, coops.ts       domain types for each source
  latest.ts, units.ts     latest-reading helper; ft/°F/knots/compass conversions
server/src/
  index.ts, app.ts        entry point and Express routes
  lib/                    TTL cache, upstream fetch, fixture mode, errors
  sources/<id>/           client.ts (fetch) · parser.ts (the upstream format) · source.ts (the endpoint)
server/fixtures/          captured NOAA responses for offline mode
server/scripts/           capture-fixtures.ts
client/src/               React app (currently the "hello data" page)
```

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/location` | Beach, stations, datum, data mode |
| `GET /api/sources/ndbc` | `latest` (most recent value of each field, with its time), `observations` (wind, waves, temps), `waveSummary` (swell vs. wind waves) |
| `GET /api/sources/coops` | `tideExtremes` (highs/lows), `tideCurve` (6-minute predictions), `waterLevel`, `waterTemperature`, `wind` |
| `GET /api/health` | `{ ok: true }` |

Source responses share one envelope: `{ source, station, mode, fetchedAt, warnings, data }`. The types are in `shared/src/api.ts`, and the client gets typed responses through `fetchSource('ndbc')` in `client/src/api.ts`.

Conventions:

- **SI units**, with the unit in the field name: `waveHeightM`, `windSpeedMps`, `waterTempC`. Convert for display with the helpers in `shared/src/units.ts`.
- **Timestamps are UTC ISO-8601.** Convert to the beach's `timezone` only for display.
- **Series are oldest first**, trimmed to the configured window (48 h of observations; tides from 24 h back to 48 h ahead).
- **`null` means not reported:** the sensor doesn't exist or the reading is missing.
- **Errors** look like `{ "error": { "message": "…" } }`. Upstream failures are 502s.

## Data sources

**NOAA NDBC** ([National Data Buoy Center](https://www.ndbc.noaa.gov/)). Each station publishes 45 days of observations as whitespace-aligned text at `realtime2/<STATION>.txt` (wind, waves, pressure, temperatures) and `.spec` (the swell / wind-wave split). The format and its quirks (`MM` for missing values, `N/A`, `-99`, compass-point directions) are documented at the top of `server/src/sources/ndbc/parser.ts`. Most SoCal nearshore buoys are CDIP wave buoys with no anemometer, so their wind columns are always empty. That's why wind comes from CO-OPS by default.

**NOAA CO-OPS** ([Tides & Currents API](https://api.tidesandcurrents.noaa.gov/api/prod/)). Clean JSON, with some quirks: numbers are strings, timestamps have no offset, and errors often come back as HTTP 200. These are documented at the top of `server/src/sources/coops/parser.ts`. Requests always use metric units and GMT. Not every station has water-temperature or wind sensors.

## Offline mode

`npm run fixtures` runs the real source loaders against NOAA and saves every raw response to `server/fixtures/`, along with a `manifest.json` recording when. `npm run dev:offline` then serves those files through the same parsers. Timestamps are shifted forward by whole hours so the data looks current: the values are real, only the dates move. The committed fixtures are La Jolla data captured 2026-09-26.

## Adding a data source

For example, a swell forecast such as the Open-Meteo Marine API:

1. `shared/src/api.ts`: add `<id>: <PayloadType>` to `SourcePayloads`.
2. `server/src/sources/<id>/`: write `client.ts` (fetch through `loadRows` so offline mode works automatically), `parser.ts`, and `source.ts` (a `SourceLoader` that caches each upstream request).
3. Register the loader in `server/src/sources/index.ts`. TypeScript flags the registry until you do.
4. `npm run fixtures`.

The new source is then served at `/api/sources/<id>` and available to the client as `fetchSource('<id>')`.

## Deploying

`npm run build && npm start` runs the whole app as one Node process on `PORT`. Any Node host works. No database is needed, and the cache lives in memory.

## Next up

The UI work is marked in the code: `TODO(ui)`, `TODO(charts)`, and `TODO(style)` in `client/src/App.tsx` (each chart's TODO names the data series it would use). Station confirmation is `TODO(you)` in `seastate.config.ts`. To list them all: `grep -rn "TODO(" client/src seastate.config.ts`.

## Data credit

Buoy data from NOAA's National Data Buoy Center; tide, water level, water temperature, and wind data from NOAA's Center for Operational Oceanographic Products and Services (CO-OPS).
