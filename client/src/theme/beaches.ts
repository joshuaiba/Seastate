import type { BeachScene } from '../scene/spec';

/*
 * Visual identity per beach: accent color, a line of character, and the physical description its hero
 * scene is built from (scene/spec.ts explains the frame and units). Facts that drive the data, like
 * coordinates, stations and which way the beach faces, live in seastate.config.ts; this is only
 * presentation. A beach with no entry here gets DEFAULT_THEME: a plain beach with no pier.
 *
 * Distant landmarks (Catalina, Palos Verdes, the oil platforms, the Long Beach breakwater) aren't listed
 * per beach. scene/landmarks.ts places them from real coordinates, so any Southern California beach gets
 * the right horizon for where it sits, and the camera yaw here decides which of them are in frame.
 */

export interface BeachTheme {
  /** UI accent, used sparingly: focus, the selected beach, and highlights that mean something. */
  accent: string;
  accentSoft: string;
  /** A short line under the beach name. */
  character: string;
  scene: BeachScene;
}

export const DEFAULT_THEME: BeachTheme = {
  accent: '#9cc3dc',
  accentSoft: 'rgba(156, 195, 220, 0.12)',
  character: 'Southern California coast',
  scene: {
    camera: { yawDeg: 0, setbackM: 50, seaBand: 0.3 },
    shore: { faceSlope: 0.08, nearshoreSlope: 0.025, bermM: 2.8, tideRangeM: 1.5 },
    surf: { peakSpacingM: 90, peakiness: 0.35, foamLifeS: 7, shadow: null },
    water: { deep: '#14485a', shallow: '#2e8683', turbid: '#5c8a7c', clarityM: 4 },
    atmosphere: { visibilityKm: 32, warmth: 0, seaHaze: 0.2 },
    pier: null,
    life: { surfers: 3, lineupM: [-40, 40], sailboats: 0, ships: 0 },
  },
};

