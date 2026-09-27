/*
 * The sky, sea and sand: one full-screen fragment shader that casts a ray per pixel through the shared
 * camera (camera.ts) into a small physical world.
 *
 *   sky    gradient keyed to sun elevation, sun and moon glow, the moon's phase lit from the real sun
 *          direction, stars
 *   sea    a curved surface, so the horizon dips and the far water ends at a real distance; near the
 *          camera the swell is ray-marched as a heightfield so crests stand up and hide the troughs
 *          behind them. The swell formulas mirror waves.ts exactly.
 *   light  Fresnel reflection of the same sky, a Beckmann specular lobe whose roughness grows with wind
 *          and with every wave too small to resolve at that distance (so glitter spreads correctly into
 *          a path), pier lamps as point lights, the pier's shadow and its reflection
 *   foam   material: a crest feathers, breaks into a roller and sheds foam that surges, slows, drifts,
 *          tears into lace and fades on its own clock; detail a pixel can't hold is filtered, not
 *          aliased. Swash creeps up the sand, rests, drains with a little backwash, and leaves it wet
 *   air    aerial perspective toward the sky color at each pixel's own bearing, thicker at sea level
 *
 * Colors arrive linear except the three sky stops, which are mixed in sRGB to keep the gradient's look.
 */

export const SEA_VERTEX = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const MAX_LAMPS = 16;

export const SEA_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec2 uView;
uniform float uPxScale;
uniform float uF;
uniform float uHorizonY;
uniform vec3 uCam;
uniform vec2 uYaw;
uniform float uTime;
uniform float uQuality;

uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform vec3 uSunLight;
uniform float uSunDisc;
uniform vec3 uMoonDir;
uniform vec3 uMoonLight;
uniform float uMoonDisc;
uniform vec3 uAmbient;
uniform float uStars;
uniform float uDiscRadius;
uniform float uGolden;

uniform float uVisibility;
uniform float uSeaHaze;
uniform float uRain;

uniform vec4 uSwellA;   // omega, clock, p, crestBase
uniform vec4 uSwellB;   // slope, z0, cDeep, zDeep
uniform vec4 uSwellC;   // waterline, breakH, gamma, setLen
uniform vec4 uSwellD;   // peakiness, peakSpacing, runup, foamLife
uniform vec4 uShadow;   // side, from, to, floor
uniform vec4 uSwash;    // up s, down s, faceSlope, berm m
uniform vec4 uSecond;   // k2x, k2z, clock2, amp2
uniform vec4 uWind;     // downwind x, z, speed m/s, offshore
uniform vec4 uTide;     // water level m, high-tide waterline (local), falling, sand warmth
uniform vec4 uDrift;    // longshore current m/s, backwash m/s, swash hold s, unused

uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uWaterTurbid;
uniform float uClarity;
uniform vec3 uFoam;
uniform vec3 uSand;

uniform vec4 uPierA;    // centerline x, start z, end z, half width (0 = no pier)
uniform vec4 uPierB;    // deck height, end platform center z, half length, half width
uniform vec3 uPierColor;
uniform float uPierFade; // the pier's presence, 0–1, while it fades in or out during a switch

uniform vec4 uCloudA;   // low deck cover, base altitude m, drift x, drift z
uniform vec4 uCloudB;   // cirrus cover, cirrus drift x, drift z, direct sun on the deck (0 once it's set for the clouds)
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;

uniform vec4 uLamps[${MAX_LAMPS}];
uniform float uLampCount;
uniform vec3 uLampColor;

const float TAU = 6.2831853;
const float PI = 3.1415927;
const float G = 9.81;
const float EARTH_R = 7.3e6;

// ── noise ───────────────────────────────────────────────────────────────────────────────────────
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Value and gradient.
vec3 vnoised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * vec2(b - a + k * u.y, c - a + k * u.x));
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

// ── sky ─────────────────────────────────────────────────────────────────────────────────────────
// Gradient by elevation, mixed in sRGB like the palette was designed, then glow around the sun.
vec3 skyBase(vec3 d) {
  float el = asin(clamp(d.y, 0.0, 1.0));
  float t = 1.0 - exp(-el / 0.2);
  vec3 c = t < 0.45 ? mix(uSkyHorizon, uSkyMid, t / 0.45) : mix(uSkyMid, uSkyZenith, smoothstep(0.45, 0.85, t));
  return toLinear(c);
}

vec3 sunGlowAt(vec3 d, float aureole) {
  float g = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  float el = max(d.y, 0.0);
  // A tight aureole, a broad bloom, and at low sun a warm band hugging the horizon under it.
  float band = exp(-el / 0.05) * exp(-g * g / 0.9) * uGolden;
  return uSunGlow * (0.9 * aureole * exp(-g / 0.05) + 0.35 * exp(-g / 0.5) + band * 0.9);
}

// The sky seen in reflections leaves out the aureole: the specular lobe already carries the sun's
// image, spread by the waves the way the aureole would otherwise print a hard column.
vec3 reflectedSky(vec3 d) {
  vec3 c = skyBase(d) + sunGlowAt(d, 0.0);
  float gm = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  return c + uMoonLight * 0.35 * exp(-gm / 0.12);
}

vec3 skyColor(vec3 d) {
  vec3 c = skyBase(d) + sunGlowAt(d, 1.0);
  float gm = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  c += uMoonLight * 0.35 * exp(-gm / 0.12);
  return c;
}

// Haze takes on the sky's color just above the horizon at the same bearing, glow and all.
vec3 hazeColor(vec3 d) {
  vec3 h = normalize(vec3(d.x, 0.015, d.z));
  return skyColor(h);
}

// ── clouds ──────────────────────────────────────────────────────────────────────────────────────
// A deck of stratocumulus on a real cloud base, and thin cirrus far above, as noise fields on
// horizontal planes: perspective crowds them toward the horizon, and they drift with the wind aloft.
float fbm(vec2 p, float octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 7; i++) {
    if (float(i) >= octaves) break;
    sum += amp * vnoise(p);
    norm += amp;
    p = p * 2.03 + vec2(17.1, 3.7);
    amp *= 0.5;
  }
  return sum / norm;
}

float deckThreshold() { return mix(0.74, 0.18, uCloudA.x); }

// Cloud density at a point on the deck, 0–1, and how thick it is there.
// The soft margin widens the edge: a reflection in rough water blurs the clouds it mirrors.
vec2 deck(vec2 xz, float octaves, float soft) {
  vec2 q = (xz + uCloudA.zw) / 2400.0;
  float n = fbm(q, octaves);
  // Billowed edges: fine detail eats into the margins, not the cores.
  if (octaves > 4.5) n += (fbm(q * 9.0 + 3.1, 2.0) - 0.5) * 0.07;
  float th = deckThreshold();
  return vec2(smoothstep(th - soft, th + 0.04 + soft, n), smoothstep(th + 0.03, th + 0.28, n));
}

