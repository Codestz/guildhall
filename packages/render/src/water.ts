import { PALETTE } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  bbox,
  clip,
  closest,
  type MultiPolygon,
  orient,
  type Ring,
  type TownDraw,
  type Vec2,
} from "@guildhall/world"
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
import { type FlatMesh, gridMesh } from "./ground.ts"
import type { Stage } from "./stage.ts"
import { patchCascades } from "./sun/patch.ts"

export type WaterDraw = TownDraw["water"]

/** The water's grid pitch near the shore, metres: the shore distance it carries is interpolated across it. */
const PITCH = 4
/** Past this distance from the shore the water is at its deepest colour, metres. */
const DEEP_AT = 10
/** Water further than this past the shore lines' box is all deep: one coarse grid, metres. */
const NEAR = 30
const FAR_PITCH = 40

const logger = log("render:water")

const swatch = (name: string): Color => {
  const s = PALETTE.swatches.find((w) => w.name === name)
  if (!s) throw new Error(`water: no swatch "${name}"`)
  return new Color(s.hex)
}

/** Per vertex of the water's polygons: its distance to the nearest shore line, metres. */
export function shoreDistance(p: Vec2, shore: readonly Vec2[][]): number {
  let best = Number.POSITIVE_INFINITY
  for (const line of shore)
    for (let i = 0; i + 1 < line.length; i++)
      best = Math.min(best, closest(p, line[i] as Vec2, line[i + 1] as Vec2).d)
  return best
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
varying vec3 vWater;

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
      `#include <common>\nattribute float shore;\nvarying float vShore;\nvarying vec3 vWater;`,
    )
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvShore = shore;\nvWater = (modelMatrix * vec4(position, 1.0)).xyz;",
    )
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <dithering_pars_fragment>", () => `#include <dithering_pars_fragment>\n${PARS}`)
    .replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
vec2 vWorld = vWater.xz;
float depth = smoothstep(1.2, ${DEEP_AT.toFixed(1)}, vShore);
diffuseColor.rgb = mix(uShallow, uDeep, depth);
float lap = 0.12 * sin(uTime * 0.9 + vWorld.x * 0.21 + vWorld.y * 0.17);
float foam = 1.0 - smoothstep(0.45 + lap, 1.1 + lap, vShore);
float ring = 1.0 - smoothstep(0.0, 0.18, abs(vShore - (1.7 + 0.35 * sin(uTime * 0.6 + vWorld.x * 0.05))));
foam = max(foam, 0.45 * ring);
foam = max(foam, wakeFoam(vWorld));
diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam);`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `#include <normal_fragment_maps>
float far = length(vViewPosition);
vec2 slope = waveSlope(vWorld, uTime) * mix(1.0, 0.3, smoothstep(40.0, 300.0, far));
normal = normalize(normal + (viewMatrix * vec4(-slope.x, 0.0, -slope.y, 0.0)).xyz * (1.0 - foam));`,
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
	float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 4.0);
	float clear = smoothstep(0.6, 5.0, vShore) * (1.0 - foam);
	outgoingLight = mix(outgoingLight, mirror, fresnel * clear);
	// The coast mirrored: a darker, greener band just off the shore, stronger the flatter the view.
	float bank = (1.0 - smoothstep(1.2, 8.0, vShore)) * smoothstep(0.6, 1.6, vShore) * (1.0 - foam);
	outgoingLight = mix(outgoingLight, uBank * (0.4 + 0.6 * dot(uSkyHorizon, vec3(0.33))), 0.45 * bank * (0.35 + fresnel));
	// The glint path: a broad sheen toward the sun and sparkles where a wave faces it exactly.
	float toward = max(dot(r, uSunDirection), 0.0);
	float glint = 0.18 * pow(toward, 60.0) + 2.4 * pow(toward, 900.0);
	outgoingLight += uSunColor * glint * cloudShade() * (1.0 - foam) * smoothstep(0.0, 0.08, uSunDirection.y);
} else {
	float level = clamp(dot(inverseTransformDirection(normal, viewMatrix), toEye), 0.0, 1.0);
	outgoingLight = mix(outgoingLight, uSky, 0.45 * pow(1.0 - level, 5.0) * (1.0 - foam));
}
#include <opaque_fragment>`,
    )
}

/** The water's polygons on a fine grid near the shore lines and a coarse one past them. */
function waterMesh(w: WaterDraw): FlatMesh {
  const polys: MultiPolygon = w.polys.filter((ring) => ring.length >= 3).map((ring) => [orient(ring, true)])
  const [min, max] = bbox(w.shore.flat())
  const box: Ring = [
    [min[0] - NEAR, min[1] - NEAR],
    [max[0] + NEAR, min[1] - NEAR],
    [max[0] + NEAR, max[1] + NEAR],
    [min[0] - NEAR, max[1] + NEAR],
  ]
  if (w.shore.length === 0) return gridMesh(polys, PITCH)
  const near = gridMesh(clip(polys, [[box]], "intersection"), PITCH)
  const far = gridMesh(clip(polys, [[box]], "difference"), FAR_PITCH)
  const base = near.points.length / 2
  return {
    points: [...near.points, ...far.points],
    indices: [...near.indices, ...far.indices.map((i) => i + base)],
  }
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
 * fresnel, the sun's glint, and the cascaded shadows of what stands over it). One draw call.
 */
export function createWater(stage: Stage, w: WaterDraw): Water {
  const start = performance.now()
  const flat = waterMesh(w)
  const count = flat.points.length / 2
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const shore = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const x = flat.points[2 * i] as number
    const z = flat.points[2 * i + 1] as number
    position.set([x, w.level, z], 3 * i)
    normal[3 * i + 1] = 1
    shore[i] = Math.min(shoreDistance([x, z], w.shore), 1e3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(position, 3))
  geometry.setAttribute("normal", new BufferAttribute(normal, 3))
  geometry.setAttribute("shore", new BufferAttribute(shore, 1))
  geometry.setIndex(flat.indices)
  geometry.computeBoundingSphere()

  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: swatch("water-shallow").lerp(swatch("water-foam"), 0.4) },
    uDeep: { value: swatch("water-shallow").lerp(swatch("water-deep"), 0.3) },
    uFoam: { value: swatch("water-foam") },
    uSky: { value: new Color("#cde2f6") },
    uBank: { value: swatch("grass-dark").lerp(swatch("water-deep"), 0.45) },
    uWakes: { value: Array.from({ length: MAX_WAKES }, () => new Vector4()) },
    uWakeCount: { value: 0 },
  }
  const material = new MeshStandardMaterial({ roughness: 0.28, metalness: 0 })
  material.onBeforeCompile = (shader) => patchWater(shader, uniforms)
  material.customProgramCacheKey = () => "guildhall-water"
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
  logger.info("water", {
    vertices: count,
    triangles: flat.indices.length / 3,
    ms: Math.round(performance.now() - start),
  })
  return {
    mesh,
    setWakes(wakes) {
      const n = Math.min(wakes.length, MAX_WAKES)
      for (let i = 0; i < n; i++) {
        const w = wakes[i] as Wake
        uniforms.uWakes.value[i]?.set(w.x, w.z, w.heading, w.speed)
      }
      uniforms.uWakeCount.value = n
    },
    dispose() {
      unsubscribe()
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