export const BEACH_THEMES: Record<string, BeachTheme> = {
  'seal-beach': {
    // Sea glass: the quiet one.
    accent: '#a3d4c2',
    accentSoft: 'rgba(163, 212, 194, 0.12)',
    character: 'Small-town and sheltered, tucked behind the Long Beach breakwater',
    scene: {
      // Standing west of the pier toward the river jetty, looking west-southwest: the pier runs out on
      // the left, Catalina sits ahead-left, and the breakwater and Palos Verdes close off the right.
      camera: { yawDeg: 17, setbackM: 55, seaBand: 0.29 },
      shore: { faceSlope: 0.07, nearshoreSlope: 0.025, bermM: 2.5, tideRangeM: 1.5 },
      surf: {
        peakSpacingM: 90,
        peakiness: 0.25,
        foamLifeS: 6,
        // The breakwater's shadow: swell fades toward the right, the harbor side, where it's glassier.
        shadow: { side: 1, fromM: -60, toM: 380, floor: 0.4 },
      },
      // Greener and murkier: river runoff and the harbor next door.
      water: { deep: '#1a4a50', shallow: '#3a8272', turbid: '#6a8a70', clarityM: 2.5 },
      atmosphere: { visibilityKm: 26, warmth: -0.08, seaHaze: 0.35 },
      pier: {
        // 1,865 ft (568 m), one of the longest timber piers in California: slender braced piles in
        // close bents and a low deck. The end widens where Ruby's stood; the diner burned in 2016
        // and wasn't rebuilt, so the end is open deck.
        offsetM: -19,
        startM: -50,
        lengthM: 568,
        widthM: 6.5,
        deckM: [6, 6.4],
        deckThicknessM: 0.9,
        material: 'timber',
        bents: { spacingM: 6, piles: 5, pileDiameterM: 0.36, braced: true },
        railing: { heightM: 1.05, postSpacingM: 2.4 },
        lamps: { spacingM: 30, heightM: 3.8, outboardM: 0 },
        platforms: [{ atM: 552, shape: 'rect', widthM: 20, lengthM: 32 }],
        building: null,
      },
      life: { surfers: 2, lineupM: [-12, 45], sailboats: 1, ships: 1 },
    },
  },
  'huntington-beach': {
    // Open-ocean blue: Surf City.
    accent: '#8cc0e2',
    accentSoft: 'rgba(140, 192, 226, 0.12)',
    character: 'Surf City: open to swell from the south through the west, with the pier at its center',
    scene: {
      // North side of the pier, looking southwest across a wide, gently shelving surf zone toward
      // Catalina and the platforms. The widest view of open water of the three.
      camera: { yawDeg: 12, setbackM: 70, seaBand: 0.28 },
      shore: { faceSlope: 0.06, nearshoreSlope: 0.018, bermM: 3, tideRangeM: 1.5 },
      surf: { peakSpacingM: 140, peakiness: 0.35, foamLifeS: 9, shadow: null },
      water: { deep: '#12475c', shallow: '#2f8a86', turbid: '#5e8a78', clarityM: 3.5 },
      atmosphere: { visibilityKm: 36, warmth: 0, seaHaze: 0.2 },
      pier: {
        // 1,850 ft (560 m) of concrete, deck 30 ft (9.1 m) above the sea and rising gently seaward,
        // with wide pile spacing for surfers, three octagonal platforms along the way, and a diamond
        // (a 108 ft square turned 45°) at the end carrying the restaurant.
        offsetM: -34,
        startM: -60,
        lengthM: 560,
        widthM: 10,
        deckM: [9.1, 10.4],
        deckThicknessM: 1.2,
        material: 'concrete',
        bents: { spacingM: 12, piles: 4, pileDiameterM: 0.6, braced: false },
        railing: { heightM: 1.1, postSpacingM: 2.4 },
        // Light standards on corbels outside the rail, both sides.
        lamps: { spacingM: 18, heightM: 4.8, outboardM: 0.6 },
        platforms: [
          { atM: 170, shape: 'octagon', widthM: 20, lengthM: 20 },
          { atM: 300, shape: 'octagon', widthM: 20, lengthM: 20 },
          { atM: 420, shape: 'octagon', widthM: 20, lengthM: 20 },
          { atM: 537, shape: 'diamond', widthM: 46, lengthM: 46 },
        ],
        building: {
          atM: 537,
          widthM: 18,
          depthM: 18,
          wallM: 5.5,
          roof: 'hip',
          roofM: 3.6,
          overhangM: 1,
          wall: '#dcd6ca',
          roofColor: '#5d6770',
        },
      },
      life: { surfers: 7, lineupM: [-18, 90], sailboats: 0, ships: 1 },
    },
  },
  'newport-beach': {
    // Warm sand: a little more refined.
    accent: '#dfbd92',
    accentSoft: 'rgba(223, 189, 146, 0.12)',
    character: 'Warm and refined, with beach breaks running down the peninsula to the Wedge',
    scene: {
      // Newport Pier on the Balboa Peninsula, from the sand just downcoast of it, looking south-southwest. The
      // beach face is steep and the water deepens fast (the Newport canyon comes in close), so waves
      // break late and hard near the sand. The view south is open ocean; Catalina is off to the right.
      camera: { yawDeg: -10, setbackM: 40, seaBand: 0.31 },
      shore: { faceSlope: 0.13, nearshoreSlope: 0.05, bermM: 3.2, tideRangeM: 1.5 },
      surf: { peakSpacingM: 55, peakiness: 0.6, foamLifeS: 5, shadow: null },
      water: { deep: '#0f3e5a', shallow: '#2a878d', turbid: '#4f8a86', clarityM: 5 },
      atmosphere: { visibilityKm: 42, warmth: 0.12, seaHaze: 0.15 },
      pier: {
        // 1,032 ft (315 m) of concrete ending in a crosshead. The end restaurant closed in 2012 and
        // was taken down, so there's no building.
        offsetM: 32,
        startM: -35,
        lengthM: 315,
        widthM: 7.5,
        deckM: [6.1, 6.4],
        deckThicknessM: 1,
        material: 'concrete',
        bents: { spacingM: 7.6, piles: 3, pileDiameterM: 0.5, braced: false },
        railing: { heightM: 1.1, postSpacingM: 2.4 },
        lamps: { spacingM: 21, heightM: 4.2, outboardM: 0.3 },
        platforms: [{ atM: 306, shape: 'rect', widthM: 24, lengthM: 18 }],
        building: null,
      },
      life: { surfers: 4, lineupM: [-55, 15], sailboats: 3, ships: 0 },
    },
  },
};

export function themeFor(beachId: string | null | undefined): BeachTheme {
  return (beachId && BEACH_THEMES[beachId]) || DEFAULT_THEME;
}
