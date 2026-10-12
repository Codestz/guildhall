import { PALETTE } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { type TownDraw, type WaterGeometry, waterGeometry } from "@guildhall/world"
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Mesh,
  MeshStandardMaterial,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { ATMOSPHERE, patchCloudShade } from "./atmosphere/shade.ts"
import type { ShoreField } from "./shoreField.ts"
import type { Stage } from "./stage.ts"
import { patchCascades } from "./sun/patch.ts"

export type WaterDraw = TownDraw["water"]

/**
 * V1's water (legacy/packages/hall/src/scene/nature/waterNodes.ts) measured its shore distances in its
 * own hex units (HEX_SCALE 5); V2's hexes are 3.1 m across the corners, about 0.6 of V1's. Every V1
 * distance threshold is read in these units, so the bands keep V1's proportions to the tiles.
 */
const V1_UNIT = 0.7
/** V1's sea: deep blue out, a bright teal over the shallows (Water.tsx DEEP, SHALLOW). */
const V1_DEEP = "#1d6aa6"
const V1_SHALLOW = "#3fb0b8"
/** V1's foam, lit like the surface (waterNodes.ts `foamLit`). */
const V1_FOAM = new Color(0.92, 0.95, 0.97)

const logger = log("render:water")

const swatch = (name: string): Color => {
  const s = PALETTE.swatches.find((w) => w.name === name)
  if (!s) throw new Error(`water: no swatch "${name}"`)
  return new Color(s.hex)
}

/** Boats' wakes the water draws at once (`Water.setWakes`). */
export const MAX_WAKES = 8

/** A moving boat's wake: where the boat is, the way it heads (radians from +x toward +z), its speed (m/s). */
export interface Wake {
  x: number
  z: number
  heading: number
  speed: number
}

const PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uBank;
uniform vec4 uWakes[${MAX_WAKES}];
uniform int uWakeCount;
uniform float uReflect;
uniform float uUnit;
#ifdef SHORE_FIELD
uniform sampler2D uField;
uniform vec4 uFieldWindow;
uniform float uFieldReach;
#endif
uniform float uCloudHeight;
uniform float uCloudReflect;
uniform vec3 uCloudLit;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
#ifndef CLOUD_SHADE
uniform sampler2D uCloudMap;
uniform vec4 uCloudWindow;
vec4 cloudMask( vec2 uv ) { return vec4( 0.0 ); }
float cloudShade() { return 1.0; }
#endif
varying float vShore;
varying float vInland;
varying vec3 vWater;

