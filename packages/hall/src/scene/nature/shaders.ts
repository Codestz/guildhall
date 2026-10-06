/**
 * Nature's GLSL. Both materials light themselves from the sky state (sun or moon key, hemisphere
 * fill) the same way three lights the tiles — irradiance × albedo / π — so they sit in the scene
 * without a seam, and take the key light's shadow and the island's radial fog through three's own
 * chunks. No light loops: one key, one fill.
 */

const LIGHT = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uKeyIntensity;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uHemiIntensity;
uniform float uTime;

vec3 fill(vec3 n) {
  return mix(uHemiGround, uHemiSky, 0.5 * n.y + 0.5) * uHemiIntensity;
}
vec3 key(vec3 n, float shadow) {
  return uKeyColor * uKeyIntensity * max(dot(n, uKeyDir), 0.0) * shadow;
}
`

const FRAGMENT_HEAD = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${LIGHT}
`

const FRAGMENT_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
`

// ---- Water -------------------------------------------------------------------------------------

export const waterVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute float aRiver;
varying vec3 vWorld;
varying float vRiver;

void main() {
  vec3 transformed = position;
  vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vWorld = worldPosition.xyz;
  vRiver = aRiver;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`

export const waterFragment = /* glsl */ `
${FRAGMENT_HEAD}
uniform sampler2D uShore;
uniform sampler2D uNoise;
uniform float uShoreHalf;
uniform float uShoreMax;
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
uniform float uLamps;
/** The nearest torch flames: xyz, w = 1 if set. Re-picked on the CPU a couple of times a second. */
uniform vec4 uFlames[FLAMES];
varying vec3 vWorld;
varying float vRiver;

/** Rain: one ring per cell of a jittered grid, each on its own clock. Returns slope, crest. */
vec3 ripples(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float g = fract(h * 17.31);
  vec2 centre = (vec2(h, g) - 0.5) * 0.5;
  vec2 d = f - centre;
  float r = length(d);
  float age = fract(t * 0.9 + h);
  float ring = r - age * 0.45;
  float wave = sin(ring * 40.0) * exp(-ring * ring * 160.0) * (1.0 - age);
  float on = step(g, 0.8);
  return vec3(d / max(r, 1e-3) * wave, max(wave, 0.0)) * on;
}

void main() {
  vec2 p = vWorld.xz;
  vec4 shore = texture2D(uShore, vec2(p.x, -p.y) / (2.0 * uShoreHalf) + 0.5);
  float dist = shore.r * uShoreMax;
  vec2 flow = shore.gb * 2.0 - 1.0;
  float t = uTime;

  // Surface slope: wind-blown swell on the sea and the lake; on the river, two phases of noise
  // dragged along the flow (a flow map), cross-faded so the stretching never shows.
  vec2 slope;
  if (vRiver > 0.5) {
    float speed = 0.9;
    float a = fract(t * 0.35);
    float b = fract(t * 0.35 + 0.5);
    float wa = 1.0 - abs(2.0 * a - 1.0);
    vec2 q = p * 0.11;
    vec4 na = texture2D(uNoise, q - flow * a * speed + vec2(0.0, 0.0));
    vec4 nb = texture2D(uNoise, q - flow * b * speed + vec2(0.37, 0.61));
    slope = ((na.rg * 2.0 - 1.0) * wa + (nb.rg * 2.0 - 1.0) * (1.0 - wa)) * 0.5;
  } else {
    vec2 drift = uWindDir * t;
    vec4 n1 = texture2D(uNoise, p * 0.021 + drift * 0.010);
    vec4 n2 = texture2D(uNoise, p * 0.057 - drift.yx * 0.017 + vec2(0.3, 0.7));
    slope = (n1.rg * 2.0 - 1.0) * 0.55 + (n2.rg * 2.0 - 1.0) * 0.45;
  }
  slope *= 0.22 + 0.55 * uWind;
  float crests = 0.0;
  #ifndef NATURE_LOW
  if (uRain > 0.01) {
    vec3 rings = ripples(p * 0.8, t) + ripples(p * 0.8 + vec2(0.5, 0.31), t + 0.47);
    slope += rings.xy * 0.6 * uRain;
    crests = rings.z * uRain;
  }
  #endif
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

  vec3 v = normalize(cameraPosition - vWorld);
  float shadow = getShadowMask();
  float facing = max(dot(n, v), 0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  fresnel = mix(fresnel, 0.35 + 0.65 * fresnel, 0.5);

  // Body: shallow by the shore, deep further out, lit like the tiles.
  float depth = smoothstep(0.4, 7.5, dist);
  if (vRiver > 0.5) depth = 0.35 + 0.35 * smoothstep(0.3, 2.0, dist);
  vec3 body = mix(uShallow, uDeep, depth) * (1.0 - 0.4 * uGloom);
  vec3 lit = body * (fill(vec3(0.0, 1.0, 0.0)) + key(vec3(0.0, 1.0, 0.0), shadow)) * RECIPROCAL_PI;

  // Reflection: the sky's own colours by the reflected ray's height — no render target.
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, r.y));
  sky = mix(sky, vec3(dot(sky, vec3(0.3, 0.55, 0.15))), 0.35 * uCloud);
  sky += uFlash * vec3(0.6, 0.65, 0.8);
  vec3 colour = mix(lit, sky * 0.85, fresnel * (1.0 - 0.3 * uGloom));

  // Glints: the key light off the ripples, broken up by the fine noise; gone under cloud.
  vec3 h = normalize(uKeyDir + v);
  float sparkle = texture2D(uNoise, p * 0.31 + slope * 0.4).a;
  float spec = pow(max(dot(n, h), 0.0), 220.0) * (0.6 + 1.6 * sparkle);
  colour += uKeyColor * uKeyIntensity * spec * shadow * (1.0 - 0.9 * uCloud) * 1.2;
  // Rain rings catch the grey sky light: under overcast the reflection alone wouldn't show them.
  colour += fill(vec3(0.0, 1.0, 0.0)) * RECIPROCAL_PI * crests * 0.35;

  // Night: the moon's path — a broad, broken lobe of cool silver round the moon's mirror image.
  if (uMoon > 0.01) {
    float toMoon = max(dot(r, uMoonDir), 0.0);
    float path = pow(toMoon, 90.0) * (0.15 + 1.1 * sparkle * sparkle) + pow(toMoon, 700.0) * 1.4;
    colour += uMoonColor * path * uMoon * (vRiver > 0.5 ? 0.45 : 0.8);
  }
  // Torches by the water: each throws a wavering warm streak across the water towards the viewer.
  if (uLamps > 0.01) {
    vec3 glow = vec3(0.0);
    for (int i = 0; i < FLAMES; i++) {
      vec4 flame = uFlames[i];
      if (flame.w < 0.5) continue;
      vec2 toEye = cameraPosition.xz - flame.xz;
      float eye = length(toEye);
      vec2 along = toEye / max(eye, 1e-3);
      vec2 d = p - flame.xz;
      float t = dot(d, along);
      float side = dot(d, vec2(-along.y, along.x)) + (slope.x + slope.y) * 4.0 * (0.4 + 0.6 * smoothstep(0.0, 4.0, t));
      float reach = 3.0 + flame.y * 2.2;
      float streak = exp(-side * side * 4.0) * smoothstep(-0.6, 0.6, t) * exp(-max(t, 0.0) / reach);
      glow += streak * (0.55 + 0.9 * sparkle);
    }
    colour += vec3(1.0, 0.55, 0.22) * glow * uLamps * 4.0;
  }

  // Foam: a soft rim where the water meets land, and wave lines rolling in towards the shore.
  float breakup = texture2D(uNoise, p * 0.13 + vec2(t * 0.01, 0.0)).a;
  float rim = 1.0 - smoothstep(0.05, 0.55 + 0.35 * breakup, dist);
  float foam = rim;
  if (vRiver < 0.5) {
    float band = fract(dist * 0.42 - t * 0.16 + breakup * 0.9);
    float lines = smoothstep(0.78, 0.93, band) * (1.0 - smoothstep(0.93, 1.0, band));
    foam = max(foam, lines * (1.0 - smoothstep(0.6, 3.2, dist)) * smoothstep(0.35, 0.65, breakup + 0.25));
  } else {
    float streak = texture2D(uNoise, p * vec2(0.4) - flow * t * 0.5).a;
    foam = max(foam * 0.8, smoothstep(0.72, 0.9, streak) * 0.35 * (1.0 - smoothstep(0.4, 1.6, dist)));
  }
  foam *= 0.85 + 0.15 * uWind;
  vec3 foamLit = vec3(0.92, 0.95, 0.97) * (fill(vec3(0.0, 1.0, 0.0)) + key(vec3(0.0, 1.0, 0.0), shadow)) * RECIPROCAL_PI;
  colour = mix(colour, foamLit, clamp(foam, 0.0, 1.0) * (0.9 - 0.4 * uNight));

  gl_FragColor = vec4(colour, 1.0);
  ${FRAGMENT_TAIL}
}
`

