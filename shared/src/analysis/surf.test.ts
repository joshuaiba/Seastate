import { describe, expect, it } from 'vitest';
import type { SurfProfile } from '../config';
import type { ConditionsSample, SwellComponent } from './conditions';
import { estimateSurf, scoreSurf, surfRange, swellExposure, windQuality } from './surf';

// Huntington Beach faces SW (214°), open to S through W swell.
const HB: SurfProfile = { facingDeg: 214, swellWindow: { centerDeg: 222, halfWidthDeg: 85 }, exposure: 1, idealTideM: [0.45, 1.25] };
// Seal Beach: same coast, but only south swells get past the breakwater and Palos Verdes.
const SEAL: SurfProfile = { facingDeg: 212, swellWindow: { centerDeg: 188, halfWidthDeg: 42 }, exposure: 0.62, idealTideM: [0.6, 1.4] };

const swell = (heightM: number, periodS: number, dirDeg: number): SwellComponent => ({ kind: 'primary', heightM, periodS, dirDeg });

function sample(overrides: Partial<ConditionsSample>): ConditionsSample {
  return {
    ms: 0, airTempC: 20, feelsLikeC: 20, humidityPct: 70, cloudCoverPct: 10, precipProbabilityPct: 0,
    precipitationMm: 0, uvIndex: 3, weatherCode: 0, windSpeedMps: 1, windGustMps: 2, windDirDeg: 40,
    waveHeightM: 1, swells: [], waterTempC: 20, tideM: 0.8, tideRateMPerHour: 0.2, sunElevationDeg: 20,
    ...overrides,
  };
}

describe('estimateSurf', () => {
  it('turns a 1 m, 14 s south swell into shoulder-high surf at an exposed beach', () => {
    const surf = estimateSurf([swell(1, 14, 200)], HB);

    expect(surf.faceFt).toBeGreaterThan(4.5);
    expect(surf.faceFt).toBeLessThan(5.5);
    expect(surf.label).toBe('4–6 ft');
    expect(surf.bodyRef).toBe('Shoulder to head');
  });

  it('makes the same swell smaller at a sheltered beach, and a west swell smaller still', () => {
    const south = [swell(1, 14, 200)];
    const west = [swell(1, 14, 280)];

    expect(estimateSurf(south, SEAL).faceFt).toBeLessThan(estimateSurf(south, HB).faceFt * 0.7);
    expect(swellExposure(280, SEAL)).toBe(0);
    expect(estimateSurf(west, HB).faceFt).toBeGreaterThan(estimateSurf(west, SEAL).faceFt);
  });

  it('calls tiny surf flat', () => {
    expect(estimateSurf([swell(0.1, 6, 270)], HB).label).toBe('Flat');
    expect(surfRange(3.2)).toEqual({ minFt: 3, maxFt: 4, label: '3–4 ft' });
  });
});

describe('windQuality', () => {
  it('knows which way is offshore for the beach', () => {
    // At a SW-facing beach, a northeast wind blows out to sea.
    expect(windQuality(3, 40, HB).relation).toBe('offshore');
    expect(windQuality(5, 240, HB).relation).toBe('onshore');
    expect(windQuality(5, 130, HB).relation).toBe('cross-shore');
    expect(windQuality(0.5, 240, HB)).toMatchObject({ relation: 'calm', label: 'Glassy', score: 1 });
  });
});

describe('scoreSurf', () => {
  it('rates clean, overhead-ish groundswell well and blown-out surf poorly', () => {
    const clean = scoreSurf(sample({ swells: [swell(1, 15, 205)], windSpeedMps: 2, windDirDeg: 40 }), HB);
    const blown = scoreSurf(sample({ swells: [swell(1, 15, 205)], windSpeedMps: 7, windDirDeg: 240 }), HB);

    expect(clean.rating).toMatch(/good|epic/);
    expect(blown.score).toBeLessThan(clean.score - 25);
    expect(blown.limiting).toBe('wind');
  });

  it("doesn't let perfect wind rescue flat surf", () => {
    const flat = scoreSurf(sample({ swells: [swell(0.15, 8, 200)], windSpeedMps: 0.5 }), HB);

    expect(flat.rating).toBe('flat');
    expect(flat.limiting).toBe('size');
  });
});
