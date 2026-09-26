import type { SeastateConfig } from '@seastate/shared';

/**
 * Seastate configuration: the beaches the dashboard covers and the stations behind each one.
 * This is the one file to edit to add a beach. The UI picks it up with no other change (a beach
 * without a hand-drawn scene in client/src/theme/beaches.ts gets a generic coastline).
 *
 * Finding stations for a new beach:
 *   NDBC buoys    https://www.ndbc.noaa.gov/ (station map). Pick a nearshore buoy with wave data that
 *                 sits in the same swell exposure as the beach. It should report the swell split (.spec).
 *   CO-OPS tides  https://tidesandcurrents.noaa.gov/map/ Pick a harmonic ("R") station for a smooth
 *                 tide curve. Subordinate stations only have high/low predictions.
 *   After changing stations, run `npm run fixtures` (while online) to refresh the offline data.
 *
 * Stations here were confirmed reporting in September 2026:
 *   - NDBC 46256 Long Beach Channel (CDIP 215) sits just outside the Long Beach breakwater, the closest
 *     wave buoy to Seal Beach. NDBC 46253 San Pedro South (CDIP 213) is the open-water buoy upcoast of
 *     Huntington and Newport. Both are CDIP wave buoys: waves, swell split, water temperature, no wind.
 *   - CO-OPS 9410660 Los Angeles has a water-level gauge. 9410580 Newport Bay Entrance is a
 *     prediction-only harmonic station. Neither has wind or temperature sensors, so wind and air
 *     come from the Open-Meteo forecast.
 *
 * Surf profiles (see SurfProfile in shared/src/config.ts) encode each beach's character. The same swell
 * reads differently at each: Huntington is open to south through west swell, Newport favors south
 * swells, and Seal Beach sits behind the Long Beach breakwater and Palos Verdes, so only south swells
 * get in and it's usually the smallest of the three.
 */
export const config: SeastateConfig = {
  // Listed up the coast to down it, the order the beach selector shows them.
  beaches: [
    {
      id: 'seal-beach',
      name: 'Seal Beach',
      region: 'Orange County, CA',
      lat: 33.7368,
      lon: -118.1073,
      timezone: 'America/Los_Angeles',
      landmark: 'Seal Beach Pier',
      surf: {
        facingDeg: 212,
        swellWindow: { centerDeg: 188, halfWidthDeg: 42 },
        exposure: 0.62,
        idealTideM: [0.6, 1.4],
      },
      stations: {
        ndbc: { id: '46256', name: 'Long Beach Channel' },
        coops: { id: '9410660', name: 'Los Angeles' },
      },
    },
    {
      id: 'huntington-beach',
      name: 'Huntington Beach',
      region: 'Orange County, CA',
      lat: 33.6553,
      lon: -118.0053,
      timezone: 'America/Los_Angeles',
      landmark: 'Huntington Beach Pier',
      surf: {
        facingDeg: 214,
        swellWindow: { centerDeg: 222, halfWidthDeg: 85 },
        exposure: 1,
        idealTideM: [0.45, 1.25],
      },
      stations: {
        ndbc: { id: '46253', name: 'San Pedro South' },
        coops: { id: '9410580', name: 'Newport Bay Entrance' },
      },
    },
    {
      id: 'newport-beach',
      name: 'Newport Beach',
      region: 'Orange County, CA',
      lat: 33.6073,
      lon: -117.9296,
      timezone: 'America/Los_Angeles',
      landmark: 'Newport Pier',
      surf: {
        facingDeg: 203,
        swellWindow: { centerDeg: 196, halfWidthDeg: 70 },
        exposure: 0.95,
        idealTideM: [0.15, 1.05],
      },
      stations: {
        ndbc: { id: '46253', name: 'San Pedro South' },
        coops: { id: '9410580', name: 'Newport Bay Entrance' },
      },
    },
  ],

  // Optional tuning.
  data: {
    historyHours: 48, // how much recent observation history the API returns
    tidePastHours: 24, // tide prediction window, relative to now
    tideFutureHours: 48,
    tideCurveIntervalMinutes: 6, // resolution of the predicted tide curve (6 is CO-OPS's native interval)
    tideDatum: 'MLLW', // heights relative to Mean Lower Low Water, the US tide-table standard
    forecastDays: 8, // today plus a week
    cacheMinutes: {
      ndbc: 10, // buoys report every 30-60 minutes
      coopsObservations: 6, // water level, temperature, and wind are 6-minute data
      coopsPredictions: 60, // predictions don't change; this only controls how often the window slides
      openmeteo: 30, // the models update hourly
    },
  },
};
