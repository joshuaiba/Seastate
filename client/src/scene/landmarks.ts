/*
 * Real landmarks on the Southern California horizon, by coordinates. The renderer works out each one's
 * bearing and distance from whichever beach is showing and draws it where it would actually sit, at its
 * true angular size, with the earth's curvature hiding its base and haze thinning it, so Catalina lands in
 * the right place from Seal Beach or Newport and a beach added later gets a correct horizon for free.
 *
 * Profiles are key points along each ridge crest (west to east) with heights from USGS topo maps, rounded.
 * Platform positions are approximate (BOEM and State Lands listings).
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
  /** Rugged ridges get more fine detail along the skyline, 0–1. */
  roughness?: number;
}

export const LANDMARKS: Landmark[] = [
  {
    // Santa Catalina Island. Silver Peak rises steeply from the West End, the land drops almost to sea
    // level at the Two Harbors isthmus (the notch you can see from the mainland), then climbs to Mount
    // Orizaba and Black Jack and falls away past Avalon to the East End.
    id: 'catalina',
    kind: 'ridge',
    roughness: 0.55,
    points: [
      { lat: 33.478, lon: -118.604, heightKm: 0.0 },
      { lat: 33.474, lon: -118.594, heightKm: 0.26 },
      { lat: 33.466, lon: -118.572, heightKm: 0.55 },
      { lat: 33.458, lon: -118.55, heightKm: 0.46 },
      { lat: 33.449, lon: -118.527, heightKm: 0.4 },
      { lat: 33.441, lon: -118.508, heightKm: 0.24 },
      { lat: 33.436, lon: -118.499, heightKm: 0.05 },
      { lat: 33.43, lon: -118.488, heightKm: 0.04 },
      { lat: 33.424, lon: -118.477, heightKm: 0.27 },
      { lat: 33.413, lon: -118.458, heightKm: 0.43 },
      { lat: 33.4, lon: -118.428, heightKm: 0.55 },
      { lat: 33.39, lon: -118.41, heightKm: 0.64 },
      { lat: 33.378, lon: -118.392, heightKm: 0.61 },
      { lat: 33.366, lon: -118.371, heightKm: 0.49 },
      { lat: 33.356, lon: -118.35, heightKm: 0.43 },
      { lat: 33.346, lon: -118.334, heightKm: 0.3 },
      { lat: 33.334, lon: -118.316, heightKm: 0.22 },
      { lat: 33.318, lon: -118.302, heightKm: 0.14 },
      { lat: 33.303, lon: -118.296, heightKm: 0.0 },
    ],
  },
  {
    // Palos Verdes Peninsula, from Point Vicente over San Pedro Hill down to Point Fermin.
    id: 'palos-verdes',
    kind: 'ridge',
    roughness: 0.35,
    points: [
      { lat: 33.742, lon: -118.412, heightKm: 0.04 },
      { lat: 33.752, lon: -118.398, heightKm: 0.22 },
      { lat: 33.76, lon: -118.374, heightKm: 0.36 },
      { lat: 33.748, lon: -118.337, heightKm: 0.44 },
      { lat: 33.74, lon: -118.321, heightKm: 0.33 },
      { lat: 33.728, lon: -118.306, heightKm: 0.17 },
      { lat: 33.715, lon: -118.297, heightKm: 0.07 },
      { lat: 33.706, lon: -118.293, heightKm: 0.03 },
    ],
  },
  {
    // The San Joaquin Hills behind Corona del Mar and Laguna.
    id: 'san-joaquin-hills',
    kind: 'ridge',
    roughness: 0.4,
    points: [
      { lat: 33.61, lon: -117.87, heightKm: 0.05 },
      { lat: 33.59, lon: -117.83, heightKm: 0.26 },
      { lat: 33.57, lon: -117.8, heightKm: 0.33 },
      { lat: 33.545, lon: -117.77, heightKm: 0.22 },
      { lat: 33.52, lon: -117.75, heightKm: 0.05 },
    ],
  },
  // Oil platforms. Eva, Emmy and Esther sit in state waters close off Huntington and Seal Beach; Edith and
  // the Beta Unit (Ellen, Elly, Eureka) stand about nine miles out, the row on Huntington's horizon.
  { id: 'platform-eva', kind: 'platform', points: [{ lat: 33.663, lon: -118.065, heightKm: 0.05 }] },
  { id: 'platform-emmy', kind: 'platform', points: [{ lat: 33.661, lon: -118.043, heightKm: 0.05 }] },
  { id: 'platform-esther', kind: 'platform', points: [{ lat: 33.691, lon: -118.117, heightKm: 0.05 }] },
  { id: 'platform-edith', kind: 'platform', points: [{ lat: 33.595, lon: -118.142, heightKm: 0.05 }] },
  { id: 'platform-ellen', kind: 'platform', points: [{ lat: 33.5824, lon: -118.1286, heightKm: 0.05 }] },
  { id: 'platform-elly', kind: 'platform', points: [{ lat: 33.5821, lon: -118.1296, heightKm: 0.04 }] },
  { id: 'platform-eureka', kind: 'platform', points: [{ lat: 33.5643, lon: -118.116, heightKm: 0.06 }] },
  {
    // The Long Beach (middle and east) and San Pedro breakwaters: why Seal Beach is so sheltered.
    id: 'long-beach-breakwater',
    kind: 'breakwater',
    points: [
      { lat: 33.727, lon: -118.135, heightKm: 0.005 },
      { lat: 33.722, lon: -118.19, heightKm: 0.005 },
      { lat: 33.716, lon: -118.235, heightKm: 0.005 },
      { lat: 33.709, lon: -118.252, heightKm: 0.005 },
      { lat: 33.713, lon: -118.275, heightKm: 0.005 },
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