float waterHash( vec2 p ) {
	p = fract( p * vec2( 0.1031, 0.1030 ) );
	p += dot( p, p.yx + 33.33 );
	return fract( ( p.x + p.y ) * p.x );
}
// Value noise in 0..1: what V1 read from its noise texture's alpha (breakup, sparkle, caustics).
float waterNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( waterHash( i ), waterHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( waterHash( i + vec2( 0.0, 1.0 ) ), waterHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}

vec2 waveHash( vec2 p ) {
	p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
	return -1.0 + 2.0 * fract( sin( p ) * 43758.5453 );
}
// Gradient noise's slope (its analytic derivative): a choppy, patternless chop.
vec2 noiseSlope( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	vec2 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
	vec2 ga = waveHash( i );
	vec2 gb = waveHash( i + vec2( 1.0, 0.0 ) );
	vec2 gc = waveHash( i + vec2( 0.0, 1.0 ) );
	vec2 gd = waveHash( i + vec2( 1.0, 1.0 ) );
	float va = dot( ga, f );
	float vb = dot( gb, f - vec2( 1.0, 0.0 ) );
	float vc = dot( gc, f - vec2( 0.0, 1.0 ) );
	float vd = dot( gd, f - vec2( 1.0, 1.0 ) );
	return ga + u.x * ( gb - ga ) + u.y * ( gc - ga ) + u.x * u.y * ( ga - gb - gc + gd )
		+ du * ( u.yx * ( va - vb - vc + vd ) + vec2( vb, vc ) - va );
}

// The wave field's slope: two long swells at odd angles under a choppy noise in two sizes, the
// surface slowly warped so nothing lines up into stripes. Each layer fades out where it would alias
// (more than about a cycle across a pixel), so the far water calms instead of shimmering.
vec2 waveSlope( vec2 p, float t ) {
	p += 4.0 * vec2( sin( p.y * 0.071 + t * 0.13 ), sin( p.x * 0.083 - t * 0.11 ) );
	vec2 s = vec2( 0.0 );
	vec4 swells[ 2 ];
	swells[ 0 ] = vec4( 0.94, 0.33, 0.31, 0.05 );
	swells[ 1 ] = vec4( -0.41, 0.91, 0.57, 0.028 );
	for ( int i = 0; i < 2; i ++ ) {
		vec4 w = swells[ i ];
		float phase = dot( w.xy, p ) * w.z + t * sqrt( 9.8 * w.z );
		s += w.xy * ( w.w * w.z * cos( phase ) * ( 1.0 - smoothstep( 0.5, 1.4, fwidth( phase ) ) ) );
	}
	vec2 a = p * 0.38 + vec2( 0.31, 0.17 ) * t;
	vec2 b = mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 1.05 - vec2( 0.23, 0.41 ) * t;
	s += 0.055 * noiseSlope( a ) * ( 1.0 - smoothstep( 0.25, 0.6, length( fwidth( a ) ) ) );
	s += 0.04 * noiseSlope( b ) * ( 1.0 - smoothstep( 0.25, 0.6, length( fwidth( b ) ) ) );
	return s;
}

// Foam behind each boat: the two arms of a Kelvin wedge (about 19.5 degrees) and the churned trail.
float wakeFoam( vec2 p ) {
	float foam = 0.0;
	for ( int i = 0; i < ${MAX_WAKES}; i ++ ) {
		if ( i >= uWakeCount ) break;
		vec4 w = uWakes[ i ];
		vec2 ahead = vec2( cos( w.z ), sin( w.z ) );
		vec2 q = p - w.xy;
		float behind = -dot( q, ahead );
		float side = abs( dot( q, vec2( -ahead.y, ahead.x ) ) );
		float reach = 1.0 - smoothstep( 0.0, 6.0 + 9.0 * w.w, behind );
		float arms = 1.0 - smoothstep( 0.0, 0.25 + 0.05 * behind, abs( side - 0.35 * behind ) );
		float trail = ( 1.0 - smoothstep( 0.3, 1.2 + 0.04 * behind, side ) ) * 0.8;
		foam = max( foam, step( 0.0, behind ) * reach * max( arms, trail ) * clamp( w.w, 0.0, 1.0 ) );
	}
	return foam;
}

// The sky the water mirrors (sky.ts's dome, the same gradient and glow round the sun).
vec3 mirroredSky( vec3 r ) {
	float up = max( r.y, 0.0 );
	vec3 colour = mix( uSkyHorizon, uSkyZenith, pow( smoothstep( 0.0, 1.0, up ), 0.55 ) );
	float toward = max( dot( r, uSunDirection ), 0.0 );
	return colour + uSkyGlow * ( 0.35 * pow( toward, 6.0 ) + 0.25 * pow( toward, 48.0 ) ) * ( 1.0 - smoothstep( 0.1, 0.7, up ) );
}
`

/**
 * The water's shader additions, after the cascade and cloud-shadow patches: colour by distance to
 * shore (shallow → deep) with a foam band at the shore, a fainter line breathing just off it and the
 * boats' wakes; normals from a few travelling waves (no textures). With the atmosphere's reflections
 * on, a fresnel mirror of the sky, its glow and the clouds overhead, fading to see-through at the
 * shore, a darker band where the coast would mirror, and a glint path of sparkles toward the sun.
 * Without them, the old lean toward the haze at grazing angles.
 */
function patchWater(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: Record<string, { value: unknown }>,
) {
  patchCascades(shader)
  patchCloudShade(shader)
  Object.assign(shader.uniforms, ATMOSPHERE, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>\nattribute float shore;\nattribute float inland;\nvarying float vShore;\nvarying float vInland;\nvarying vec3 vWater;`,
    )
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvShore = shore;\nvInland = inland;\nvWater = (modelMatrix * vec4(position, 1.0)).xyz;",
    )
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <dithering_pars_fragment>", () => `#include <dithering_pars_fragment>\n${PARS}`)
    .replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