vec4 clouds(vec3 d, float octaves, float soft) {
  if (d.y < 0.008 || (uCloudA.x < 0.01 && uCloudB.x < 0.01)) return vec4(0.0);
  vec4 result = vec4(0.0);
  // Clouds a kilometre up keep the sun about a degree longer than the beach does, then lose it.
  float sunOn = uCloudB.w;
  float forward = pow(max(dot(d, uSunDir), 0.0), 6.0) * (0.25 + 0.75 * sunOn);
  vec3 warm = uSunGlow * uGolden * sunOn;
  // Cirrus: streaky, thin, lit.
  if (uCloudB.x > 0.01) {
    float t = (9000.0 - uCam.y) / d.y;
    vec2 q = uCam.xz + d.xz * t + uCloudB.yz;
    float n = fbm(vec2(q.x / 9000.0, q.y / 2600.0), min(octaves, 3.0));
    float a = smoothstep(1.0 - uCloudB.x, 1.25 - uCloudB.x, n) * 0.4 * smoothstep(0.02, 0.12, d.y);
    vec3 c = uCloudLit * 1.05 + warm * 1.2 + uSunGlow * forward * 0.8;
    result = vec4(c * a, a);
  }
  if (uCloudA.x > 0.01) {
    float t = (uCloudA.y - uCam.y) / d.y;
    vec2 xz = uCam.xz + d.xz * t;
    // Nearer clouds carry more detail but softer, wispier margins; far ones are crisp texture.
    float near = 1.0 - smoothstep(3000.0, 16000.0, t);
    vec2 dc = deck(xz, octaves < 3.0 ? octaves : octaves + 2.0 * near, soft + 0.035 * near);
    // Seen from below: thick cores gray, thin edges bright, edges near the sun lined with light, and
    // at sunset the undersides facing the sun catch it.
    vec3 c = mix(uCloudLit, uCloudShade, dc.y * 0.9);
    c += uSunGlow * forward * (1.0 - dc.y) * 1.6;
    float toward = max(dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4)), 0.0);
    c += warm * (0.35 + 0.65 * toward) * (1.0 - 0.5 * dc.y) * 1.3;
    // Far clouds sink into the haze.
    float fade = exp(-t / (uVisibility * 2.2));
    c = mix(hazeColor(d), c, fade);
    float a = dc.x * smoothstep(0.008, 0.05, d.y);
    result = vec4(c * a + result.rgb * (1.0 - a), a + result.a * (1.0 - a));
  }
  return vec4(result.rgb / max(result.a, 1e-4), result.a);
}

// Sunlight reaching a surface point through gaps in the deck, relative to the scene's average.
float cloudShadow(vec3 p) {
  if (uCloudA.x < 0.02 || uSunDir.y < 0.03) return 1.0;
  vec3 q = p + uSunDir * ((uCloudA.y - p.y) / uSunDir.y);
  float n = fbm((q.xz + uCloudA.zw) / 2400.0, 3.0);
  float th = deckThreshold();
  float dens = smoothstep(th - 0.06, th + 0.16, n);
  return clamp((1.0 - 0.6 * dens) / (1.0 - 0.6 * uCloudA.x * 0.8), 0.0, 1.4);
}

vec3 skyWithBodies(vec3 d) {
  vec3 c = skyColor(d);
  // Stars, fixed to the sky, dimmed by haze near the horizon and by cloud.
  if (uStars > 0.01) {
    float az = atan(d.x, d.z);
    float el = asin(clamp(d.y, -1.0, 1.0));
    vec2 cell = floor(vec2(az, el) * 260.0);
    float h = hash12(cell);
    if (h > 0.9935) {
      vec2 f = fract(vec2(az, el) * 260.0) - 0.5;
      float s = smoothstep(0.35, 0.0, length(f));
      float tw = 0.65 + 0.35 * sin(uTime * (1.3 + 2.0 * hash11(h * 91.0)) + h * 60.0);
      c += vec3(0.85, 0.9, 1.0) * s * tw * uStars * (h - 0.9935) * 160.0 * smoothstep(0.0, 0.12, el);
    }
  }
  // The moon: a sphere lit by the real sun direction, so its phase and the tilt of its terminator
  // are right. A little earthshine on the dark side.
  float gm = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  float rm = uDiscRadius * 0.95;
  if (uMoonDisc > 0.0 && gm < rm * 1.6) {
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 up = cross(uMoonDir, right);
    vec2 q = vec2(dot(d - uMoonDir, right), dot(d - uMoonDir, up)) / rm;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      vec3 n = right * q.x + up * q.y - uMoonDir * sqrt(1.0 - r2);
      float lit = smoothstep(-0.05, 0.12, dot(n, uSunDir));
      float mare = 0.82 + 0.18 * vnoise(q * 2.3 + 4.0);
      vec3 moon = vec3(1.0, 0.97, 0.9) * mare * (lit * 1.25 + 0.035);
      c = mix(c, moon, uMoonDisc * smoothstep(1.0, 0.9, r2));
    }
  }
  // The sun: limb-darkened disc. Clouds in the 2D layer pass over it.
  float gs = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  if (uSunDisc > 0.0 && gs < uDiscRadius) {
    float r = gs / uDiscRadius;
    vec3 disc = mix(vec3(1.0, 0.98, 0.93), uSunGlow / max(max(uSunGlow.r, uSunGlow.g), 0.001), 0.35 * r * r) * (2.2 - 0.6 * r * r);
    c = mix(c, disc, uSunDisc * smoothstep(1.0, 0.86, r));
  }
  vec4 cl = clouds(d, uQuality > 0.5 ? 5.0 : 4.0, 0.0);
  return mix(c, cl.rgb, cl.a);
}

// ── swell (mirrors waves.ts) ───────────────────────────────────────────────────────────────────
float travel(float zl) {
  float z0 = uSwellB.y;
  float zz = max(zl, 0.0) + z0;
  float k = 2.0 / sqrt(G * uSwellB.x);
  float zd = uSwellB.w;
  if (zz < zd) return k * (sqrt(zz) - sqrt(z0));
  return k * (sqrt(zd) - sqrt(z0)) + (zz - zd) / uSwellB.z;
}
// Real swell is short-crested: a spread of directions and periods bends each crest a little. A slow
// warp of the phase does the same.
float swellPhase(vec2 xz) {
  return uSwellA.y + uSwellA.x * (travel(xz.y - uSwellC.x) + uSwellA.z * xz.x) + 2.2 * (vnoise(xz / 260.0) - 0.5);
}

