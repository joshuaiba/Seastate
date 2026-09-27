# Seastate
A personal coastal conditions dashboard for Seal Beach, Huntington Beach, and Newport Beach. It pulls real-time NOAA buoy and tide data plus Open-Meteo weather and swell forecasts, then answers the questions that decide a beach day: what's it like now, is it worth going, when should I go, and which of the three beaches is best today.

**Status:** the data pipeline and the dashboard are both built. A small Node proxy fetches, parses, and caches the upstream data and serves it as typed JSON. The React client runs the shared analysis (surf estimates, activity scores, best windows, written summaries) and draws everything: a live animated beach scene, current conditions, a 48-hour timeline, surf and tide detail, a 7-day outlook, a beach comparison, and history insights. History is currently modeled from regional climatology until SeaState records its own (see [History](#history)).

Stack: React + Vite + TypeScript on the front end, Express on the back end, npm workspaces. Charts are hand-built SVG, and the hero scene is a WebGL shader under a 2D canvas, so there are no chart, 3D, or animation libraries. (Recharts is still listed in `client/package.json` but nothing imports it; `npm uninstall recharts -w client` removes it.) It deploys as a single Node process with no database.

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
| `npm test` | Vitest: parsers, cache, fixtures, and the analysis (sun, surf, scoring, windows, summaries) |
| `npm run typecheck` | `tsc` across all packages |
| `npm run fixtures` | Re-capture offline data for every configured beach (run while online) |

Page URLs:

- `#huntington-beach` (or any beach id) selects a beach, so a bookmark opens it directly.
- `?at=2026-09-26T18:30-07:00` pins the clock, to preview another time of day (sunset lighting, night, tomorrow's dawn patrol) against the same data.
- `?pace=0.5` plays the hero scene in slow motion (or `2` for fast), to study how the surf moves. Both can be combined.

> On Node 25, npm installs Vitest 4, because Vitest 5 only supports Node 22, 24, and 26+. Node 25 is already past end-of-life. After moving to Node 24 or 26, you can upgrade with `npm install -D vitest@latest`.

## Configuration

**`seastate.config.ts`** is the one file to edit to change beaches. It lists the beaches in the order the selector shows them (the first is the default). Each beach has:

- `id`, `name`, `region`, `lat`/`lon`, `timezone`, and `landmark`
- `stations`: the NDBC buoy (waves, swell, water temperature) and the CO-OPS tide station
- `surf`: a **surf profile**. This sets which way the beach faces (so offshore vs. onshore wind is known), its swell window (which directions reach it), how exposed it is, and the tide range it works best at. These numbers are why the same swell reads 2–3 ft at Seal Beach and 3–4 ft at Huntington, so they're worth tuning from experience.

The file's comments explain how to find stations and why each one was picked. The `data` block tunes history and tide windows, forecast length, and cache lifetimes.

The config is compiled into the server, so restart `dev` (automatic under `tsx watch`) or rebuild after changing it. Run `npm run fixtures` too, so offline mode has data for new stations.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API port. The Vite dev proxy reads it too. |
| `SEASTATE_DATA_MODE` | `live` | `fixture` serves `server/fixtures` instead of calling upstream |
| `SEASTATE_USER_AGENT` | `seastate/0.1 (…)` | User-Agent sent upstream |

### Adding a beach

1. Add an entry to `beaches` in `seastate.config.ts` with its stations and surf profile.
2. Optionally, describe it in `client/src/theme/beaches.ts`: accent color, a line of character, and its scene (where the camera stands, the beach and seabed slopes, how the surf breaks, water color, haze, and the pier's real construction). `client/src/scene/spec.ts` documents every field. Without an entry it gets a plain beach with no pier. Horizon landmarks such as Catalina, Palos Verdes, the oil platforms, and the Long Beach breakwater are placed from real coordinates, so they already show up correctly for any Southern California beach.
3. `npm run fixtures`.

Everything else, including the selector, comparison, map, forecasts, and history, picks it up automatically.

## How it works

```
browser ──/api──▶ Vite dev proxy (dev) or Express (prod)
                    └─▶ source loader ─▶ TTL cache ─▶ client ─▶ NOAA / Open-Meteo (or server/fixtures)
                                                         └─ parser ─▶ typed rows
browser: source payloads ─▶ buildConditions ─▶ analyzeBeach ─▶ React views
```

- **The browser never calls upstream.** NDBC sends no CORS headers, and one server-side cache keeps traffic low. Upstream URLs are built only from the config. A beach id in the path selects one of the configured beaches, and nothing else from the request is forwarded.
- **Caching:** each upstream request is cached in memory (NDBC 10 min, CO-OPS observations 6 min, predictions 60 min, Open-Meteo 30 min). Cache keys are per station, so beaches that share a buoy or tide station share one fetch. Concurrent requests share one fetch. If a refresh fails, the last good data is served with a warning. Failures are remembered for a minute, so a product a station doesn't offer isn't re-requested on every page load.
- **Partial failure:** a missing product becomes `null` plus a message in `warnings`. A source only fails (502) if all of its products do. The page shows whatever it has.
- **Analysis is shared code** (`shared/src/analysis/`), pure functions with tests. The client runs it on every data load and once a minute. The server uses the same scoring to summarize history, so a "good surf day" means the same thing everywhere.

```
seastate.config.ts        the beaches and their stations (edit this to add a beach)
shared/src/               types + helpers used by client and server (TypeScript source, no build step)
  api.ts                  SourcePayloads registry, response envelope, route paths
  ndbc.ts, coops.ts,      domain types for each source
  openmeteo.ts
  config.ts               SeastateConfig, BeachConfig, SurfProfile
  sun.ts, zoned.ts        sunrise/sunset and sun position; local days/hours in the beach's timezone
  history.ts              hourly observation records → HistorySummary
  analysis/               conditions, surf, activities, windows, narrative, compare, analyze
server/src/
  index.ts, app.ts        entry point and Express routes
  lib/                    TTL cache, upstream fetch, fixture mode, errors
  sources/<id>/           client.ts (fetch) · parser.ts (the upstream format) · source.ts (the endpoint)
  history/                ObservationStore (synthetic today) + /history endpoint
server/fixtures/          captured upstream responses for offline mode
client/src/
  data/                   fetching + polling (useSeastateData, useAnalyses, useHistory)
  scene/                  the animated hero (see The hero scene)
  theme/beaches.ts        per-beach visual identity and scene description
  components/             page sections and small UI primitives
```

### The analysis, briefly

- **Conditions** (`analysis/conditions.ts`): the forecast model is the backbone because it's the only source that looks ahead. Measurements take over for "now" and correct the model nearby. Model swell is scaled to match the buoy right now, with the correction fading over about 12 hours. The model's sea temperature is shifted to match the buoy's.
- **Surf** (`analysis/surf.ts`): each wave train's breaking height is its height × a period factor × the beach's exposure to its direction. Trains combine by energy, and the result is rounded to surf-report ranges (2–3 ft, 3–5 ft…). Wind is classified against the beach's facing: glassy, offshore, cross-shore, onshore.
- **Scores** (`analysis/surf.ts`, `analysis/activities.ts`): surf, running, and beach are each 0–100, built as a product of 0–1 factors. One bad factor (flat, dark, hot, raining) sinks a score, and the weakest factor is kept so summaries can say why.
- **Windows** (`analysis/windows.ts`): scores are computed every 15 minutes. The best window is the stretch around each day's peak within a tolerance, trimmed to a few hours so the advice stays specific.
- **Summaries** (`analysis/narrative.ts`): each sentence is assembled from those facts, for example "Clean with light offshore wind until about 10:30 AM, when the onshore breeze fills in." Nothing is canned per beach.

### The hero scene

The hero is a small physical model of each beach, drawn live from the current conditions. Each beach is described in `theme/beaches.ts`: where the camera stands, the beach and seabed slopes, how its surf breaks (sandbar spacing, the Long Beach breakwater's shadow at Seal Beach), water color, haze, and its pier as built. The pier descriptions use published dimensions: Huntington's 560 m concrete pier with its octagons and end diamond, and Seal Beach's 568 m timber pier. Newport's 315 m pier has no end building, because the real one was removed. Everything shares one frame in metres, lined up with the beach's real facing, so the sun, moon, swell, wind and landmarks all come from true bearings.

- **Camera** (`scene/camera.ts`): one level pinhole camera shared by both layers. It solves the eye height so the sea keeps its place in the frame from a phone to an ultrawide.
- **Sky, sea and sand** (`scene/seaShader.ts`, one WebGL fragment shader): swell crests slow and bunch up over the seabed, refract toward the beach, and break where they reach 0.78 of the depth, in sections along each crest. Whitewater thins to lace and disappears, swash runs up the sand and drains, and tide moves the waterline and the break. Light comes from the real sun and moon positions (`shared/src/moon.ts`), with cloud decks overhead, cloud shadows, Fresnel reflection, glitter that spreads with the wind, and lamp reflections.
- **Things** (`scene/pier.ts`, `horizon.ts`, `life.ts`, 2D canvas): the pier is built from bents, deck, railings, lamps and its building, and painted far to near so each lamp's glow sits at its own depth. Distant land has true angular size, earth curvature, and haze. Surfers ride the swell from `scene/waves.ts`, the same wave model the shader uses.
- **Moving between beaches**: the camera lifts and pans, the old pier recedes into a brief thickening of haze while the new one arrives, the landmarks shift by real parallax, and the sea and weather carry straight through. With reduced motion, the scene holds still and switches instantly.

To preview a beach under specific conditions, use `?at=` for the time of day and `?pace=` to slow the motion down. The scene's pure math (camera and wave model) has tests in `client/src/scene/`.

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/beaches` | Every configured beach (location, stations, surf profile), plus the data mode |
| `GET /api/beaches/:beach/sources/ndbc` | `latest` (most recent value of each field, with its time), `observations` (wind, waves, temps), `waveSummary` (swell vs. wind waves) |
| `GET /api/beaches/:beach/sources/coops` | `tideExtremes` (highs/lows), `tideCurve` (6-minute predictions), `waterLevel`, `waterTemperature`, `wind` |
| `GET /api/beaches/:beach/sources/openmeteo` | `weather` and `marine`: hourly forecasts from a day back to a week ahead |
| `GET /api/beaches/:beach/history` | `HistorySummary`: the past year by month, day, hour, swell direction, and season |
| `GET /api/location`, `GET /api/sources/:id` | The original single-beach routes, answered for the default beach |
| `GET /api/health` | `{ ok: true }` |

Source responses share one envelope: `{ source, beachId, station, mode, fetchedAt, warnings, data }`. The types are in `shared/src/api.ts`, and the client gets typed responses through `fetchSource(beachId, 'ndbc')` in `client/src/api.ts`.

Conventions:

- **SI units**, with the unit in the field name: `waveHeightM`, `windSpeedMps`, `waterTempC`. Convert for display with the helpers in `shared/src/units.ts`.
- **Timestamps are UTC ISO-8601.** Convert to the beach's `timezone` only for display (`shared/src/zoned.ts`).
- **Series are oldest first.** Observations cover 48 h; tides run from 24 h back to 8 days ahead.
- **`null` means not reported:** the sensor doesn't exist or the reading is missing.
- **Errors** look like `{ "error": { "message": "…" } }`. Upstream failures are 502s.

## Data sources

**NOAA NDBC** ([National Data Buoy Center](https://www.ndbc.noaa.gov/)). Each station publishes 45 days of observations as whitespace-aligned text at `realtime2/<STATION>.txt` (wind, waves, pressure, temperatures) and `.spec` (the swell / wind-wave split). The format and its quirks (`MM` for missing values, `N/A`, `-99`, compass-point directions) are documented at the top of `server/src/sources/ndbc/parser.ts`. The configured buoys (46253 San Pedro South, 46256 Long Beach Channel) are CDIP wave buoys with no anemometer.

**NOAA CO-OPS** ([Tides & Currents API](https://api.tidesandcurrents.noaa.gov/api/prod/)). Clean JSON, with some quirks: numbers are strings, timestamps have no offset, and errors often come back as HTTP 200. These are documented at the top of `server/src/sources/coops/parser.ts`. 9410580 Newport Bay Entrance is prediction-only; 9410660 Los Angeles also has a water-level gauge. Neither has wind or temperature sensors, so those products come back as warnings.

**Open-Meteo** ([weather](https://open-meteo.com/en/docs) and [marine](https://open-meteo.com/en/docs/marine-weather-api) APIs). Free for non-commercial use with no key. It supplies air temperature, feels-like, cloud, precipitation, UV, and wind, plus primary and secondary swell, wind waves, and sea temperature. The format is documented at the top of `server/src/sources/openmeteo/parser.ts`.

**Computed:** sunrise, sunset, and sun position come from NOAA's solar equations (`shared/src/sun.ts`), so they work offline and at any minute.

## History

The Insights section reads `GET /api/beaches/:beach/history`, a summary computed by `summarizeHistory()` from **hourly observation records** (`HistoricalObservation` in `shared/src/history.ts`). The records come from an `ObservationStore` (`server/src/history/index.ts`).

Today that store is **synthetic**: a deterministic year of Southern California climatology. It models south swell in summer, northwest swell in winter, glassy mornings, afternoon sea breeze, Santa Ana events, seasonal water temperature, and a mixed tide. It runs through the same scoring as the live page. The regional ocean is shared, so the beaches differ only through their surf profiles. The UI labels it "Modeled from regional climatology."

To switch to real history, write a store that returns recorded rows (for example, append each hour's conditions to a file or database as the live sources are polled) and swap it in. The summary, API, and charts stay the same, and the label switches to "Recorded by SeaState" on its own.

## Offline mode

`npm run fixtures` runs the real source loaders for every beach against live upstream and saves each raw response to `server/fixtures/`, along with a `manifest.json` recording when. `npm run dev:offline` then serves those files through the same parsers. NOAA timestamps are shifted forward by whole hours so the data looks current. Forecasts shift by whole days instead, so they keep their daily rhythm (sea breeze in the afternoon, UV at midday). The values are real; only the dates move. The committed fixtures were captured for all three beaches on 2026-09-26.

## Adding a data source

For example, a water-quality feed:

1. `shared/src/api.ts`: add `<id>: <PayloadType>` to `SourcePayloads`.
2. `server/src/sources/<id>/`: write `client.ts` (fetch through `loadRows` so offline mode works automatically), `parser.ts`, and `source.ts` (a `SourceLoader` that takes the beach and caches each upstream request).
3. Register the loader in `server/src/sources/index.ts`. TypeScript flags the registry until you do.
4. `npm run fixtures`.

The new source is then served at `/api/beaches/<beach>/sources/<id>` and available to the client as `fetchSource(beachId, '<id>')`.

## Deploying

`npm run build && npm start` runs the whole app as one Node process on `PORT`. Any Node host works. No database is needed, and the cache lives in memory.

## Next up

- **Record history.** Persist hourly conditions per beach and swap the synthetic `ObservationStore` for a recorded one.
- **Tune the surf profiles** against what the beaches actually do. The exposure and swell-window numbers are informed estimates.
- **Local wind observations.** None of the configured CO-OPS stations has an anemometer, so wind is model-only. A nearby met station (e.g. CO-OPS 9410665 Long Beach Pier J) could be added as a separate wind source.

## Data credit

Buoy data from NOAA's National Data Buoy Center; tide and water level data from NOAA's Center for Operational Oceanographic Products and Services (CO-OPS); weather and marine forecasts from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).