vec2 vWorld = vWater.xz;
float shoreD = vShore;
#ifdef SHORE_FIELD
vec2 fieldUv = (vWorld - uFieldWindow.xy) * uFieldWindow.zw;
shoreD = all(greaterThan(fieldUv, vec2(0.0))) && all(lessThan(fieldUv, vec2(1.0)))
	? texture2D(uField, fieldUv).r * uFieldReach
	: uFieldReach;
#endif
bool wInland = vInland > 0.5;
// V1 (waterNodes.ts waterColour), in V1's units: wD is the distance to the shore, wQ the place.
float wD = shoreD / uUnit;
vec2 wQ = vWorld / uUnit;
float wFar = length(vViewPosition);
vec2 wSlope = waveSlope(vWorld, uTime) * mix(1.0, 0.5, smoothstep(40.0, 300.0, wFar));
// V1's broad swell: a slow, large noise that still reads as streaks from the whole-island view.
vec2 wBroad = vWorld * 0.09 + vec2(0.05, 0.03) * uTime;
wSlope += 0.1 * noiseSlope(wBroad) * (1.0 - smoothstep(0.3, 0.7, length(fwidth(wBroad))));
wSlope *= wInland ? 0.6 : 1.0;
float wBreak = waterNoise(wQ * 0.5 + vec2(uTime * 0.04, 0.0));
// Body: shallow by the shore, deep further out, stepped through soft toon bands (V1 water v2).
float wDepth = wInland ? smoothstep(0.3, 2.0, wD) * 0.35 + 0.35 : smoothstep(0.4, 7.5, wD);
float wSteps = wDepth * 3.0 + (wSlope.x + wSlope.y) * 1.8;
float wBanded = (floor(wSteps) + smoothstep(0.35, 0.65, fract(wSteps))) / 3.0;
wDepth = mix(wDepth, clamp(wBanded, 0.0, 1.0), 0.7);
diffuseColor.rgb = mix(uShallow, uDeep, wDepth);
// By night the body calms to a dim, greyer blue (V1 dimmed its water with the light; a saturated
// blue under the moon's fill outshines the land).
float wNight = 1.0 - smoothstep(-0.24, -0.07, uSunDirection.y);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))), 0.4 * wNight) * (1.0 - 0.45 * wNight);
// Caustics: a bright wiggly net where two drifting layers of noise cross, over the sunlit shallows.
float wShallow = (1.0 - smoothstep(0.5, wInland ? 1.8 : 3.5, wD)) * smoothstep(0.15, 0.6, wD);
if (wShallow > 0.01) {
	vec2 cq = wQ * 1.9;
	float c1 = waterNoise(cq + vec2(0.021, 0.013) * uTime * 6.0);
	float c2 = waterNoise(cq * 1.31 - vec2(0.017, -0.019) * uTime * 6.0 + vec2(5.0, 2.0));
	float net = 1.0 - smoothstep(0.0, 0.05, abs(c1 - c2));
	diffuseColor.rgb += vec3(0.85, 1.0, 0.95) * net * net * wShallow * (wInland ? 0.25 : 0.45) * (1.0 - wNight);
}
// Foam: a soft rim where the water meets the land, and wave lines rolling in toward the shore.
float foam = 1.0 - smoothstep(0.05, wBreak * 0.35 + 0.55, wD);
if (!wInland) {
	float band = fract(wD * 0.42 - uTime * 0.16 + wBreak * 0.9);
	float lines = smoothstep(0.78, 0.93, band) * (1.0 - smoothstep(0.93, 1.0, band));
	foam = max(foam, lines * (1.0 - smoothstep(0.6, 3.2, wD)) * smoothstep(0.35, 0.65, wBreak + 0.25));
} else foam *= 0.8;
foam = max(foam, wakeFoam(vWorld));
foam = clamp(foam, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam * (0.9 - 0.4 * wNight));`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `#include <normal_fragment_maps>
normal = normalize(normal + (viewMatrix * vec4(-wSlope.x, 0.0, -wSlope.y, 0.0)).xyz * (1.0 - foam));`,
    )
    .replace(
      "#include <opaque_fragment>",
      /* glsl */ `vec3 toEye = normalize(cameraPosition - vWater);