float crestGain(float k, float x) {
  float group = 0.5 + 0.5 * sin(TAU * k / uSwellC.w + 1.3);
  float beat = 0.5 + 0.5 * sin(TAU * k / (uSwellC.w * 1.73) + 4.1);
  float set = 0.55 + 0.5 * group * (0.55 + 0.45 * beat) + 0.18 * (hash11(k) - 0.5);
  float lam = uSwellD.y;
  float bars = 0.6 * sin(TAU * x / lam + 0.8) + 0.4 * sin(TAU * x / (lam * 0.53) + 2.9);
  float lumps = sin(TAU * x / (lam * 0.71) + k * 2.1);
  float peak = 1.0 + uSwellD.x * 0.45 * (0.8 * bars + 0.35 * lumps);
  float shade = 1.0;
  if (uShadow.x != 0.0) shade = 1.0 - (1.0 - uShadow.w) * smoothstep(uShadow.y, uShadow.z, uShadow.x * x);
  return set / 0.8 * peak * shade;
}
float breakDist(float k, float x) { return uSwellC.y * crestGain(k, x) / uSwellC.z / uSwellB.x; }
float amplitude(float k, float x, float zl) {
  float h = uSwellC.y * crestGain(k, x);
  float zb = h / uSwellC.z / uSwellB.x;
  if (zl >= zb) return 0.5 * h * clamp(pow(zb / max(zl, 1e-3), 0.25), 0.18, 1.0);
  return 0.5 * h * pow(max(zl, 0.0) / zb, 0.9);
}
float profileAngle(float u, float front) {
  float back = 1.0 - front;
  return u < back ? PI * u / back : PI + PI * (u - back) / front;
}

// Surface height; also hands back the phase terms the foam needs.
float elevation(vec2 xz, out float uOut, out float nOut) {
  float zl = xz.y - uSwellC.x;
  float cyc = swellPhase(xz) / TAU;
  float n = floor(cyc);
  float u = cyc - n;
  float k = mod(uSwellA.w + n, 4096.0);
  float a0 = amplitude(k, xz.x, zl);
  float a1 = amplitude(mod(k + 1.0, 4096.0), xz.x, zl);
  float a = mix(a0, a1, smoothstep(0.25, 0.85, u));
  float zb = uSwellC.y / uSwellC.z / uSwellB.x;
  float steep = smoothstep(zb * 4.0, zb, zl);
  float bore = smoothstep(zb, zb * 0.55, zl);
  float w = 0.5 + 0.5 * cos(profileAngle(u, 0.5 - 0.2 * steep - 0.08 * bore));
  float q = 1.0 + 2.4 * steep - 1.1 * bore;
  float primary = a * (2.0 * pow(w, q) - 1.0);
  float secondary = uSecond.w * smoothstep(0.0, zb * 1.5, zl) * cos(uSecond.x * xz.x + uSecond.y * xz.y + uSecond.z);
  uOut = u;
  nOut = n;
  return primary + secondary;
}
float elevationOnly(vec2 xz) { float u; float n; return elevation(xz, u, n); }

// ── foam ────────────────────────────────────────────────────────────────────────────────────────
// Whitewater is material, not a pattern the wave uncovers. A crest about to break feathers white
// along its top; once it breaks a roller rides its face, and behind the roller it sheds foam into the
// water. That foam keeps the bore's momentum for a moment, surging shoreward, then slows (and slows
// more as the water shallows), drifts along the beach on the current and the wind, spreads, tears
// into patches and lace, darkens as its bubbles burst, and is gone within a couple of periods. All of
// it is a closed form of place and time, so each patch keeps its shape from frame to frame and can be
// followed for seconds. The formulas mirror waves.ts.

const float SURGE = 0.7;   // foam's starting speed as a share of the bore's
const float SLOW_S = 2.8;  // seconds for that speed to fall by e

float boreSpeed(float zl) { return min(uSwellB.z, sqrt(G * uSwellB.x * (max(zl, 0.0) + uSwellB.y))); }

float section(float k, float x) { return 0.5 + 0.5 * smoothstep(0.15, 0.8, vnoise(vec2(x / 45.0 + k * 7.13, k * 0.37))); }

float release(float zr, float zb, float sec) {
  float broke = smoothstep(zb * 1.02, zb * 0.86, zr);
  float spent = max(0.0, travel(zb) - travel(zr));
  float big = clamp(zb / (uSwellC.y / uSwellC.z / uSwellB.x), 0.6, 1.4);
  return min(1.0, broke * (0.3 + 0.8 * sec * big * (0.25 + 0.75 * exp(-spent / (uSwellD.w * 1.3)))));
}

float shedDistance(float zl, float a, float V, float w) {
  float t0 = travel(zl);
  float d = V * (1.0 - exp(-a / SLOW_S)) + w * a;
  for (int i = 0; i < 2; i++) {
    float tau = a + travel(zl + d) - t0;
    float e = exp(-tau / SLOW_S);
    float g = V * (1.0 - e) + w * tau - d;
    float dg = (V / SLOW_S * e + w) / boreSpeed(zl + d) - 1.0;
    d -= g / dg;
  }
  return max(d, 0.0);
}

// Each crest's foam has its own texture.
vec2 seed(float k) { return vec2(hash11(k * 1.37) * 400.0, hash11(k * 2.11 + 3.0) * 200.0); }

