import { FRAGMENT_HEAD, FRAGMENT_TAIL } from "./shaders.ts"

/**
 * The inland water's GLSL (Rivers.tsx; its TSL twin is riverNodes.ts — change both together). The
 * same water as the sea (shaders.ts `waterFragment`: toon bands, sky reflection, glints, the moon's
 * path, foam), lit and fogged the same way, but reading per-vertex data (riverMesh.ts) instead of
 * a baked shore: how the water runs (`aFlow`), how far the bank is (`aShore`), and the foot of the
 * nearest fall (`aFoot`), where it churns white. Still water (a lake) takes the sea's wind-blown
 * swell and rain rings; running water a flow map dragged along its course, faster near a lip.
 */

const SURFACE_UNIFORMS = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uWind;
uniform float uRain;
uniform float uGloom;
uniform float uCloud;
uniform float uFlash;
uniform vec2 uWindDir;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uMoon;
uniform float uNight;
/** Water v2's own clock (the foam's churn; held under prefers-reduced-motion). */
uniform float uCaustics;
`

export const riverVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec2 aFlow;
attribute float aShore;
attribute vec3 aFoot;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vFlow;
varying float vShore;
varying vec3 vFoot;

void main() {
  vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vWorld = worldPosition.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vFlow = aFlow;
  vShore = aShore;
  vFoot = aFoot;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`

