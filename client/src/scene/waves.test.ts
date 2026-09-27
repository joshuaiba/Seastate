import { describe, expect, it } from 'vitest';
import type { SurfCharacter } from './spec';
import { Sea, type SeaInputs } from './waves';

const surf: SurfCharacter = { peakSpacingM: 120, peakiness: 0, foamLifeS: 8, shadow: null };
const base: SeaInputs = {
  breakHeightM: 1,
  periodS: 12,
  swellAngleDeg: 0,
  windOffshore: 0,
  windMph: 5,
  waterlineM: 0,
  nearshoreSlope: 0.02,
  faceSlope: 0.06,
  surf,
};

function sea(inputs: Partial<SeaInputs> = {}): Sea {
  const s = new Sea();
  s.configure({ ...base, ...inputs });
  return s;
}

describe('Sea', () => {
  it('slows crests in shallow water, so they bunch up toward the beach', () => {
    const s = sea();
    const period = 12;
    // Distance a crest covers in one period, out at 400 m and in at 40 m.
    const wavelengthAt = (z: number) => {
      let lo = z;
      while (s.travel(lo + 1) - s.travel(z) < period) lo += 1;
      return lo - z;
    };

    expect(wavelengthAt(40)).toBeLessThan(wavelengthAt(400) * 0.6);
  });

  it('breaks bigger surf farther out', () => {
    expect(sea({ breakHeightM: 2 }).breakDistance(0, 0)).toBeGreaterThan(sea({ breakHeightM: 1 }).breakDistance(0, 0));
  });

  it('breaks waves farther out on a gentle seabed than a steep one', () => {
    expect(sea({ nearshoreSlope: 0.015 }).breakDistance(0, 0)).toBeGreaterThan(sea({ nearshoreSlope: 0.05 }).breakDistance(0, 0));
  });

  it('lets offshore wind hold a wave up until shallower water', () => {
    const offshore = sea({ windOffshore: 1, windMph: 15 }).breakDistance(0, 0);
    const onshore = sea({ windOffshore: -1, windMph: 15 }).breakDistance(0, 0);

    expect(offshore).toBeLessThan(onshore);
  });

  it('runs up farther on a gentle beach face than a steep one', () => {
    expect(sea({ faceSlope: 0.05 }).runupM).toBeGreaterThan(sea({ faceSlope: 0.13 }).runupM * 2);
  });

  it('moves the break with the tide', () => {
    const low = sea({ waterlineM: 10 });
    const high = sea({ waterlineM: -10 });
    // The same crest breaks the same distance from wherever the water's edge is.
    expect(low.waterline + low.breakDistance(3, 0)).toBeCloseTo(high.waterline + high.breakDistance(3, 0) + 20, 6);
  });

  it('shrinks waves in a breakwater shadow', () => {
    const sheltered = sea({ surf: { ...surf, shadow: { side: 1, fromM: 0, toM: 300, floor: 0.4 } } });

    expect(sheltered.crestGain(5, 400)).toBeCloseTo(sheltered.crestGain(5, -400) * 0.4, 6);
  });

  it('carries a swell from the left along the beach to the right', () => {
    const s = sea({ swellAngleDeg: -30 });
    // The left end of each crest reaches the beach first, so at the same distance out, a point
    // farther right is earlier in the wave's cycle.
    expect(s.phase(50, 300)).toBeLessThan(s.phase(-50, 300));
  });

  it('keeps the surface within the wave height', () => {
    const s = sea({ breakHeightM: 1.5 });
    for (let i = 0; i < 400; i++) {
      s.advance(0.37);
      const h = s.elevation((i % 20) * 13 - 130, 20 + (i % 37) * 9);
      expect(Math.abs(h)).toBeLessThan(1.5 * 1.3);
    }
  });
});