// Foam over a patch of water, 0–1, and how thick it is there, from how much of it is still white
// (cover) and where it sits in its own frame (m: metres alongshore and cross-shore, carried with the
// foam). Broad sheets carry most of it, drawn out along the crest that laid them; channels open
// between them as the foam ages (frag); a light bubble texture shows only up close. foot holds the two
// edges of a pixel's footprint in the same frame (along the view, then across it): any octave a pixel
// can't hold folds into a wider edge instead of shimmering, so far foam averages out and near foam
// keeps a soft, irregular edge that is never a hard cutoff.
vec2 foamCover(vec2 m, float cover, float frag, vec4 foot) {
  if (cover < 0.004) return vec2(0.0);
  vec2 sL = vec2(14.0, 8.0);
  vec2 sM = vec2(4.8, 2.8);
  vec2 sS = vec2(1.6, 1.0);
  float vL = smoothstep(0.7, 0.3, max(length(foot.xy / sL), length(foot.zw / sL)));
  float vM = smoothstep(0.7, 0.3, max(length(foot.xy / sM), length(foot.zw / sM)));
  float vS = smoothstep(0.7, 0.3, max(length(foot.xy / sS), length(foot.zw / sS))) * step(0.5, uQuality);
  vec3 nL = vnoised(m / sL);
  vec3 nM = vnoised(m / sM + 7.3);
  vec3 nS = vS > 0.0 ? vnoised(m / sS - 2.1) : vec3(0.5, 0.0, 0.0);
  float lace = 0.2 + 0.6 * frag;
  float mid = mix(nM.x, 1.0 - abs(2.0 * nM.x - 1.0), lace);
  vec2 midG = mix(nM.yz, -2.0 * sign(2.0 * nM.x - 1.0) * nM.yz, lace);
  float f = 0.5 + 0.5 * vL * (nL.x - 0.5) + 0.36 * vM * (mid - 0.5) + 0.14 * vS * (nS.x - 0.5);
  vec2 grad = 0.5 * vL * nL.yz / sL + 0.36 * vM * midG / sM + 0.14 * vS * nS.yz / sS;
  // Change across one pixel, and the variance of the octaves folded away (each octave's is 0.046).
  float aa = abs(dot(grad, foot.xy)) + abs(dot(grad, foot.zw));
  float lost = 0.046 * (pow(0.5 * (1.0 - vL), 2.0) + pow(0.36 * (1.0 - vM), 2.0) + pow(0.14 * (1.0 - vS), 2.0));
  float w = sqrt(0.00015 + aa * aa + 4.8 * lost);
  // The level that leaves the cover asked for above it: the field is close to normal, mean 0.5
  // (a little higher as channels open) and sd 0.136, and a logistic stands in for its inverse.
  float c = clamp(cover, 0.001, 0.999);
  float th = 0.5 + 0.05 * lace - 0.08 * log(c / (1.0 - c));
  // And how thick it is: well above the level it's dense and bright; near its margins, thin.
  return vec2(smoothstep(th - w, th + w, f), smoothstep(th, th + 0.2 + w, f));
}

// Adds a layer of foam under what's already there, from its alpha and albedo.
void layer(inout vec3 acc, float a, float albedo) {
  a *= 1.0 - acc.x;
  acc.x += a;
  acc.y += a * albedo;
}
// The same for textured foam: its thick cores are brighter and more opaque than its thin margins.
void layer(inout vec3 acc, vec2 foam, float opacity, float albedo) {
  layer(acc, foam.x * opacity * (0.75 + 0.25 * foam.y), albedo * (0.72 + 0.36 * foam.y));
}

// The top of a crest nearing its break feathers white in patches, peaks first: a thin line that
// hands over to the roller as it breaks. dtc is seconds from the crest; never thinner than a pixel.
float feather(float k, float dtc, float zb, float x, float zl, float c, float footZ) {
  float pre = smoothstep(zb * 1.3, zb * 1.02, zl) * smoothstep(zb * 0.86, zb * 1.02, zl);
  if (pre <= 0.0) return 0.0;
  float line = max(0.3, 1.5 * footZ / c);
  float patchy = smoothstep(0.35, 0.75, vnoise(vec2(x / 9.0 + k * 3.1, k * 0.53)));
  return pre * patchy * exp(-dtc / line) * (0.3 / line) * 0.5 * section(k, x);
}

// Whitewater at a point of the sea: x the foam's alpha, y its albedo.
vec2 seaFoam(vec2 xz, float zl, float u, float n, float period, vec4 foot) {
  vec3 acc = vec3(0.0);
  float footZ = abs(foot.y) + abs(foot.w);
  float zbAvg = uSwellC.y / uSwellC.z / uSwellB.x;
  float c = boreSpeed(zl);
  // Foam goes where the wind and the current take it; onshore wind pushes it in a little faster.
  vec2 drift = vec2(uDrift.x, 0.0) + uWind.xy * uWind.z * 0.03;
  float wShore = max(-0.08, -drift.y);

  if (zl < zbAvg * 2.2) {
    float k1 = mod(uSwellA.w + n + 1.0, 4096.0);
    float k0 = mod(uSwellA.w + n, 4096.0);
    float toArrive = (1.0 - u) * period;
    float zb1 = breakDist(k1, xz.x);
    float zb0 = breakDist(k0, xz.x);

    // Formation: the crest coming in, and the one that just went by, feathering at the top.
    float fe = max(feather(k1, toArrive, zb1, xz.x, zl, c, footZ), feather(k0, u * period, zb0, xz.x, zl, c, footZ));
    layer(acc, min(fe, 0.6), 0.8);

    // The roller on the face of the crest coming in, once it has broken: a thin line at the break that
    // grows down the face over a couple of seconds, its toe ragged and slowly churning. Its texture
    // rides with the crest; the moment the crest passes, the same foam is left in the water below.
    if (zl < zb1 * 1.02 && toArrive < 2.5) {
      float sec = section(k1, xz.x);
      float spent = max(0.0, travel(zb1) - travel(zl));
      float ragged = vnoise(vec2(xz.x / 7.0 + k1 * 3.3, spent * 0.15));
      float len = clamp(0.11 * period, 0.5, 1.5) * (0.2 + 0.8 * smoothstep(0.0, 2.5, spent)) * (0.7 + 0.6 * ragged);
      float cover = release(zl, zb1, sec) * smoothstep(len, len * 0.5, toArrive);
      vec2 m = vec2(xz.x, zl + c * toArrive) + seed(k1);
      layer(acc, foamCover(m, cover, 0.0, foot), 0.95, 0.8);
    }

    // What the last two crests shed.
    for (int j = 0; j < 2; j++) {
      float k = mod(k0 - float(j) + 4096.0, 4096.0);
      float a = (u + float(j)) * period;
      float zb = j == 0 ? zb0 : breakDist(k, xz.x);
      if (zl > zb * 1.02) continue;
      float sec = section(k, xz.x);
      float V = SURGE * c * SLOW_S * (0.55 + 0.45 * sec);
      float zr = zl + shedDistance(zl, a, V, wShore);
      float tau = a + travel(zr) - travel(zl);
      float life = uSwellD.w * (0.6 + 0.5 * sec);
      float cover = release(zr, zb, sec) * exp(-tau / life) * smoothstep(2.0 * period, 1.5 * period, tau);
      if (cover < 0.004) continue;
      float fresh = exp(-tau / (0.5 * life));
      // Where it sits in its own frame: carried along the beach, and pulled apart sideways as it spreads.
      vec2 m = vec2(xz.x - drift.x * tau, zr) + seed(k);
      m.x += 8.0 * (1.0 - exp(-tau / 5.0)) * (vnoise(m / vec2(24.0, 9.0) + 3.7) - 0.5);
      vec2 d = foamCover(m, cover, 1.0 - exp(-tau / (0.6 * life)), foot);
      // Old foam is thinner and darker: its bubbles burst and the water shows through.
      layer(acc, d, mix(0.6, 0.95, fresh), mix(0.4, 0.8, fresh));
    }
  }

  // Backwash: after each swash drains, a little foam rides the return flow out past the waterline as
  // thin streaks, slowing as it goes, until the next bore runs over it.
  if (zl < 8.0) {
    float cw = swellPhase(vec2(xz.x, uSwellC.x)) / TAU;
    float nw = floor(cw);
    float start = uSwash.x + uDrift.z + 0.4 * uSwash.y;
    float span = min(7.0, 1.6 * period - start);
    for (int j = 0; j < 2; j++) {
      float s = (cw - nw + float(j)) * period - start;
      if (s <= 0.0 || s >= span) continue;
      float k = mod(uSwellA.w + nw - float(j) + 4096.0, 4096.0);
      float carried = uDrift.y * 2.5 * (1.0 - exp(-s / 2.5));
      float cover = 0.45 * smoothstep(0.0, 1.0, s) * exp(-s / (0.45 * span)) * smoothstep(span, 0.6 * span, s) * smoothstep(carried + 2.0, carried, zl);
      vec2 st = vec2(1.0, 2.5);
      layer(acc, foamCover((vec2(xz.x, zl - carried) + seed(k + 17.0)) * st, cover, 0.8, foot * st.xyxy), 0.4, 0.45);
    }
  }

  // Wind whitecaps offshore: short-lived, more of them the harder it blows.
  float wind = smoothstep(5.0, 11.0, uWind.z);
  if (wind > 0.0 && zl > zbAvg * 1.3) {
    vec2 cell = floor(xz / 22.0);
    float h = hash12(cell);
    float cyc = 6.0 + 7.0 * h;
    float tt = fract(uTime / cyc + h * 7.0);
    float on = 1.4 / cyc;
    if (tt < on && hash12(cell + 11.0) < wind * 0.55) {
      vec2 cc = (cell + 0.2 + 0.6 * vec2(hash12(cell + 3.1), hash12(cell + 5.7))) * 22.0;
      vec2 dd = (xz - cc) * vec2(1.0, 1.8);
      float d = length(dd) / (1.2 + 2.0 * h);
      float soft = 0.75 + (length(foot.xy) + length(foot.zw)) / (1.2 + 2.0 * h);
      layer(acc, smoothstep(1.0, 1.0 - soft, d) * sin(tt / on * PI) * (0.5 + 0.5 * vnoise(xz * 0.5 + uTime * 0.1)) * 0.6, 0.75);
    }
  }
  return vec2(acc.x, acc.y / max(acc.x, 1e-4));
}

