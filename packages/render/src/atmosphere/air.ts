/**
 * The air between the sky and what it lights, on the GPU: one set of uniforms (written by the sky every
 * hour and every frame, sky.ts) and the GLSL every lit program shares with the dome, so the far land
 * melts into exactly the sky behind it (no horizon line) and the grade is the same on both.
 *
 * - `skyAt(dir)`: the dome's colour in a direction (zenith → horizon, the glow round the sun, the cool
 *   side away from it). The dome draws it; the haze fades toward it.
 * - `skyLight(n)`: the sky's light on a face by the way it faces (blue from above, warm toward the sun,
 *   cool away, bounce from below). It replaces the hemisphere fill in patched programs.
 * - `airHaze(world, colour)`: aerial perspective, past a clear zone round the focus, thicker low down,
 *   and the horizon: by distance from the eye the far sea melts into the sky (`uHorizon`, horizon.ts).
 * - `airGrade(display)`: split toning, saturation and a gentle S curve, in display space.
 *
 * Opt in with `patchAir` (the cloud-shade patch chains it, so the palette material and the water get
 * it). Unpatched programs keep three's hemisphere and linear fog, which the sky still sets.
 */
import { log } from "@guildhall/core"
import { Color, Vector2, Vector3, type WebGLProgramParametersWithUniforms } from "three"

/** The air's uniforms, one object shared by every program that reads them. */
export const AIR = {
  uAirZenith: { value: new Color("#4a82c4") },
  uAirHorizon: { value: new Color("#f1d4ae") },
  uAirAway: { value: new Color("#cfe0ee") },
  uAirGlow: { value: new Color("#ffcf98") },
  /** Where the sun really is (below the horizon by night: the glow fades with it). */
  uAirSun: { value: new Vector3(0, 1, 0) },
  /** How much the warm/cool split of the horizon shows (0 at noon … 1 at golden hour). */
  uAirSplit: { value: 0 },
  uSkyTop: { value: new Color("#9cc3e6") },
  uSkyAway: { value: new Color("#9cc3e6") },
  uSkyToward: { value: new Color("#9cc3e6") },
  uSkyBounce: { value: new Color("#7a6a4f") },
  uSkyIntensity: { value: 1 },
  /** 1: the sky's light replaces the hemisphere fill; 0: the hemisphere as before. */
  uSkyLight: { value: 0 },
  /** Haze: extinction per metre, thinning height (m), its most, where it starts (m from the eye), the far plane. */
  uHazeDensity: { value: 0 },
  uHazeFalloff: { value: 70 },
  uHazeMax: { value: 0.5 },
  uHazeClear: { value: 1e4 },
  uHazeFar: { value: 2000 },
  /**
   * The horizon (horizon.ts sets it): by distance from the eye, everything low melts into the sky's own
   * colour from x to y metres, so far out the sea becomes the horizon before its end or the far plane
   * shows, while the water near the eye stays clear. Its most: 0 is off.
   */
  uHorizon: { value: new Vector2(1e5, 2e5) },
  uHorizonMax: { value: 0 },
  /** Grade: split-tone multipliers, saturation, S curve, and 0/1 for off/on. */
  uGradeShadows: { value: new Color(1, 1, 1) },
  uGradeHighlights: { value: new Color(1, 1, 1) },
  uGradeSaturation: { value: 1 },
  uGradeContrast: { value: 0 },
  uGrade: { value: 0 },
  /** The high thin layer the dome draws (the atmosphere sets it): how much, its colour, its drift (m). */
  uCirrus: { value: 0 },
  uCirrusLit: { value: new Color("#ffffff") },
  uCirrusDrift: { value: new Vector2() },
}

/** The dome's colour in a direction; shared by the dome and the haze. Linear, before tone mapping. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uAirZenith;
uniform vec3 uAirHorizon;
uniform vec3 uAirAway;
uniform vec3 uAirGlow;
uniform vec3 uAirSun;
uniform float uAirSplit;
vec3 skyAt( vec3 d ) {
	float up = d.y;
	vec2 across = normalize( d.xz + vec2( 1e-5 ) );
	vec2 sunFlat = normalize( uAirSun.xz + vec2( 1e-5 ) );
	float side = 0.5 - 0.5 * dot( across, sunFlat );
	// The horizon is warm toward the sun and cooler away from it, more so the lower the sun.
	vec3 horizon = mix( uAirHorizon, uAirAway, uAirSplit * side * side );
	// Above: a soft blend into the zenith with a finite slope at the horizon (a square root there drew a
	// line); below: the horizon itself, so the haze (which fades toward it along the level ray) is one
	// colour from the coast to wherever the sea plane or the far plane ends.
	float rise = 1.0 - pow( 1.0 - clamp( up, 0.0, 1.0 ), 3.0 );
	vec3 colour = mix( horizon, uAirZenith, rise );
	float toward = max( dot( normalize( vec3( d.x, max( up, 0.0 ), d.z ) ), uAirSun ), 0.0 );
	float low = 1.0 - smoothstep( 0.1, 0.7, up );
	// toward^6 and toward^48 by squaring (every lit fragment hazes through here).
	float t2 = toward * toward;
	float t6 = t2 * t2 * t2;
	float t12 = t6 * t6;
	float t24 = t12 * t12;
	colour += uAirGlow * ( 0.35 * t6 + 0.25 * t24 * t24 ) * low * smoothstep( -0.25, 0.02, uAirSun.y );
	return colour;
}
`

/**
 * The horizon's share at a distance from the eye (for the unlit programs, the clouds and the deck, that
 * fade into it as the lit ones do in `airHaze`).
 */