// ---- Grass -------------------------------------------------------------------------------------

export const grassVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
${LIGHT}
uniform float uWind;
uniform vec2 uWindDir;
uniform float uSnow;
uniform sampler2D uPalette;
#ifdef FLOWERS
attribute vec3 aTint;
#endif
varying float vHeight;
varying vec3 vColour;
varying float vFlower;
varying vec3 vWorld;

void main() {
  float height = uv.y;
  vec3 transformed = position;
  // On a flower mesh, uv.x marks the head (1) apart from the stalk (0).
  #ifdef FLOWERS
  float flower = uv.x;
  #else
  float flower = 0.0;
  #endif
  // Snow presses the tufts down a little.
  transformed.y *= 1.0 - 0.35 * uSnow;
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);

  // Wind: a steady lean plus gusts that travel across the island, more at the tips.
  float phase = dot(worldPosition.xz, vec2(0.37, 0.61));
  float gust = sin(dot(worldPosition.xz, uWindDir) * 0.16 - uTime * (1.1 + 1.6 * uWind));
  float sway = sin(uTime * (1.6 + 2.2 * uWind) + phase) * 0.35 + gust * 0.65;
  float bend = (0.05 + 0.32 * uWind) * (0.55 + 0.45 * sway) + 0.05 * sway;
  float k = height * height;
  worldPosition.xz += uWindDir * bend * k;
  worldPosition.y -= bend * bend * k * 0.6;

  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);

  // The tiles' own grass from the palette, a shade deeper at the root, per-tuft hue jitter.
  vec3 grass = texture2D(uPalette, vec2(0.045, 0.58)).rgb;
  grass *= vec3(0.741, 0.827, 0.776) * vec3(0.86, 1.0, 0.8);
  grass *= mix(0.62, 1.06, height) * (0.9 + 0.2 * fract(phase * 13.7));
  #ifdef FLOWERS
  vColour = mix(grass, aTint, flower);
  #else
  vColour = grass;
  #endif
  vFlower = flower;
  vHeight = height;
  vWorld = worldPosition.xyz;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`

export const grassFragment = /* glsl */ `
${FRAGMENT_HEAD}
uniform float uSnow;
uniform float uWet;
varying float vHeight;
varying vec3 vColour;
varying float vFlower;
varying vec3 vWorld;

void main() {
  float shadow = getShadowMask();
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 albedo = vColour * (1.0 - 0.32 * uWet * (1.0 - vFlower));
  // Frost and snow settle on the upper blades first.
  albedo = mix(albedo, vec3(0.93, 0.96, 1.0), uSnow * smoothstep(0.15, 0.8, vHeight) * (1.0 - 0.5 * vFlower));
  vec3 colour = albedo * (fill(n) + key(n, shadow)) * RECIPROCAL_PI;
  // Wet blades catch the light.
  vec3 v = normalize(cameraPosition - vWorld);
  float spec = pow(max(dot(normalize(uKeyDir + v), normalize(vec3(0.0, 1.0, 0.0) + v * 0.6)), 0.0), 24.0);
  colour += uKeyColor * uKeyIntensity * spec * uWet * vHeight * shadow * 0.08;
  gl_FragColor = vec4(colour, 1.0);
  ${FRAGMENT_TAIL}
}
`