if (uReflect > 0.5) {
	vec3 n = inverseTransformDirection(normal, viewMatrix);
	vec3 r = reflect(-toEye, n);
	r.y = max(r.y, 0.015);
	vec3 mirror = mirroredSky(r);
	// The clouds mirrored along a calmer normal: the full ripple would scatter them into streaks.
	vec3 rc = reflect(-toEye, normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.1)));
	vec2 hit = vWater.xz + rc.xz * (uCloudHeight - vWater.y) / max(rc.y, 0.06);
	vec2 cuv = (hit - uCloudWindow.xy) * uCloudWindow.zw;
	if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0))))
		mirror = mix(mirror, uCloudLit, 0.7 * uCloudReflect * cloudMask(cuv).g);
	float facing = clamp(dot(n, toEye), 0.0, 1.0);
	// V1's fresnel: Schlick lifted halfway toward a 0.35 floor, so the sky shows even from above.
	float schlick = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
	float fresnel = mix(schlick, schlick * 0.65 + 0.35, 0.5);
	float clear = smoothstep(0.6, 5.0, shoreD) * (1.0 - foam);
	outgoingLight = mix(outgoingLight, mirror * 0.85, fresnel * clear);
	// The coast mirrored: a darker, greener band just off the shore, stronger the flatter the view.
	float bank = (1.0 - smoothstep(1.2, 8.0, shoreD)) * smoothstep(0.6, 1.6, shoreD) * (1.0 - foam) * (wInland ? 0.0 : 1.0);
	outgoingLight = mix(outgoingLight, uBank * (0.4 + 0.6 * dot(uSkyHorizon, vec3(0.33))), 0.45 * bank * (0.35 + fresnel));
	// The glint path: a broad sheen toward the sun and sparkles where a wave faces it exactly.
	float toward = max(dot(r, uSunDirection), 0.0);
	float glint = 0.18 * pow(toward, 60.0) + 2.4 * pow(toward, 900.0);
	outgoingLight += uSunColor * glint * cloudShade() * (1.0 - foam) * smoothstep(0.0, 0.08, uSunDirection.y);
	// V1's glints: the key light off the ripples, broken up by a fine noise (bright: the bloom takes them).
	float wSparkle = waterNoise(wQ * 6.0 + wSlope * 4.0);
	float spec = pow(max(dot(n, normalize(uSunDirection + toEye)), 0.0), 220.0) * (wSparkle * 1.6 + 0.6);
	outgoingLight += uSunColor * spec * 1.2 * cloudShade() * (1.0 - foam) * smoothstep(0.0, 0.08, uSunDirection.y);
} else {
	float level = clamp(dot(inverseTransformDirection(normal, viewMatrix), toEye), 0.0, 1.0);
	outgoingLight = mix(outgoingLight, uSky, 0.45 * pow(1.0 - level, 5.0) * (1.0 - foam));
}
#include <opaque_fragment>`,
    )
}

export interface Water {
  mesh: Mesh
  /** The wakes of the boats moving now (at most MAX_WAKES; more are dropped). */
  setWakes(wakes: readonly Wake[]): void
  dispose(): void
}

/**
 * The water (plan §5): its polygons as one flat mesh at `level`, each vertex carrying its distance to
 * the shore lines; a small patched standard material does the rest (depth tint, foam, ripples, sky
 * fresnel, the sun's glint, and the cascaded shadows of what stands over it). One draw call. Takes
 * the geometry prebuilt (world `waterGeometry`, in a worker) or builds it here from the draw.
 */
export function createWater(stage: Stage, w: WaterDraw | WaterGeometry): Water {
  const start = performance.now()
  const built = "position" in w ? w : waterGeometry(w)
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(built.position, 3))
  geometry.setAttribute("normal", new BufferAttribute(built.normal, 3))
  geometry.setAttribute("shore", new BufferAttribute(built.shore, 1))
  geometry.setAttribute("inland", new BufferAttribute(new Float32Array(built.shore.length), 1))
  geometry.setIndex(new BufferAttribute(built.index, 1))
  geometry.computeBoundingSphere()
  const water = waterMesh(stage, geometry, null)
  logger.info("water", {
    vertices: built.position.length / 3,
    triangles: built.index.length / 3,
    ms: Math.round(performance.now() - start),
  })
  return water
}

/** A pool of water over one hex: its centre and its surface's height. */
export interface WaterPool {
  x: number
  z: number
  y: number
}