export const HORIZON_GLSL = /* glsl */ `
uniform vec2 uHorizon;
uniform float uHorizonMax;
float horizonHaze( float dist ) {
	float t = smoothstep( uHorizon.x, uHorizon.y, dist );
	// slow to start, so the near sea keeps its blue, then fast toward the horizon
	return uHorizonMax * t * t * ( 2.0 - t );
}
`

/** The display grade (sRGB in, sRGB out). */
export const GRADE_GLSL = /* glsl */ `
uniform vec3 uGradeShadows;
uniform vec3 uGradeHighlights;
uniform float uGradeSaturation;
uniform float uGradeContrast;
uniform float uGrade;
vec3 airGrade( vec3 c ) {
	if ( uGrade < 0.5 ) return c;
	const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
	float lum = dot( c, LUMA );
	vec3 tint = mix( uGradeShadows, uGradeHighlights, smoothstep( 0.04, 0.5, lum ) );
	// Split toning shifts hue, not brightness.
	c *= tint / max( dot( tint, LUMA ), 1e-3 );
	c = mix( vec3( dot( c, LUMA ) ), c, uGradeSaturation );
	c = clamp( c, 0.0, 1.0 );
	return mix( c, c * c * ( 3.0 - 2.0 * c ), uGradeContrast );
}
`

const PARS = /* glsl */ `
#define AIR
${SKY_GLSL}
${GRADE_GLSL}
uniform vec3 uSkyTop;
uniform vec3 uSkyAway;
uniform vec3 uSkyToward;
uniform vec3 uSkyBounce;
uniform float uSkyIntensity;
uniform float uSkyLight;
uniform float uHazeDensity;
uniform float uHazeFalloff;
uniform float uHazeMax;
uniform float uHazeClear;
uniform float uHazeFar;
${HORIZON_GLSL}
// The sky's light on a face with world normal n.
vec3 skyLight( vec3 n ) {
	float up = n.y;
	vec2 sunFlat = normalize( uAirSun.xz + vec2( 1e-5 ) );
	float facing = dot( n.xz, sunFlat );
	vec3 level = mix( uSkyAway, uSkyToward, 0.5 + 0.5 * facing );
	vec3 sky = up >= 0.0 ? mix( level, uSkyTop, up ) : mix( level, uSkyBounce, -up );
	// A level face sees half the sky and half the ground; straight up sees all sky.
	vec3 ground = mix( uSkyBounce, level, 0.5 );
	return uSkyIntensity * mix( ground, sky, 0.5 + 0.5 * up );
}
// Aerial perspective: past the clear zone round the focus, thicker low down; the horizon by distance
// from the eye; all of it at the far plane. Toward the dome's own colour along the ray held level, so
// where the sea ends (or the far plane cuts it) the sky behind is the same colour and no edge shows.
vec3 airHaze( vec3 colour ) {
	vec3 v = vCloudWorld - cameraPosition;
	float dist = length( v );
	float past = max( dist - uHazeClear, 0.0 );
	float thin = exp( -max( vCloudWorld.y, 0.0 ) / uHazeFalloff );
	float amount = uHazeMax * ( 1.0 - exp( -past * uHazeDensity * thin ) );
	amount = max( amount, horizonHaze( dist ) * mix( 0.6, 1.0, thin ) );
	amount = max( amount, smoothstep( 0.75 * uHazeFar, 0.97 * uHazeFar, dist ) );
	if ( amount >= 0.002 ) colour = mix( colour, skyAt( normalize( vec3( v.x, max( v.y, 0.0 ), v.z ) ) ), amount );
	return colour;
}
`

/** The hemisphere's own term in `lights_fragment_begin`, swapped for the sky's light. */
const HEMI = "irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );"
const SKY = /* glsl */ `irradiance += uSkyLight > 0.5
	? skyLight( inverseTransformDirection( geometryNormal, viewMatrix ) ) / float( NUM_HEMI_LIGHTS )
	: getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );`

const TONE = "#include <tonemapping_fragment>"
const FOG = "#include <fog_fragment>"

const logger = log("render:air")
let warned = false

/**
 * `onBeforeCompile` for a lit material, from `patchCloudShade` (which inlines the lights chunk and
 * passes the world position, `vCloudWorld`, that the haze reads: one varying for both, the city has
 * a lot of vertices): the sky's light for the hemisphere fill, the haze before tone mapping, the grade
 * after the colour space (in place of three's fog).
 */
export function patchAir(shader: WebGLProgramParametersWithUniforms): void {
  const fragment = shader.fragmentShader
  if (
    !fragment.includes(HEMI) ||
    !fragment.includes(TONE) ||
    !fragment.includes(FOG) ||
    !fragment.includes("varying vec3 vCloudWorld;")
  ) {
    if (!warned) logger.error("three's light or output chunks moved: no sky light, haze or grade")
    warned = true
    return
  }
  Object.assign(shader.uniforms, AIR)
  shader.fragmentShader = fragment
    // Before main, after every other patch's declarations (the cloud shade's vCloudWorld among them).
    .replace("void main() {", () => `${PARS}\nvoid main() {`)
    .replace(HEMI, () => SKY)
    .replace(TONE, () => `gl_FragColor.rgb = airHaze( gl_FragColor.rgb );\n${TONE}`)
    .replace(FOG, () => "gl_FragColor.rgb = airGrade( gl_FragColor.rgb );")
}
