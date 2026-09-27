/*
 * What a beach's hero scene is made of: a physical description the renderer builds the view from.
 *
 * Everything lives in one local frame, in metres:
 *   X  alongshore, positive to the right when you face the sea
 *   Y  up, from mean sea level
 *   Z  seaward along the shore normal, from the mean-tide waterline in front of the camera
 * The shore normal is the beach's `facingDeg` from seastate.config.ts, so the frame lines up with real
 * bearings: distant landmarks, the sun, the moon, the swell and the wind are all placed from those.
 *
 * Per-beach values live in theme/beaches.ts. They're drawn from charts, satellite imagery and the piers'
 * published dimensions, then tuned by eye; the comments there say which is which.
 */

export interface BeachScene {
  camera: CameraSpec;
  shore: ShoreSpec;
  surf: SurfCharacter;
  water: WaterCharacter;
  atmosphere: AtmosphereSpec;
  pier: PierSpec | null;
  life: LifeSpec;
}

export interface CameraSpec {
  /** Degrees the view is turned right of the shore normal. */
  yawDeg: number;
  /** Distance from the camera back from the mean-tide waterline, m. */
  setbackM: number;
  /**
   * Share of the frame height between the horizon and the waterline on a landscape screen. The eye
   * height is solved from this, so the sea keeps its place in the composition at any size; it lands
   * somewhere between standing on the berm and a lifeguard tower.
   */
  seaBand: number;
}

export interface ShoreSpec {
  /** Slope of the sand between low and high tide (rise over run). Sets how far the tide moves the waterline. */
  faceSlope: number;
  /** Seabed slope through the surf zone. Gentle slopes break waves farther out and spill them slowly. */
  nearshoreSlope: number;
  /** Berm crest above mean sea level, m: where the beach face flattens into dry sand. */
  bermM: number;
  /** Tide range the waterline moves through between the day's low and high, m. */
  tideRangeM: number;
}

export interface SurfCharacter {
  /** Alongshore spacing of sandbar peaks, m. Short spacing is a peaky beach break; long is a sandbar. */
  peakSpacingM: number;
  /** 0–1: how much wave height varies along a crest. 0 closes out in one line; 1 breaks in distinct peaks. */
  peakiness: number;
  /** Seconds a patch of whitewater lasts before it has thinned to lace and gone. */
  foamLifeS: number;
  /**
   * Swell shadow alongshore, for a beach tucked behind a breakwater or headland: waves shrink toward
   * `side` (-1 left, 1 right) starting `fromM` metres from the camera, down to `floor` of full height.
   */
  shadow: { side: -1 | 1; fromM: number; toM: number; floor: number } | null;
}

export interface WaterCharacter {
  /** Deep water body color, lit by an overcast noon sky. */
  deep: string;
  /** Clear shallow water over sand. */
  shallow: string;
  /** Sandy, aerated water inside the surf zone. */
  turbid: string;
  /** Depth over which the bottom stops showing through, m. */
  clarityM: number;
}

export interface AtmosphereSpec {
  /** Horizontal visibility on a clear day, km. Coastal haze eats contrast long before this. */
  visibilityKm: number;
  /** Color mood, -1 cool to 1 warm; kept small, the light does the real work. */
  warmth: number;
  /** Extra marine haze pooled on the water, 0–1. */
  seaHaze: number;
}

export type PierMaterial = 'concrete' | 'timber';

export interface PierSpec {
  /** Alongshore offset of the pier's centerline from the camera, m. Negative is to the left. */
  offsetM: number;
  /** Where the pier starts, m along the normal from the waterline (negative is up the beach). */
  startM: number;
  /** Length seaward from `startM`, m. */
  lengthM: number;
  /** Deck width between the railings, m. */
  widthM: number;
  /** Deck height above mean sea level at the shore end and at the seaward end, m. */
  deckM: readonly [number, number];
  deckThicknessM: number;
  material: PierMaterial;
  bents: {
    spacingM: number;
    /** Piles across one bent. */
    piles: number;
    pileDiameterM: number;
    /** Timber piers are braced diagonally between piles; concrete ones stand bare. */
    braced: boolean;
  };
  railing: { heightM: number; postSpacingM: number };
  lamps: {
    spacingM: number;
    heightM: number;
    /** How far outside the rail the standard sits, m (Huntington's hang on corbels). */
    outboardM: number;
  } | null;
  /** Wider sections along the deck, by distance from `startM`. */
  platforms: readonly PierPlatform[];
  /** A building on the deck, if the real pier has one. */
  building: PierBuilding | null;
}

export interface PierPlatform {
  /** Center, m from the pier's start. */
  atM: number;
  shape: 'octagon' | 'diamond' | 'rect';
  /** Across the pier, m. */
  widthM: number;
  /** Along the pier, m. */
  lengthM: number;
}

export interface PierBuilding {
  /** Center, m from the pier's start. */
  atM: number;
  widthM: number;
  depthM: number;
  /** Wall height above the deck, m. */
  wallM: number;
  roof: 'hip' | 'gable' | 'flat';
  /** Roof rise above the walls, m. */
  roofM: number;
  overhangM: number;
  wall: string;
  roofColor: string;
}

export interface LifeSpec {
  /** Surfers in the lineup on a good day. */
  surfers: number;
  /** Where the lineup sits alongshore relative to the camera, m, as [from, to]. */
  lineupM: readonly [number, number];
  /** Small craft under sail offshore. */
  sailboats: number;
  /** Ships working the Long Beach approaches. */
  ships: number;
}