export const riverFragment = /* glsl */ `
${FRAGMENT_HEAD}
${SURFACE_UNIFORMS}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vFlow;
varying float vShore;
varying vec3 vFoot;

/** Rain: one ring per cell of a jittered grid, each on its own clock (shaders.ts' own). */
vec3 ripples(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float g = fract(h * 17.31);
  vec2 d = f - (vec2(h, g) - 0.5) * 0.5;
  float r = length(d);
  float age = fract(t * 0.9 + h);
  float ring = r - age * 0.45;
  float wave = sin(ring * 40.0) * exp(-ring * ring * 160.0) * (1.0 - age);
  return vec3(d / max(r, 1e-3) * wave, max(wave, 0.0)) * step(g, 0.8);
}

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float dist = max(vShore, 0.0);
  float speed = length(vFlow);
  // How much it runs: 0 a lake's drift, 1 a river.
  float runs = smoothstep(0.15, 0.6, speed);

  // Slope: the sea's swell on still water; on running water two phases of noise dragged along the
  // flow, cross-faded so the stretching never shows.
  vec2 drift = uWindDir * t;
  vec4 n1 = texture2D(uNoise, p * 0.021 + drift * 0.010);
  vec4 n2 = texture2D(uNoise, p * 0.057 - drift.yx * 0.017 + vec2(0.3, 0.7));
  vec2 swell = (n1.rg * 2.0 - 1.0) * 0.55 + (n2.rg * 2.0 - 1.0) * 0.45;
  float a = fract(t * 0.35);
  float b = fract(t * 0.35 + 0.5);
  float wa = 1.0 - abs(2.0 * a - 1.0);
  vec2 q = p * 0.11;
  vec4 na = texture2D(uNoise, q - vFlow * a * 0.9);
  vec4 nb = texture2D(uNoise, q - vFlow * b * 0.9 + vec2(0.37, 0.61));
  vec2 running = ((na.rg * 2.0 - 1.0) * wa + (nb.rg * 2.0 - 1.0) * (1.0 - wa)) * 0.5 * (0.8 + 0.3 * speed);
  vec2 slope = mix(swell, running, runs) * (0.22 + 0.55 * uWind);
  float crests = 0.0;
  #ifndef NATURE_LOW
  if (uRain > 0.01) {
    vec3 rings = ripples(p * 0.8, t) + ripples(p * 0.8 + vec2(0.5, 0.31), t + 0.47);
    slope += rings.xy * 0.6 * uRain * (1.0 - 0.7 * runs);
    crests = rings.z * uRain * (1.0 - 0.7 * runs);
  }
  #endif
  // The surface's own tilt (a graded reach runs downhill; flat water's is straight up), and the ripples on it.
  vec3 n = normalize(normalize(vNormal) + vec3(-slope.x, 0.0, -slope.y));

  vec3 v = normalize(cameraPosition - vWorld);
  float shadow = getShadowMask();
  float facing = max(dot(n, v), 0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  fresnel = mix(fresnel, 0.35 + 0.65 * fresnel, 0.5);

  // Body: shallow at the banks, deeper out in a lake; a river's channel stays mid-deep.
  float depth = mix(smoothstep(0.4, 5.0, dist), 0.35 + 0.35 * smoothstep(0.3, 2.0, dist), runs);
  #ifdef WATER_V2
  float steps = depth * 3.0 + (slope.x + slope.y) * 0.6;
  float banded = (floor(steps) + smoothstep(0.35, 0.65, fract(steps))) / 3.0;
  depth = mix(depth, clamp(banded, 0.0, 1.0), 0.7);
  #endif
  vec3 body = mix(uShallow, uDeep, depth) * (1.0 - 0.4 * uGloom);
  vec3 lightUp = (fill(vec3(0.0, 1.0, 0.0)) + key(vec3(0.0, 1.0, 0.0), shadow)) * RECIPROCAL_PI;
  vec3 lit = body * lightUp;

  // Reflection: the sky's own colours by the reflected ray's height.
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, r.y));
  sky = mix(sky, vec3(dot(sky, vec3(0.3, 0.55, 0.15))), 0.35 * uCloud);
  sky += uFlash * vec3(0.6, 0.65, 0.8);
  vec3 colour = mix(lit, sky * 0.85, fresnel * (1.0 - 0.3 * uGloom));

  // Glints off the ripples, and by night the moon's broken path (dimmer on a narrow river).
  vec3 h = normalize(uKeyDir + v);
  float sparkle = texture2D(uNoise, p * 0.31 + slope * 0.4).a;
  float spec = pow(max(dot(n, h), 0.0), 220.0) * (0.6 + 1.6 * sparkle);
  colour += uKeyColor * uKeyIntensity * spec * shadow * (1.0 - 0.9 * uCloud) * 1.2;
  colour += fill(vec3(0.0, 1.0, 0.0)) * RECIPROCAL_PI * crests * 0.35;
  if (uMoon > 0.01) {
    float toMoon = max(dot(r, uMoonDir), 0.0);
    float path = pow(toMoon, 90.0) * (0.15 + 1.1 * sparkle * sparkle) + pow(toMoon, 700.0) * 1.4;
    colour += uMoonColor * path * uMoon * mix(0.8, 0.45, runs);
  }

  // Foam: a soft rim along the banks (a band round the waterline the mesh estimates: where the
  // land's own slope lies lower than that, it reads as shallows, not foam); streaks riding the
  // current, thicker where it races to a lip.
  float breakup = texture2D(uNoise, p * 0.13 + vec2(t * 0.01, 0.0)).a;
  float foam = (1.0 - smoothstep(0.05, 0.55 + 0.35 * breakup, dist)) * smoothstep(-1.6, -0.5, vShore);
  float streak = texture2D(uNoise, p * vec2(0.4) - vFlow * t * 0.5).a;
  float race = smoothstep(1.05, 1.6, speed);
  // White water: a graded reach racing down a steep flank (speed past 1.9) breaks up into churn.
  float white = smoothstep(1.9, 3.0, speed);
  float churn = texture2D(uNoise, p * 0.9 - vFlow * t * 0.9 + vec2(0.5, 0.2)).a;
  foam = max(foam * mix(1.0, 0.8, runs),
    smoothstep(0.72 - 0.18 * race - 0.3 * white, 0.9, streak) * (0.35 + 0.4 * race + 0.3 * white) * (1.0 - smoothstep(0.4, 1.6, dist) * (1.0 - race)) * runs);
  foam = max(foam, white * smoothstep(0.42, 0.78, churn) * 0.9 * (1.0 - smoothstep(0.6, 1.8, dist) * 0.5));
  // A fall's foot: solid white where it lands, churned foam boiling out round it.
  if (vFoot.z > 0.5) {
    vec2 d = p - vFoot.xy;
    float off = length(d);
    vec2 away = d / max(off, 1e-3);
    float boil = texture2D(uNoise, p * 0.45 - away * uCaustics * 0.6).a * 0.65
      + texture2D(uNoise, p * 0.9 + vec2(0.3, 0.6) - away * uCaustics * 0.9).a * 0.35;
    float reach = 1.0 - smoothstep(0.8, 4.2, off + breakup * 0.8);
    float landing = 1.0 - smoothstep(0.4, 1.5, off);
    foam = max(foam, max(landing * 0.95, smoothstep(0.66 - 0.3 * reach, 0.8, boil) * reach));
  }
  foam *= 0.85 + 0.15 * uWind;
  vec3 foamLit = vec3(0.92, 0.95, 0.97) * lightUp;
  colour = mix(colour, foamLit, clamp(foam, 0.0, 1.0) * (0.9 - 0.4 * uNight));

  gl_FragColor = vec4(colour, 1.0);
  ${FRAGMENT_TAIL}
}
`