// ── light on water ──────────────────────────────────────────────────────────────────────────────
float fresnel(float cosT) { return 0.02 + 0.98 * pow(1.0 - clamp(cosT, 0.0, 1.0), 5.0); }

// Beckmann lobe, slope variance s2, scaled for a light of unit irradiance.
float specular(vec3 n, vec3 v, vec3 l, float s2) {
  vec3 h = normalize(v + l);
  float nh = max(dot(n, h), 1e-3);
  float nv = max(dot(n, v), 0.05);
  float nl = dot(n, l);
  if (nl <= 0.0) return 0.0;
  float c2 = nh * nh;
  float tan2 = (1.0 - c2) / c2;
  float d = exp(-tan2 / s2) / (PI * s2 * c2 * c2);
  return fresnel(dot(v, h)) * d / (4.0 * nv);
}

float pierShade(vec3 p) {
  if (uPierA.w <= 0.0 || uSunDir.y < 0.02) return 1.0;
  vec3 q = p + uSunDir * ((uPierB.x - p.y) / uSunDir.y);
  float main = step(uPierA.y, q.z) * step(q.z, uPierA.z) * smoothstep(uPierA.w + 0.4, uPierA.w - 0.2, abs(q.x - uPierA.x));
  float end = smoothstep(uPierB.z + 0.4, uPierB.z - 0.2, abs(q.z - uPierB.y)) * smoothstep(uPierB.w + 0.4, uPierB.w - 0.2, abs(q.x - uPierA.x));
  // Not quite black: sunlit sand and water around it bounce light back in under the deck.
  return 1.0 - 0.75 * max(main, end) * uPierFade;
}

// Sky above a point is partly hidden under the deck.
float pierCover(vec3 p) {
  if (uPierA.w <= 0.0) return 1.0;
  float dx = abs(p.x - uPierA.x);
  float under = step(uPierA.y, p.z) * step(p.z, uPierA.z) * smoothstep(uPierA.w + 3.0, uPierA.w - 1.0, dx);
  float endUnder = smoothstep(uPierB.z + 3.0, uPierB.z - 1.0, abs(p.z - uPierB.y)) * smoothstep(uPierB.w + 3.0, uPierB.w - 1.0, dx);
  return 1.0 - 0.55 * max(under, endUnder) * uPierFade;
}

// Does a reflected ray from p hit the pier? The deck slab is solid; the bents below it are mostly open
// water between piles, so they only dim the reflection.
float slab(vec3 p, vec3 r, vec3 lo, vec3 hi) {
  vec3 inv = 1.0 / r;
  vec3 t0 = (lo - p) * inv;
  vec3 t1 = (hi - p) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float a = max(max(tmin.x, tmin.y), tmin.z);
  float b = min(min(tmax.x, tmax.y), tmax.z);
  return (b > max(a, 0.0) && a < 2500.0) ? 1.0 : 0.0;
}
float pierReflect(vec3 p, vec3 r) {
  if (uPierA.w <= 0.0 || r.y <= 0.0) return 0.0;
  float deck = slab(p, r, vec3(uPierA.x - uPierA.w, uPierB.x - 1.2, uPierA.y), vec3(uPierA.x + uPierA.w, uPierB.x + 1.1, uPierA.z));
  float bents = slab(p, r, vec3(uPierA.x - uPierA.w, 0.0, uPierA.y), vec3(uPierA.x + uPierA.w, uPierB.x - 1.2, uPierA.z));
  return max(deck, bents * 0.3) * uPierFade;
}

// Pier lamps. A lamp's image in rough water is a streak far brighter than the light it casts, so the
// glint and the pool of light it throws have separate strengths.
vec3 lampGlints(vec3 p, vec3 n, vec3 v, float s2) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (float(i) >= uLampCount) break;
    vec4 lamp = uLamps[i];
    vec3 d = lamp.xyz - p;
    float dist2 = dot(d, d);
    c += uLampColor * lamp.w * specular(n, v, d * inversesqrt(dist2), s2 * 0.5 + 0.0015) * (70.0 / (dist2 + 40.0));
  }
  return c;
}

