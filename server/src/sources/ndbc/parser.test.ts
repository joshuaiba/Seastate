import { describe, expect, it } from 'vitest';
import { parseNdbcTable, parseStandardMet, parseWaveSummary } from './parser';

const STDMET_HEADER = `#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft`;

// Real rows from realtime2/46253.txt, a CDIP wave buoy with no anemometer (so wind is always MM).
const CDIP_STDMET = `${STDMET_HEADER}
2026 09 26 04 56  MM   MM   MM   0.7    13   4.4 198     MM    MM  22.6    MM   MM   MM    MM
2026 09 26 04 26  MM   MM   MM   0.7     4   4.2 266     MM    MM  22.6    MM   MM   MM    MM
2026 09 26 03 56  MM   MM   MM   0.7     4   4.0 266     MM    MM  22.6    MM   MM   MM    MM
`;

const SPEC_HEADER = `#YY  MM DD hh mm WVHT  SwH  SwP  WWH  WWP SwD WWD  STEEPNESS  APD MWD
#yr  mo dy hr mn    m    m  sec    m  sec  -  degT     -      sec degT`;

describe('parseNdbcTable', () => {
  it('reads the header lines and returns rows oldest first', () => {
    const table = parseNdbcTable(CDIP_STDMET);

    expect(table.columns.slice(0, 6)).toEqual(['YY', 'MM', 'DD', 'hh', 'mm', 'WDIR']);
    expect(table.units.slice(0, 6)).toEqual(['yr', 'mo', 'dy', 'hr', 'mn', 'degT']);
    expect(table.rows.map((row) => row.time)).toEqual([
      '2026-09-26T03:56:00.000Z',
      '2026-09-26T04:26:00.000Z',
      '2026-09-26T04:56:00.000Z',
    ]);
    expect(table.rows[2]?.cells).toMatchObject({ WVHT: '0.7', DPD: '13', WDIR: 'MM' });
  });

  it('skips lines with the wrong number of cells', () => {
    const table = parseNdbcTable(`${CDIP_STDMET}2026 09 26 05 26  MM   MM\n`);

    expect(table.rows).toHaveLength(3);
    expect(table.skippedLines).toBe(1);
  });

  it('rejects text that is not an NDBC file', () => {
    expect(() => parseNdbcTable('<html>Not Found</html>')).toThrow(/no "#" header/);
  });
});

describe('parseStandardMet', () => {
  it('maps columns to typed fields and MM to null', () => {
    const latest = parseStandardMet(CDIP_STDMET).at(-1);

    expect(latest).toEqual({
      time: '2026-09-26T04:56:00.000Z',
      windDirDeg: null,
      windSpeedMps: null,
      windGustMps: null,
      waveHeightM: 0.7,
      dominantPeriodS: 13,
      averagePeriodS: 4.4,
      meanWaveDirDeg: 198,
      pressureHpa: null,
      airTempC: null,
      waterTempC: 22.6,
      dewPointC: null,
      visibilityNmi: null,
      pressureTendencyHpa: null,
      tideM: null,
    });
  });

  it('parses wind, pressure, and signed pressure tendency from a met buoy', () => {
    // Values reported by 46025 (Santa Monica Basin), an NDBC buoy with an anemometer.
    const [row] = parseStandardMet(`${STDMET_HEADER}
2026 09 26 05 00 290  4.0  5.0    MM    MM    MM  MM 1011.6  20.3  22.5  19.3   MM +0.4    MM
`);

    expect(row).toMatchObject({
      windDirDeg: 290,
      windSpeedMps: 4,
      windGustMps: 5,
      pressureHpa: 1011.6,
      airTempC: 20.3,
      dewPointC: 19.3,
      pressureTendencyHpa: 0.4,
      waveHeightM: null,
    });
  });

  it('converts TIDE from feet to meters', () => {
    const [row] = parseStandardMet(`${STDMET_HEADER}
2026 09 26 05 00  MM   MM   MM    MM    MM    MM  MM     MM    MM    MM    MM   MM   MM  3.28
`);

    expect(row?.tideM).toBe(1);
  });

  it('finds columns by name, so stations with a different column set still parse', () => {
    const [row] = parseStandardMet(`#YY  MM DD hh mm  WTMP  WVHT
#yr  mo dy hr mn  degC     m
2026 09 26 04 56  22.6   0.7
`);

    expect(row).toMatchObject({ waterTempC: 22.6, waveHeightM: 0.7, windSpeedMps: null, tideM: null });
  });
});

describe('parseWaveSummary', () => {
  it('reads the swell / wind-wave split, including compass-point directions', () => {
    // Real row from realtime2/46253.spec.
    const [row] = parseWaveSummary(`${SPEC_HEADER}
2026 09 26 04 56  0.7  0.3 12.5  0.6  4.0 SSW   W        N/A  4.4 198
`);

    expect(row).toEqual({
      time: '2026-09-26T04:56:00.000Z',
      significantHeightM: 0.7,
      swellHeightM: 0.3,
      swellPeriodS: 12.5,
      swellDir: 'SSW',
      windWaveHeightM: 0.6,
      windWavePeriodS: 4,
      windWaveDir: 'W',
      steepness: null,
      averagePeriodS: 4.4,
      meanWaveDirDeg: 198,
    });
  });

  it('treats N/A and out-of-range numbers such as -99 as missing', () => {
    // Real row from realtime2/LJPC1.spec (Scripps Pier), which has no directional wave sensor.
    const [row] = parseWaveSummary(`${SPEC_HEADER}
2026 09 26 04 20  0.7  0.7  5.6  0.0  1.8 N/A N/A        N/A  5.5 -99
`);

    expect(row).toMatchObject({ swellDir: null, windWaveDir: null, steepness: null, meanWaveDirDeg: null });
  });

  it('reads steepness categories', () => {
    const [row] = parseWaveSummary(`${SPEC_HEADER}
2026 09 26 04 56  1.4  1.1 14.3  0.8  5.3  WSW   W    AVERAGE  6.1 250
`);

    expect(row?.steepness).toBe('AVERAGE');
  });
});
