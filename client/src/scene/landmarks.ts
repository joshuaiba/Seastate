/*
 * Real landmarks on the Southern California horizon, by coordinates. The renderer works out each
 * one's bearing and distance from whichever beach is showing and draws it where it would actually
 * sit, so Catalina lands in the right place from Seal Beach or Newport, and a beach added later gets
 * a correct horizon for free. Heights are real; the renderer exaggerates them a little so a 2,000 ft
 * island 30 miles away still reads.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Height above sea level, km. */
  heightKm: number;
}

export type LandmarkKind = 'ridge' | 'platform' | 'breakwater';

export interface Landmark {
  id: string;
  kind: LandmarkKind;
  /** Profile along the feature, in order. A platform has one point. */
  points: GeoPoint[];
}

export const LANDMARKS: Landmark[] = [
  {
    // Santa Catalina Island, west end to Avalon. Mt. Orizaba (640 m) is the high point.
    id: 'catalina',
    kind: 'ridge',
    points: [
      { lat: 33.478, lon: -118.604, heightKm: 0.0 },
      { lat: 33.47, lon: -118.585, heightKm: 0.3 },
      { lat: 33.455, lon: -118.545, heightKm: 0.46 },
      { lat: 33.44, lon: -118.505, heightKm: 0.36 },
      { lat: 33.43, lon: -118.49, heightKm: 0.08 },
      { lat: 33.415, lon: -118.465, heightKm: 0.42 },
      { lat: 33.395, lon: -118.43, heightKm: 0.55 },
      { lat: 33.378, lon: -118.4, heightKm: 0.64 },
      { lat: 33.365, lon: -118.37, heightKm: 0.52 },
      { lat: 33.35, lon: -118.34, heightKm: 0.4 },
      { lat: 33.338, lon: -118.32, heightKm: 0.22 },
      { lat: 33.32, lon: -118.3, heightKm: 0.0 },
    ],
  },
  {
    // Palos Verdes Peninsula, from Point Vicente round to Point Fermin.
    id: 'palos-verdes',
    kind: 'ridge',
    points: [
      { lat: 33.742, lon: -118.412, heightKm: 0.05 },
      { lat: 33.755, lon: -118.39, heightKm: 0.3 },
      { lat: 33.762, lon: -118.365, heightKm: 0.44 },
      { lat: 33.752, lon: -118.335, heightKm: 0.38 },
      { lat: 33.735, lon: -118.31, heightKm: 0.2 },
      { lat: 33.712, lon: -118.294, heightKm: 0.04 },
    ],
  },
  {
    // The San Joaquin Hills behind Corona del Mar and Laguna.
    id: 'san-joaquin-hills',
    kind: 'ridge',
    points: [
      { lat: 33.61, lon: -117.87, heightKm: 0.05 },
      { lat: 33.59, lon: -117.83, heightKm: 0.26 },
      { lat: 33.57, lon: -117.8, heightKm: 0.33 },
      { lat: 33.545, lon: -117.77, heightKm: 0.22 },
      { lat: 33.52, lon: -117.75, heightKm: 0.05 },
    ],
  },
  // Offshore oil platforms off Huntington Beach and Long Beach (approximate positions).
  { id: 'platform-emmy', kind: 'platform', points: [{ lat: 33.662, lon: -118.044, heightKm: 0.05 }] },
  { id: 'platform-esther', kind: 'platform', points: [{ lat: 33.595, lon: -118.121, heightKm: 0.05 }] },
  { id: 'platform-edith', kind: 'platform', points: [{ lat: 33.597, lon: -118.143, heightKm: 0.05 }] },
  {
    // Long Beach (Middle and East) Breakwater: why Seal Beach is so sheltered.
    id: 'long-beach-breakwater',
    kind: 'breakwater',
    points: [
      { lat: 33.716, lon: -118.235, heightKm: 0.004 },
      { lat: 33.722, lon: -118.19, heightKm: 0.004 },
      { lat: 33.727, lon: -118.135, heightKm: 0.004 },
    ],
  },
];

const EARTH_KM_PER_DEG = 111.32;

/** Bearing (degrees true) and distance (km) from one point to another. Flat-earth; fine at this scale. */
export function bearingTo(fromLat: number, fromLon: number, lat: number, lon: number): { bearingDeg: number; distanceKm: number } {
  const dy = (lat - fromLat) * EARTH_KM_PER_DEG;
  const dx = (lon - fromLon) * EARTH_KM_PER_DEG * Math.cos((fromLat * Math.PI) / 180);
  const bearingDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { bearingDeg, distanceKm: Math.hypot(dx, dy) };
}