export interface FieldWaterOpts {
  /** How far each point is from the land (`bakeShoreField`): depth, foam and waves read it. */
  field: ShoreField
  /** The open sea: a square of `half` metres round `centre`, at `level`. */
  sea: { level: number; half: number; centre?: [number, number] }
  /** Inland water (lakes, rivers): flat hexes of corner radius `size`, drawn as V1 drew its rivers. */
  pools?: { size: number; tiles: readonly WaterPool[] }
}

/**
 * Water over any ground the caller can say is land or not (the hex island): the open sea as one
 * square and the inland pools as hexes, in the same material, reading their shore distances from a
 * baked field instead of per-vertex. One draw call.
 */
export function createFieldWater(stage: Stage, opts: FieldWaterOpts): Water {
  const { sea, pools } = opts
  const [cx, cz] = sea.centre ?? [0, 0]
  const hexes = pools?.tiles ?? []
  const n = 4 + hexes.length * 7
  const position = new Float32Array(n * 3)
  const inland = new Float32Array(n)
  const index: number[] = []
  const h = sea.half
  position.set([
    cx - h,
    sea.level,
    cz - h,
    cx + h,
    sea.level,
    cz - h,
    cx + h,
    sea.level,
    cz + h,
    cx - h,
    sea.level,
    cz + h,
  ])
  index.push(0, 2, 1, 0, 3, 2)
  let v = 4
  const size = pools?.size ?? 1
  for (const t of hexes) {
    const c = v
    position.set([t.x, t.y, t.z], v * 3)
    inland[v++] = 1
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 30)
      position.set([t.x + Math.cos(a) * size, t.y, t.z + Math.sin(a) * size], v * 3)
      inland[v++] = 1
    }
    for (let k = 0; k < 6; k++) index.push(c, c + 1 + ((k + 1) % 6), c + 1 + k)
  }
  const normal = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) normal[i * 3 + 1] = 1
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(position, 3))
  geometry.setAttribute("normal", new BufferAttribute(normal, 3))
  geometry.setAttribute("shore", new BufferAttribute(new Float32Array(n), 1))
  geometry.setAttribute("inland", new BufferAttribute(inland, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  logger.info("field water", { pools: hexes.length, half: h })
  return waterMesh(stage, geometry, opts.field)
}

function waterMesh(stage: Stage, geometry: BufferGeometry, field: ShoreField | null): Water {
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new Color(V1_SHALLOW) },
    uDeep: { value: new Color(V1_DEEP) },
    uFoam: { value: V1_FOAM.clone() },
    uUnit: { value: V1_UNIT },
    uSky: { value: new Color("#cde2f6") },
    uBank: { value: swatch("grass-dark").lerp(swatch("water-deep"), 0.45) },
    uWakes: { value: Array.from({ length: MAX_WAKES }, () => new Vector4()) },
    uWakeCount: { value: 0 },
    uField: { value: field?.texture ?? null },
    uFieldWindow: { value: field?.window ?? new Vector4() },
    uFieldReach: { value: field?.reach ?? 1 },
  }
  const material = new MeshStandardMaterial({ roughness: 0.28, metalness: 0 })
  if (field) material.defines = { SHORE_FIELD: "" }
  material.onBeforeCompile = (shader) => patchWater(shader, uniforms)
  material.customProgramCacheKey = () => (field ? "guildhall-water-field" : "guildhall-water")
  const mesh = new Mesh(geometry, material)
  mesh.name = "water"
  mesh.receiveShadow = true
  stage.scene.add(mesh)

  const unsubscribe = stage.onFrame((dt) => {
    uniforms.uTime.value += dt
    // The fresnel leans toward the haze the sky set (light.ts), so the far water meets the horizon.
    const fog = stage.scene.fog
    if (fog instanceof Fog) uniforms.uSky.value.copy(fog.color)
  })
  return {
    mesh,
    setWakes(wakes) {
      const count = Math.min(wakes.length, MAX_WAKES)
      for (let i = 0; i < count; i++) {
        const w = wakes[i] as Wake
        uniforms.uWakes.value[i]?.set(w.x, w.z, w.heading, w.speed)
      }
      uniforms.uWakeCount.value = count
    },
    dispose() {
      unsubscribe()
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
