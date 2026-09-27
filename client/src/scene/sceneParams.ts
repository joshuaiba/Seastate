import {
  angleDiff,
  clamp,
  HOUR_MS,
  localHour,
  moonPosition,
  mpsToMph,
  sunPosition,
  tideRange,
  type BeachAnalysis,
  type BeachInfo,
} from '@seastate/shared';
import { themeFor } from '../theme/beaches';
import type { SceneParams } from './renderer';

/** Translates a beach's current conditions into what the hero scene draws. */
export function sceneParamsFor(beach: BeachInfo, analysis: BeachAnalysis | null, now: number): SceneParams {
  const theme = themeFor(beach.id);
  const sun = sunPosition(now, beach.lat, beach.lon);
  const moon = moonPosition(now, beach.lat, beach.lon);
  const base = {
    key: beach.id,
    lat: beach.lat,
    lon: beach.lon,
    facingDeg: beach.surf.facingDeg,
    scene: theme.scene,
    sunElevationDeg: sun.elevationDeg,
    sunAzimuthDeg: sun.azimuthDeg,
    moonElevationDeg: moon.elevationDeg,
    moonAzimuthDeg: moon.azimuthDeg,
    moonIllumination: moon.illumination,
  };
  if (!analysis) {
    // Before data arrives: a calm, plausible day at the right time of day.
    return {
      ...base,
      cloudCover: 0.15,
      fog: 0,
      rain: 0,
      surfFaceFt: 2,
      periodS: 11,
      swellDirDeg: beach.surf.swellWindow.centerDeg,
      windMph: 4,
      windDirDeg: beach.surf.facingDeg,
      windOffshore: 0,
      tideNorm: 0.5,
      tideFalling: false,
    };
  }

  const sample = analysis.now.sample;
  const surf = analysis.now.scores.surf;
  const range = tideRange(analysis.conditions.tide, now - 13 * HOUR_MS, now + 13 * HOUR_MS);
  const tideNorm =
    range && sample.tideM !== null && range.highM > range.lowM
      ? clamp((sample.tideM - range.lowM) / (range.highM - range.lowM), 0, 1)
      : 0.5;

  const offshoreFrom = beach.surf.facingDeg + 180;
  const windOffshore =
    sample.windDirDeg === null ? 0 : Math.cos((angleDiff(sample.windDirDeg, offshoreFrom) * Math.PI) / 180);

  const code = sample.weatherCode;
  const cloud = (sample.cloudCoverPct ?? 20) / 100;
  // Fog codes, or a thick overcast before late morning: the marine layer.
  const marineLayer = cloud > 0.85 && localHour(now, beach.timezone) < 11 ? 0.35 : 0;
  const fog = code === 45 || code === 48 ? 0.8 : marineLayer;
  const rain = clamp(Math.max((sample.precipitationMm ?? 0) / 2, code !== null && code >= 51 && code < 70 ? 0.5 : 0), 0, 1);

  return {
    ...base,
    cloudCover: cloud,
    fog,
    rain,
    surfFaceFt: surf.surf.faceFt,
    periodS: surf.surf.dominant?.periodS ?? 9,
    swellDirDeg: surf.surf.dominant?.dirDeg ?? beach.surf.swellWindow.centerDeg,
    windMph: sample.windSpeedMps === null ? 3 : mpsToMph(sample.windSpeedMps),
    windDirDeg: sample.windDirDeg ?? offshoreFrom + 180,
    windOffshore,
    tideNorm,
    tideFalling: (sample.tideRateMPerHour ?? 0) < 0,
  };
}