vec3 lampPool(vec3 p) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (float(i) >= uLampCount) break;
    vec4 lamp = uLamps[i];
    vec3 d = lamp.xyz - p;
    c += uLampColor * lamp.w * (6.0 / (dot(d, d) + 30.0));
  }
  return c;
}

// Light on a diffuse surface facing n from the whole sky: the ambient dome, plus the bright band of
// sky toward the sun that a low sun leaves behind.
vec3 skyLight(vec3 n) {
  vec3 towardSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4);
  return uAmbient * (0.75 + 0.35 * n.y) + hazeColor(towardSun) * 0.3;
}

// ── surfaces ────────────────────────────────────────────────────────────────────────────────────
vec3 shadeWater(vec3 p, vec3 rd, float t, float fp, vec4 foot) {
  float period = TAU / uSwellA.x;
  float u;
  float n;
  float h = elevation(p.xz, u, n);
  float zl = p.z - uSwellC.x;

  // Normal from the resolved swell, differenced over about a pixel. Where crests crowd closer than a
  // few pixels on screen they can't be drawn as lines, only as texture: fade them into roughness.
  float e = clamp(fp, 0.06, 25.0);
  float hx = elevationOnly(p.xz + vec2(e, 0.0));
  float hz = elevationOnly(p.xz + vec2(0.0, e));
  vec2 grad = vec2(hx - h, hz - h) / e;
  float cLocal = min(uSwellB.z, sqrt(G * uSwellB.x * (max(zl, 0.0) + uSwellB.y)));
  float crestPx = cLocal * period / fp;
  float swellVis = smoothstep(8.0, 26.0, crestPx);
  float swellAmp = 0.5 * uSwellC.y * clamp(pow(uSwellC.y / uSwellC.z / uSwellB.x / max(zl, 1.0), 0.25), 0.18, 1.0);
  float swellSlope = TAU * swellAmp / (cLocal * period);
  grad *= swellVis;

  // Wind waves: three trains around the wind, each at its own speed, faded out where a pixel can't
  // hold them. What's filtered out becomes roughness, so distant water still scatters light right.
  float U = uWind.z;
  float fetch = mix(1.0, smoothstep(0.0, 420.0, zl), max(uWind.w, 0.0)); // offshore wind: glassy inshore
  float lp = clamp(1.6 * U * U, 1.5, 40.0);
  float s2 = 0.003 + 0.0026 * U * (0.35 + 0.65 * fetch) + uRain * 0.02 + 0.5 * swellSlope * swellSlope * (1.0 - swellVis);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ang = (fi - 1.0) * 0.45 + 0.2 * sin(fi * 4.1);
    vec2 dir = vec2(uWind.x * cos(ang) - uWind.y * sin(ang), uWind.x * sin(ang) + uWind.y * cos(ang));
    float L = lp * (fi == 0.0 ? 1.0 : (fi == 1.0 ? 0.55 : 0.3));
    float k = TAU / L;
    float slope = (0.05 + 0.1 * smoothstep(1.0, 8.0, U)) * fetch * (1.0 - 0.3 * fi);
    float vis = smoothstep(2.5, 7.0, L / fp);
    float ph = k * dot(dir, p.xz) - sqrt(G * k) * uTime + fi * 2.3;
    grad += dir * slope * cos(ph) * vis;
    s2 += 0.5 * slope * slope * (1.0 - vis);
  }
  // Capillary texture, streaked downwind.
  if (uQuality > 0.5) {
    vec2 wd = uWind.xy;
    vec2 q = vec2(dot(p.xz, vec2(wd.y, -wd.x)), dot(p.xz, wd) * 0.45) * 1.6 - vec2(0.0, uTime * (0.4 + U * 0.12));
    vec3 cn = vnoised(q);
    float vis = smoothstep(0.35, 0.12, fp);
    float amp = (0.03 + 0.05 * smoothstep(1.0, 7.0, U)) * fetch;
    grad += vec2(cn.y * wd.y + cn.z * wd.x, -cn.y * wd.x + cn.z * wd.y) * amp * vis;
    s2 += amp * amp * 0.3 * (1.0 - vis);
  }
  grad = clamp(grad, -1.2, 1.2);
  vec3 nrm = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 v = -rd;
  float nv = dot(nrm, v);
  if (nv < 0.02) {
    nrm = normalize(nrm + v * (0.02 - nv));
    nv = 0.02;
  }
  // Facets too small to resolve tilt toward the eye on average: at grazing angles that lowers the
  // Fresnel mirror and lifts the reflection up into bluer sky, so distant water isn't a pale mirror.
  float rough = sqrt(s2);
  float F = fresnel(min(1.0, nv + rough * 0.9));

  vec3 r = reflect(rd, nrm);
  r.y = max(r.y, 0.004);
  // A rough surface reflects a cone of sky, not a line: average across it.
  vec3 r1 = normalize(vec3(r.x, r.y + rough * 0.3, r.z));
  vec3 r2 = normalize(vec3(r.x, r.y + rough * 1.3, r.z));
  vec3 refl = 0.5 * (reflectedSky(r1) + reflectedSky(r2));
  vec4 cr = clouds(r2, 2.0, 0.12);
  refl = mix(refl, cr.rgb, cr.a * 0.5);
  float pr = pierReflect(p, r1);
  refl = mix(refl, uPierColor, pr * 0.8);

  // Water body: the bottom and suspended sand show through in the shallows, more in the surf zone.
  float depth = max(0.0, zl * uSwellB.x + uTide.x * 0.0);
  float zbAvg = breakDist(mod(uSwellA.w + n, 4096.0), p.x);
  float surfZone = smoothstep(zbAvg * 1.6, zbAvg * 0.5, zl);
  vec3 body = mix(uWaterDeep, uWaterShallow, exp(-depth / uClarity));
  body = mix(body, uWaterTurbid, surfZone * 0.7);
  // Cloud shadows read up close; far out their edges crowd into lines, so they blend to the average.
  float shade = pierShade(p) * mix(1.0, cloudShadow(p), exp(-t / 2200.0));
  float cover = pierCover(p);
  vec3 incoming = uAmbient * cover + uSunLight * max(uSunDir.y, 0.0) * shade + uMoonLight * max(uMoonDir.y, 0.0) + lampPool(p);
  vec3 col = body * incoming * (1.0 - F) * 0.5 + refl * F * mix(1.0, cover, 0.6);

  // Crest glow: thin water at the top of a steepening wave lights up when the sun is behind it.
  float crest = smoothstep(0.08, 0.35, h / max(uSwellC.y, 0.2)) * smoothstep(zbAvg * 3.0, zbAvg, zl);
  float backlit = pow(max(dot(-v, uSunDir), 0.0), 3.0);
  col += uWaterShallow * uSunLight * crest * (0.15 + 0.6 * backlit) * shade * 0.6;

  // Glitter and glints.
  col += uSunLight * specular(nrm, v, uSunDir, s2) * shade * 0.8;
  col += uMoonLight * specular(nrm, v, uMoonDir, s2) * 0.35;
  col += lampGlints(p, nrm, v, s2);

  // Foam sits on top of it all, lit by the same sun and sky.
  vec2 foam = seaFoam(p.xz, zl, u, n, period, foot);
  // Foam is a rough diffuse surface lit by the whole sky (the bright horizon under a low sun
  // included), the moon as high as it stands, and the lamps close by. It's only as bright as the light
  // reaching it, so at night it's a cool gray, brightest where a crest has just broken, and seen
  // edge-on far out it shows more of its own shadows.
  float edgeOn = mix(0.72, 1.0, smoothstep(0.03, 0.25, -rd.y));
  vec3 foamLight = skyLight(vec3(0.0, 1.0, 0.0)) * 1.25 * cover + uSunLight * (0.55 + 0.45 * max(uSunDir.y, 0.0)) * shade + uMoonLight * (0.35 + 0.65 * max(uMoonDir.y, 0.0)) + lampPool(p) * 1.5;
  col = mix(col, uFoam * foam.y * edgeOn * foamLight, foam.x);
  return col;
}

