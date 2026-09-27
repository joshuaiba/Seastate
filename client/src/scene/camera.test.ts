import { describe, expect, it } from 'vitest';
import { makeCamera, project } from './camera';

const setup = { W: 1440, H: 860, facingDeg: 214, yawDeg: 12, setbackM: 70, seaBand: 0.28 };

describe('makeCamera', () => {
  it('puts the mean waterline straight ahead a sea band below the horizon', () => {
    const cam = makeCamera(setup);
    // Where the view axis meets the waterline (Z = 0).
    const x = setup.setbackM * Math.tan((setup.yawDeg * Math.PI) / 180);
    const [, y] = project(cam, x, 0, 0);

    expect(y - cam.horizonY).toBeCloseTo(setup.H * setup.seaBand, 1);
  });

  it('keeps that composition on a phone by raising the eye', () => {
    const phone = makeCamera({ ...setup, W: 390, H: 844 });
    const desktop = makeCamera(setup);

    expect(phone.eye).toBeGreaterThan(desktop.eye);
  });

  it('dips the sea horizon below eye level, more from higher up', () => {
    const low = makeCamera({ ...setup, dEye: 0 });
    const high = makeCamera({ ...setup, dEye: 20 });

    expect(low.seaHorizonY).toBeGreaterThan(low.horizonY);
    expect(high.seaHorizonY - high.horizonY).toBeGreaterThan(low.seaHorizonY - low.horizonY);
  });
});

describe('project', () => {
  it('lands anything at eye height on the horizon line', () => {
    const cam = makeCamera(setup);
    for (const [x, z] of [[-40, 100], [0, 900], [300, 5000]] as const) {
      expect(project(cam, x, cam.eye, z)[1]).toBeCloseTo(cam.horizonY, 6);
    }
  });

  it('keeps verticals vertical, so piles and walls never lean', () => {
    const cam = makeCamera(setup);
    const [x0] = project(cam, -34, 0, 200);
    const [x1] = project(cam, -34, 10, 200);

    expect(x1).toBeCloseTo(x0, 9);
  });

  it('shrinks things with distance', () => {
    const cam = makeCamera(setup);
    const height = (z: number) => project(cam, -34, 0, z)[1] - project(cam, -34, 10, z)[1];

    expect(height(100)).toBeGreaterThan(height(400));
  });
});
