import type { SeastateConfig } from '@seastate/shared';

/**
 * Seastate configuration: the beaches the dashboard covers and the stations behind each one.
 * This is the one file to edit to change or add beaches.
 *
 * TODO(you): Confirm these stations for your beach before trusting the data.
 *   NDBC buoys    https://www.ndbc.noaa.gov/ (station map). Pick a nearshore buoy with wave data,
 *                 ideally one that reports wave direction (MWD).
 *   CO-OPS tides  https://tidesandcurrents.noaa.gov/map/ Pick a station with a water-level sensor.
 *                 "Subordinate" stations only have high/low predictions, so the tide curve, water
 *                 level, temperature, and wind would all come back empty.
 *   After changing stations, run `npm run fixtures` (while online) to refresh the offline data.
 *
 * Defaults: La Jolla Shores, San Diego. Both stations are within about 2 km of the beach.
 *   - NDBC 46254 "Scripps Nearshore" is a CDIP wave buoy. It reports waves, the swell/wind-wave
 *     split, and water temperature, but it has no anemometer, so its wind columns are always
 *     missing. Most SoCal nearshore buoys (the 462xx series) are like this, so wind comes from the
 *     CO-OPS station instead.
 *   - CO-OPS 9410230 "La Jolla" is on Scripps Pier: tides, water level, water temperature, and wind.
 *
 * Other SoCal pairs that were reporting when this was set up. Not every CO-OPS station has
 * temperature or wind sensors; a missing product shows up as a warning in the API response.
 *   Santa Monica      NDBC 46221 (Santa Monica Bay)    CO-OPS 9410840 (Santa Monica): has water temp + wind
 *   Huntington Beach  NDBC 46253 (San Pedro South)     CO-OPS 9410660 (Los Angeles): tides/water level only
 *   Torrey Pines      NDBC 46225 (Torrey Pines Outer)  CO-OPS 9410230 (La Jolla)
 *
 * Each beach also has a surf profile (see SurfProfile in shared/src/config.ts): which way it faces,
 * which swell directions reach it, and the tide it works best on. La Jolla Shores faces west-northwest
 * into the cove, sheltered from the south by the La Jolla headland.
 */
export const config: SeastateConfig = {
  beaches: [
    {
      id: 'la-jolla-shores',
      name: 'La Jolla Shores',
      region: 'San Diego, CA',
      lat: 32.857,
      lon: -117.257,
      timezone: 'America/Los_Angeles',
      landmark: 'Scripps Pier',
      surf: {
        facingDeg: 285,
        swellWindow: { centerDeg: 280, halfWidthDeg: 60 },
        exposure: 0.7,
        idealTideM: [0.3, 1.2],
      },
      stations: {
        ndbc: { id: '46254', name: 'Scripps Nearshore' },
        coops: { id: '9410230', name: 'La Jolla (Scripps Pier)' },
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
    cacheMinutes: {
      ndbc: 10, // buoys report every 30-60 minutes
      coopsObservations: 6, // water level, temperature, and wind are 6-minute data
      coopsPredictions: 60, // predictions don't change; this only controls how often the window slides
    },
  },
};