vec3 shadeSand(vec3 p, vec3 rd, vec4 foot) {
  float footZ = abs(foot.y) + abs(foot.w);
  float period = TAU / uSwellA.x;
  float zl = p.z - uSwellC.x;
  float face = uSwash.z;
  float onFace = step(p.y, uSwash.w - 0.01);
  vec3 nrm = normalize(vec3(0.0, 1.0, face * onFace));
  vec3 v = -rd;
  float shade = pierShade(p) * cloudShadow(p);
  float runup = uSwellD.z;

  // Swash: the last three waves to reach the sand. Each creeps up the face losing speed, rests a
  // moment at the top, then drains, slowly at first. The run-up comes in tongues: beach cusps a few
  // run-ups apart, and a wandering edge.
  float phi0 = swellPhase(vec2(p.x, uSwellC.x));
  float c0 = phi0 / TAU;
  float n0 = floor(c0);
  float u0 = c0 - n0;
  float tu = uSwash.x;
  float th = uDrift.z;
  float td = uSwash.y;
  float cusp = 0.78 + 0.22 * sin(TAU * p.x / max(runup * 4.5, 12.0));
  float sheet = 0.0;
  float edge = 0.0;
  float gloss = 0.0;
  float damp = 0.0;
  vec3 residue = vec3(0.0);
  for (int j = 0; j < 3; j++) {
    float fj = float(j);
    float k = mod(uSwellA.w + n0 - fj, 4096.0);
    float age = (u0 + fj) * period;
    float wander = 0.75 + 0.5 * vnoise(vec2(p.x * 0.07, k * 1.3)) + 0.12 * (vnoise(vec2(p.x * 0.45, k)) - 0.5);
    float R = runup * crestGain(k, p.x) * cusp * wander;
    float ex = -1.0;
    if (age < tu) ex = R * (1.0 - pow(1.0 - age / tu, 2.2));
    else if (age < tu + th) ex = R;
    else if (age < tu + th + td) ex = R * (1.0 - ((age - tu - th) / td) * ((age - tu - th) / td));
    float inside = ex + zl;
    if (inside > 0.0) {
      float sh = smoothstep(0.0, 0.25 + 0.25 * R, inside);
      sheet = max(sheet, sh);
      // The leading edge is a thin, clear lip of water, a little foam in it on the way up. It's
      // widened to at least a pixel and dimmed to match, so it never breaks into steps.
      float band = (0.12 + 0.2 * (1.0 - age / (tu + th + td)));
      float wide = max(band, 1.5 * footZ);
      float lip = smoothstep(wide, 0.0, inside) * band / wide;
      if (age < tu) edge = max(edge, lip * (0.5 - 0.3 * age / tu));
      else edge = max(edge, lip * 0.12 * (1.0 - (age - tu) / (th + td)));
      // Foam carried on the sheet stretches up the sand with the water and is pulled back down with
      // it: its texture sits in the frame of the fully run-up sheet.
      float along = -zl / max(ex, 0.01);
      vec2 m = vec2(p.x, along * R) + seed(k + 5.0);
      float cover = 0.55 * smoothstep(0.0, 0.6, age) * exp(-age / (tu + th + td));
      layer(residue, foamCover(m, cover, 0.75, foot * vec2(1.0, R / max(ex, 0.01)).xyxy), sh, 0.6);
    }
    // Where it drained, the sand stays wet: glossy for a moment, dark for longer. The top of the wet
    // patch is a soft line a pixel or so wide, not a step.
    float reach = smoothstep(0.0, max(0.15, footZ), R + zl);
    if (reach > 0.0) {
      float ret = tu + th + td * sqrt(clamp(1.0 + zl / R, 0.0, 1.0));
      float since = age - ret;
      if (since > 0.0) {
        gloss = max(gloss, exp(-since / 2.2) * reach);
        damp = max(damp, exp(-since / 40.0) * reach);
      }
    }
  }
  // Below the run-up the sand stays saturated; above it, it dries toward the berm.
  damp = max(damp, smoothstep(-runup * 1.6, -runup * 0.2, zl) * 0.75);
  // On a falling tide, the sand the high tide covered is still a little damp, with a soft line of
  // stranded kelp at the top of it.
  float wrack = 0.0;
  if (uTide.z > 0.5) {
    float top = uTide.y - runup * 1.2;
    damp = max(damp, smoothstep(top - 3.0, top + 5.0, zl) * 0.22);
    float wob = (vnoise(vec2(p.x * 0.25, 1.0)) - 0.5) * 2.0;
    wrack = smoothstep(0.9, 0.0, abs(zl - top + wob)) * smoothstep(0.45, 0.8, vnoise(vec2(p.x * 0.9, p.z * 0.9)));
  }

  // Dry sand: sun on the slope, sky from above; drifts of tone, and faint grain close in.
  float near = smoothstep(45.0, 12.0, length(p - uCam));
  float grain = 0.95 + 0.07 * vnoise(p.xz * 0.06) + 0.04 * vnoise(p.xz * 0.5) + 0.05 * (vnoise(p.xz * 4.0) - 0.5) * near;
  vec3 albedo = uSand * grain;
  vec3 light = skyLight(nrm) * 0.9 + uSunLight * max(dot(nrm, uSunDir), 0.0) * shade + uMoonLight * max(dot(nrm, uMoonDir), 0.0) + lampPool(p) * 0.6;
  vec3 wetAlbedo = albedo * mix(1.0, 0.6, damp) * mix(vec3(1.0), vec3(0.93, 0.95, 1.0), damp);
  vec3 col = wetAlbedo * light * (1.0 - wrack * 0.25);

  // Wet sand mirrors the sky while it's glossy; the sheet of swash more so, over darker sand.
  // Drained sand keeps a patchy sheen for a moment; the moving sheet mirrors the sky properly.
  float wetness = max(gloss * 0.6 * (0.5 + 0.5 * vnoise(p.xz * vec2(0.3, 1.2))), sheet);
  if (wetness > 0.0) {
    float F = fresnel(dot(nrm, v));
    vec3 r = reflect(rd, nrm);
    r.y = max(r.y, 0.004);
    vec3 refl = reflectedSky(normalize(r));
    float s2 = mix(0.035, 0.008, sheet);
    vec3 spec = uSunLight * specular(nrm, v, uSunDir, s2) * shade * 0.7 + uMoonLight * specular(nrm, v, uMoonDir, s2) + lampGlints(p, nrm, v, s2);
    vec3 under = mix(col, uWaterShallow * light * 0.6, 0.3);
    col = mix(col, under, sheet * 0.6);
    col = mix(col, refl, min(0.8, F * mix(0.8, 1.4, sheet)) * wetness) + spec * wetness;
  }
  vec3 foamLight = skyLight(vec3(0.0, 1.0, 0.0)) * 1.25 + uSunLight * (0.55 + 0.45 * max(uSunDir.y, 0.0)) * shade + uMoonLight * (0.35 + 0.65 * max(uMoonDir.y, 0.0)) + lampPool(p);
  layer(residue, edge, 0.75);
  col = mix(col, uFoam * foamLight * residue.y / max(residue.x, 1e-4), residue.x);
  return col;
}

