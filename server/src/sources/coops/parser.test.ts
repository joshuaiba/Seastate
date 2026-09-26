import { describe, expect, it } from 'vitest';
import {
  parseCoopsTime,
  parseTideCurve,
  parseTideExtremes,
  parseWaterLevel,
  parseWaterTemperature,
  parseWind,
} from './parser';

// Bodies are copied from real CO-OPS responses (station 9410230, La Jolla; units=metric; GMT).
// The water-level row with an empty value was added to cover missing data.
const METADATA = '"metadata":{"id":"9410230","name":"La Jolla","lat":"32.8669","lon":"-117.2571"}';

describe('parseCoopsTime', () => {
  it('turns a GMT timestamp without an offset into UTC ISO-8601', () => {
    expect(parseCoopsTime('2026-09-26 05:24')).toBe('2026-09-26T05:24:00.000Z');
  });

  it('rejects anything else', () => {
    expect(() => parseCoopsTime('yesterday')).toThrow(/Unrecognized/);
  });
});

describe('predictions', () => {
  it('reads high/low tides', () => {
    const body = `{ "predictions" : [
{"t":"2026-09-26 04:03", "v":"1.644", "type":"H"},{"t":"2026-09-26 10:15", "v":"0.13", "type":"L"}
]}`;

    expect(parseTideExtremes(body)).toEqual([
      { time: '2026-09-26T04:03:00.000Z', heightM: 1.644, type: 'high' },
      { time: '2026-09-26T10:15:00.000Z', heightM: 0.13, type: 'low' },
    ]);
  });

  it('reads the fixed-interval tide curve', () => {
    const body = `{ "predictions" : [
{"t":"2026-09-26 05:00", "v":"1.561"},{"t":"2026-09-26 05:06", "v":"1.542"}
]}`;

    expect(parseTideCurve(body)).toEqual([
      { time: '2026-09-26T05:00:00.000Z', heightM: 1.561 },
      { time: '2026-09-26T05:06:00.000Z', heightM: 1.542 },
    ]);
  });
});

describe('observations', () => {
  it('reads water level, with empty strings as missing values', () => {
    const body = `{${METADATA},"data":[{"t":"2026-09-26 05:24", "v":"1.691", "s":"0.163", "f":"0,0,0,0", "q":"p"},{"t":"2026-09-26 05:30", "v":"", "s":"", "f":"0,0,0,0", "q":"p"}]}`;

    expect(parseWaterLevel(body)).toEqual([
      { time: '2026-09-26T05:24:00.000Z', heightM: 1.691, quality: 'preliminary' },
      { time: '2026-09-26T05:30:00.000Z', heightM: null, quality: 'preliminary' },
    ]);
  });

  it('reads water temperature', () => {
    const body = `{${METADATA},"data":[{"t":"2026-09-26 05:24", "v":"21.6", "f":"0,0,0"}]}`;

    expect(parseWaterTemperature(body)).toEqual([{ time: '2026-09-26T05:24:00.000Z', tempC: 21.6 }]);
  });

  it('reads wind', () => {
    const body = `{${METADATA},"data":[{"t":"2026-09-26 05:24", "s":"1.2", "d":"43.0", "dr":"NE", "g":"2.3", "f":"0,0"}]}`;

    expect(parseWind(body)).toEqual([{ time: '2026-09-26T05:24:00.000Z', speedMps: 1.2, gustMps: 2.3, dirDeg: 43 }]);
  });
});

describe('errors', () => {
  it('throws the message CO-OPS sends in an HTTP 200 error body', () => {
    // What 9410660 (Los Angeles) returns for water_temperature: it has no temperature sensor.
    const body =
      '{"error": {"message":"No data was found. This product may not be offered at this station at the requested time."}}';

    expect(() => parseWaterTemperature(body)).toThrow('CO-OPS: No data was found. This product may not be offered');
  });

  it('throws on a body that is not JSON', () => {
    expect(() => parseTideCurve('<html>Service Unavailable</html>')).toThrow(/other than JSON/);
  });
});
