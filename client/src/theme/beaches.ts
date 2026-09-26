/*
 * Visual identity per beach: accent color, a line of character, and how its hero scene is composed.
 * Physical facts (coordinates, stations, which way it faces) live in seastate.config.ts; this is only
 * presentation. A beach with no entry here gets DEFAULT_THEME: a clean horizon with no pier.
 *
 * Horizon landmarks (Catalina, Palos Verdes, oil platforms, breakwaters) aren't listed per beach.
 * scene/landmarks.ts places them from real coordinates, so any Southern California beach gets the
 * right horizon for where it sits.
 */

export interface PierSpec {
  /** Sideways offset from where you're standing, m. Negative is to your left. */
  offsetM: number;
  /** How far the pier runs past the waterline, m. */
  lengthM: number;
  /** Deck height above the water, m. */
  deckM: number;
  /** Deck width, m. */
  widthM: number;
  pilingSpacingM: number;
  lampSpacingM: number;
  /** The building at the end, if any. */
  endBuilding: { widthM: number; depthM: number; heightM: number; roof: 'gable' | 'flat' | 'hip' } | null;
}

export interface SceneComposition {
  /** Degrees the view is turned right of straight out to sea, to frame the pier. */
  yawDeg: number;
  pier: PierSpec | null;
  /** Color mood, -1 (cool) to 1 (warm). */
  warmth: number;
  /** Atmospheric haze, 0 (crisp) to 1 (soft). */
  mist: number;
}

export interface BeachTheme {
  /** UI accent: selection, focus, highlights. */
  accent: string;
  accentSoft: string;
  /** A short line under the beach name. */
  character: string;
  scene: SceneComposition;
}

export const DEFAULT_THEME: BeachTheme = {
  accent: '#7cc4f2',
  accentSoft: 'rgba(124, 196, 242, 0.14)',
  character: 'Southern California coast',
  scene: { yawDeg: 0, pier: null, warmth: 0, mist: 0.2 },
};

export const BEACH_THEMES: Record<string, BeachTheme> = {
  'seal-beach': {
    // Sea glass: the quiet one.
    accent: '#a3d9c5',
    accentSoft: 'rgba(163, 217, 197, 0.14)',
    character: 'Small-town and sheltered, tucked behind the Long Beach breakwater',
    scene: {
      yawDeg: 10,
      warmth: -0.1,
      mist: 0.42,
      pier: {
        offsetM: -30,
        lengthM: 520,
        deckM: 6.5,
        widthM: 9,
        pilingSpacingM: 9,
        lampSpacingM: 36,
        endBuilding: { widthM: 10, depthM: 12, heightM: 4.5, roof: 'flat' },
      },
    },
  },
  'huntington-beach': {
    // Open-ocean blue: Surf City.
    accent: '#62c9f2',
    accentSoft: 'rgba(98, 201, 242, 0.14)',
    character: 'Surf City: open to swell from the south through the west, with the pier at its center',
    scene: {
      yawDeg: 15,
      warmth: 0,
      mist: 0.14,
      pier: {
        offsetM: -24,
        lengthM: 540,
        deckM: 9,
        widthM: 11,
        pilingSpacingM: 8,
        lampSpacingM: 24,
        endBuilding: { widthM: 15, depthM: 16, heightM: 6, roof: 'gable' },
      },
    },
  },
  'newport-beach': {
    // Warm sand: a little more refined.
    accent: '#f0c08c',
    accentSoft: 'rgba(240, 192, 140, 0.14)',
    character: 'Warm and refined, with beach breaks running down the peninsula to the Wedge',
    scene: {
      yawDeg: -12,
      warmth: 0.35,
      mist: 0.2,
      pier: {
        offsetM: 30,
        lengthM: 300,
        deckM: 6.5,
        widthM: 8,
        pilingSpacingM: 8,
        lampSpacingM: 22,
        endBuilding: { widthM: 8, depthM: 9, heightM: 4, roof: 'hip' },
      },
    },
  },
};

export function themeFor(beachId: string | null | undefined): BeachTheme {
  return (beachId && BEACH_THEMES[beachId]) || DEFAULT_THEME;
}