// A pixel's footprint on a surface, as its two edges in world x and z, m: along the view, where it's
// drawn out wherever the view grazes the surface (cosI is the cosine of the angle it meets it at),
// then across it.
vec4 footprint(vec3 rd, float t, float cosI) {
  float across = t / (uF * uPxScale);
  vec2 h = normalize(rd.xz + 1e-6);
  return vec4(h * across / max(cosI, 0.01), vec2(-h.y, h.x) * across);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uView.y * uPxScale - gl_FragCoord.y) / uPxScale;
  vec3 rc = vec3((px.x - uView.x * 0.5) / uF, (uHorizonY - px.y) / uF, 1.0);
  vec3 rd = normalize(vec3(rc.x * uYaw.y + rc.z * uYaw.x, rc.y, -rc.x * uYaw.x + rc.z * uYaw.y));
  vec3 cam = uCam;
  float hWater = cam.y - uTide.x;
  float dip = sqrt(2.0 * hWater / EARTH_R);

  vec3 col;
  if (rd.y > -dip) {
    col = skyWithBodies(rd);
  } else {
    // Where the ray meets the curved sea.
    float a = -rd.y;
    float t = 2.0 * hWater / (a + sqrt(max(a * a - 2.0 * hWater / EARTH_R, 0.0)));
    vec3 p = cam + rd * t;
    p.y = uTide.x;
    float zl = p.z - uSwellC.x;
    // Metres a pixel covers on the surface here: across, and stretched along the view at grazing angles.
    float fp = t / uF / max(a, 0.02) * 0.5;

    // How much of this pixel's footprint is water rather than beach: where the waterline passes
    // through a pixel, both are shaded and blended, so the edge is smooth instead of stepped.
    vec4 f0 = footprint(rd, t, a);
    float wet = smoothstep(-0.5, 0.5, zl / (abs(f0.y) + abs(f0.w)));
    vec3 sand = vec3(0.0);
    float tSand = t;
    if (wet < 1.0) {
      // Up the beach: the sloped face, then the flat berm.
      float face = uSwash.z;
      float ts = (uTide.x + face * (uSwellC.x - cam.z) - cam.y) / (rd.y + face * rd.z);
      vec3 ps = cam + rd * ts;
      if (ps.y > uSwash.w) {
        ts = (uSwash.w - cam.y) / rd.y;
        ps = cam + rd * ts;
      }
      tSand = ts;
      float slope = face * step(ps.y, uSwash.w - 0.01);
      sand = shadeSand(ps, rd, footprint(rd, ts, (a - slope * rd.z) / sqrt(1.0 + slope * slope)));
    }
    vec3 water = vec3(0.0);
    float tWater = t;
    if (wet > 0.0) {
      // Close in, march the swell as a heightfield so crests rise and hide what's behind them.
      // Far out a couple of steps are enough; close in, where waves are tall on screen, up to ten.
      float amax = uSwellC.y * 0.75 + uSecond.w;
      float ampPx = uF * amax / t;
      if (ampPx > 0.12) {
        float t0 = (cam.y - (uTide.x + amax)) / a;
        float t1 = (cam.y - (uTide.x - amax)) / a;
        float steps = clamp(ceil(ampPx * 1.6), 2.0, uQuality > 0.5 ? 8.0 : 5.0);
        float prevT = t0;
        float prevD = (cam.y + rd.y * t0) - (uTide.x + elevationOnly((cam + rd * t0).xz));
        float hitT = t1;
        for (int i = 1; i <= 10; i++) {
          if (float(i) > steps) break;
          float ti = mix(t0, t1, float(i) / steps);
          vec3 q = cam + rd * ti;
          float d = q.y - (uTide.x + elevationOnly(q.xz));
          if (d < 0.0) {
            hitT = prevT + (ti - prevT) * prevD / (prevD - d);
            break;
          }
          prevT = ti;
          prevD = d;
        }
        tWater = hitT;
        p = cam + rd * tWater;
        zl = p.z - uSwellC.x;
      }
      vec4 foot = footprint(rd, tWater, a);
      if (zl < 0.0) water = shadeSand(p, rd, foot);
      else water = shadeWater(p, rd, tWater, fp, foot);
    }
    col = mix(sand, water, wet);
    t = mix(tSand, tWater, wet);

    // Aerial perspective, denser down at the water.
    float trans = exp(-t / uVisibility * (1.0 + uSeaHaze * 1.5));
    col = mix(hazeColor(rd), col, trans);
  }

  // Soft shoulder for highlights, then back to sRGB with a little dither against banding. The dither
  // is fixed to the pixel, so dark gradients don't shimmer from frame to frame.
  col = mix(col, 0.8 + 0.2 * (1.0 - exp(-(col - 0.8) / 0.2)), step(0.8, col));
  vec3 outc = pow(max(col, 0.0), vec3(1.0 / 2.2));
  outc += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
}
`;