export const fallVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec2 aSheet;
attribute float aPart;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vSheet;
varying float vPart;

void main() {
  vec3 transformedNormal = normalMatrix * normal;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vWorld = worldPosition.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vSheet = aSheet;
  vPart = aPart;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`

/**
 * The falls: a glassy curl over the lip that breaks into streaks of white racing down, ragged at
 * the sides and white at the foot; the spray round the landing boils up and thins out. Opaque:
 * the ragged edges are cut (`discard`), never blended, so the falls need no sorting.
 */
export const fallFragment = /* glsl */ `
${FRAGMENT_HEAD}
${SURFACE_UNIFORMS}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vSheet;
varying float vPart;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float t = uCaustics;
  float foam;
  float glass = 0.0;
  if (vPart < 0.5) {
    // The sheet: across it in world units, how far from its sides, how far down it has come.
    float across = (vUv.x - 0.5) * vSheet.y;
    float side = (0.5 - abs(vUv.x - 0.5)) * vSheet.y;
    float down = vUv.y;
    float rag = texture2D(uNoise, vec2(across * 0.21, down * 0.07 - t * 0.35)).a;
    if (side < 0.12 + 0.75 * rag * smoothstep(0.6, 2.5, down)) discard;
    float streak = texture2D(uNoise, vec2(across * 0.33, down * 0.08 - t * 0.6)).a;
    float fine = texture2D(uNoise, vec2(across * 0.9 + 0.3, down * 0.22 - t * 1.5)).a;
    glass = 1.0 - smoothstep(0.9, 1.8, down);
    foam = smoothstep(0.38, 0.72, streak * 0.65 + fine * 0.5) * (1.0 - glass * 0.85);
    foam = max(foam, smoothstep(vSheet.x - 1.8, vSheet.x - 0.4, down));
  } else {
    // The spray: boiling up from the water, thinning to nothing at its crown.
    float boil = texture2D(uNoise, vec2(vUv.x * 2.6, vUv.y * 0.6 - t * 0.8)).a;
    if (boil < 0.18 + vUv.y * 0.55) discard;
    foam = 0.85;
  }
  float shadow = getShadowMask();
  vec3 light = (fill(n) + key(n, shadow)) * RECIPROCAL_PI;
  vec3 body = mix(uShallow, uDeep, 0.3 + 0.25 * glass) * (1.0 - 0.4 * uGloom) * light;
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, r.y));
  float fresnel = 0.1 + 0.5 * pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 colour = mix(body, sky * 0.85, fresnel * (0.4 + 0.6 * glass));
  vec3 foamLit = vec3(0.92, 0.95, 0.97) * light;
  colour = mix(colour, foamLit, clamp(foam, 0.0, 1.0) * (0.92 - 0.35 * uNight));
  gl_FragColor = vec4(colour, 1.0);
  ${FRAGMENT_TAIL}
}
`
