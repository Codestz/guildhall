/**
 * The cloud deck: a thin, broken layer of cloud high over an island, which a camera far out looks
 * down through and a camera close in never meets. One flat disc (one draw) whose fragments read a
 * small tiling noise twice: the cloud's body (drifting with the wind, broken by the coverage) and the
 * same a few metres toward the sun, so each cloud is lit on its sunward edge and shaded on the other,
 * in a few painterly bands rather than a smooth gradient. Its colours are the clouds' (look.ts) at the
 * hour: white by day, gold at dusk, a dark veil by night.
 *
 * It keeps out of the way: dissolved near the eye and as the camera comes level with it (no clipping
 * through a sheet), thinned over what the camera looks at (the island stays readable), and melted into
 * the horizon with distance (horizon.ts), so its rim never shows. The same body, drawn into the
 * atmosphere's mask, is the shadows it casts along the sun and the footprint the water mirrors.
 */
import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from "three"
import { AIR, GRADE_GLSL, HORIZON_GLSL, SKY_GLSL } from "./air.ts"
import { smoothstep } from "./field.ts"
import { ATMOSPHERE } from "./shade.ts"

export interface DeckOpts {
  /** The deck's middle (x, z) and its radius, metres (as far as the sea: the horizon melts its rim). */
  centre: [number, number]
  radius: number
  /** Its height, metres (`deckHeight`). */
  height: number
  /** The island's half side, metres: the clear patch over the focus scales with it. */
  span: number
}

/** Metres of deck one tile of the noise covers: the biggest clouds are about a quarter of it. */
const SCALE = 420
/** The deck's drift wraps here, metres: a whole number of noise tiles, so it never jumps. */
export const DECK_WRAP = SCALE * 16

/**
 * The deck's height for an island: above its tallest building by a margin, at `share` of the eye's
 * height at the farthest zoom (the rig's tilt floor), so a camera far out looks down through it and
 * one close in stays under it.
 */
export function deckHeight(farEye: number, tallest: number, share = 0.5): number {
  return Math.max(tallest + 40, share * farEye)
}

/** How solid the deck is with the eye `gap` metres above or below it: none level with it. */
export function deckGapFade(gap: number): number {
  return smoothstep(18, 70, Math.abs(gap))
}

/**
 * Where the camera's line of sight crosses the deck (x, z), or null when it does not (the eye under
 * the deck, or the target over it): the clear patch is centred there.
 */
export function deckFocus(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  height: number,
): [number, number] | null {
  const [ex, ey, ez] = eye
  const [tx, ty, tz] = target
  if (ey <= height || ty >= height) return null
  const t = (ey - height) / (ey - ty)
  return [ex + (tx - ex) * t, ez + (tz - ez) * t]
}

/** A tiling value-noise texture: R a broad fbm, G a finer one, both wrapping at the edges. */
export function cloudNoise(size = 128, seed = 7): Uint8Array {
  const lattice = (period: number, salt: number) => {
    const v = new Float32Array(period * period)
    let a = (seed * 9781 + salt * 6271) >>> 0
    for (let i = 0; i < v.length; i++) {
      // mulberry32
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      v[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    return (x: number, y: number) => {
      const fx = (x / size) * period
      const fy = (y / size) * period
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const sx = fx - ix
      const sy = fy - iy
      const u = sx * sx * (3 - 2 * sx)
      const w = sy * sy * (3 - 2 * sy)
      const at = (i: number, j: number) =>
        v[(((j % period) + period) % period) * period + (((i % period) + period) % period)] as number
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * u
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * u
      return top + (bottom - top) * w
    }
  }
  const broad = [lattice(4, 1), lattice(8, 2), lattice(16, 3), lattice(32, 4)]
  const fine = [lattice(8, 5), lattice(16, 6), lattice(32, 7)]
  const fbm = (octaves: ((x: number, y: number) => number)[], x: number, y: number) => {
    let sum = 0
    let weight = 0
    let amp = 1
    for (const o of octaves) {
      sum += amp * o(x, y)
      weight += amp
      amp *= 0.5
    }
    return sum / weight
  }
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = 4 * (y * size + x)
      // stretched apart from the 0.5 the octaves average toward, so thresholds bite
      out[i] = Math.round(255 * smoothstep(0.2, 0.8, fbm(broad, x, y)))
      out[i + 1] = Math.round(255 * smoothstep(0.2, 0.8, fbm(fine, x, y)))
      out[i + 2] = 0
      out[i + 3] = 255
    }
  return out
}

/** The deck's body at a point: shared by the deck and its mask. */
const BODY_GLSL = /* glsl */ `
uniform sampler2D uNoise;
uniform vec2 uDeckDrift;
uniform float uDeckCover;
// The noise at p: the broad shapes, and finer ones turned and scaled so the tiles never line up.
vec2 deckUv( vec2 p ) {
	return ( p + uDeckDrift ) * ${(1 / SCALE).toFixed(6)};
}
float deckFine( vec2 q ) {
	return texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * q * 2.3 + vec2( 0.37, 0.71 ) ).g;
}
float deckNoise( vec2 p ) {
	vec2 q = deckUv( p );
	return 0.68 * texture2D( uNoise, q ).r + 0.32 * deckFine( q );
}
// Where a cloud starts: lower with more cover (0 clear … 1 overcast).
float deckThreshold() {
	return mix( 0.8, 0.42, uDeckCover );
}
`

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vWorld = world.xyz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`

const FRAGMENT = /* glsl */ `
${SKY_GLSL}
${GRADE_GLSL}
${HORIZON_GLSL}
${BODY_GLSL}
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec2 uSunFlat;
// x: how solid the deck is (the gap to the eye, the night veil); y, z: the near fade, metres from the eye
uniform vec3 uDeckFade;
// the clear patch over the focus: x, z, its inner and outer radius
uniform vec4 uDeckHole;
uniform float uDeckHoleMin;
varying vec3 vWorld;
void main() {
	vec3 toFrag = vWorld - cameraPosition;
	float dist = length( toFrag );
	// the horizon haze lies low: a deck seen steeply overhead (from under it) stays clear of it
	float horizon = horizonHaze( dist ) * ( 1.0 - smoothstep( 0.15, 0.6, toFrag.y / dist ) );
	float hole = mix( uDeckHoleMin, 1.0, smoothstep( uDeckHole.z, uDeckHole.w, distance( vWorld.xz, uDeckHole.xy ) ) );
	float fade = uDeckFade.x * smoothstep( uDeckFade.y, uDeckFade.z, dist ) * hole * ( 1.0 - horizon );
	if ( fade < 0.01 ) discard;
	float threshold = deckThreshold();
	// the broad shapes first: where even the finest detail could not lift them to a cloud, sky (most of
	// the deck between the clouds costs one read)
	vec2 q = deckUv( vWorld.xz );
	float a = 0.68 * texture2D( uNoise, q ).r;
	if ( a + 0.32 < threshold ) discard;
	float fine = 0.32 * deckFine( q );
	float n = a + fine;
	// a soft but definite edge: shapes, not smoke
	float body = smoothstep( threshold, threshold + 0.07, n );
	float alpha = body * fade;
	if ( alpha < 0.01 ) discard;
	// lit on the sunward edge (where the noise falls away toward the sun), in three soft bands
	// (the broad shapes only toward the sun: the fine detail is too small to shade)
	float toward = 0.68 * texture2D( uNoise, deckUv( vWorld.xz + uSunFlat * 16.0 ) ).r + fine;
	float lit = clamp( 0.5 + ( n - toward ) * 12.0, 0.0, 1.0 );
	float band = floor( lit * 3.0 ) / 2.0;
	lit = mix( band, lit, 0.35 );
	// thick middles are fuller: brighter on top, darker beneath
	float thick = smoothstep( threshold + 0.05, threshold + 0.3, n );
	float above = step( vWorld.y, cameraPosition.y );
	float light = above > 0.5 ? 0.2 + 0.6 * lit + 0.2 * thick : 0.12 + 0.45 * lit - 0.12 * thick;
	vec3 colour = mix( uShade, uLit, clamp( light, 0.0, 1.0 ) );
	// the far deck takes the sky's colour before it fades out
	if ( horizon > 0.002 ) colour = mix( colour, skyAt( toFrag / dist ), 0.7 * horizon );
	// clouds are a little translucent at their thin edges
	gl_FragColor = vec4( colour, alpha * mix( 0.55, 0.92, thick ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb = airGrade( gl_FragColor.rgb );
}
`

const MASK_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`

const MASK_FRAGMENT = /* glsl */ `
${BODY_GLSL}
uniform vec4 uWindow;
uniform vec2 uSlant;
uniform float uHeight;
varying vec2 vUv;
void main() {
	vec2 p = uWindow.xy + vUv / uWindow.zw;
	float threshold = deckThreshold();
	// R: the shadow on the ground under p, cast from the deck along the sun (softer than the cloud)
	float shadow = smoothstep( threshold - 0.04, threshold + 0.16, deckNoise( p + uSlant * uHeight ) );
	// G: the deck straight over p, which the water mirrors
	float over = smoothstep( threshold, threshold + 0.05, deckNoise( p ) );
	gl_FragColor = vec4( shadow, over, 0.0, 1.0 );
}
`

/** A disc of `radius`, rings packed toward the middle (where the camera looks), facing up. */
function disc(radius: number): BufferGeometry {
  const segments = 64
  const rings = 14
  const position: number[] = [0, 0, 0]
  const index: number[] = []
  for (let j = 1; j <= rings; j++) {
    const r = radius * (j / rings) ** 2
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2
      position.push(Math.cos(a) * r, 0, Math.sin(a) * r)
    }
  }
  const at = (j: number, s: number) => 1 + (j - 1) * segments + (s % segments)
  for (let s = 0; s < segments; s++) index.push(0, at(1, s + 1), at(1, s))
  for (let j = 1; j < rings; j++)
    for (let s = 0; s < segments; s++) {
      const a = at(j, s)
      const b = at(j, s + 1)
      const c = at(j + 1, s)
      const d = at(j + 1, s + 1)
      index.push(a, b, c, b, d, c)
    }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

function deckUniforms(noise: Texture) {
  return {
    uNoise: { value: noise },
    uDeckDrift: { value: new Vector2() },
    uDeckCover: { value: 0.45 },
  }
}

/** The deck and its mask layer. The atmosphere drives them (drift, cover, colours, fades) every frame. */
export function createDeck(opts: DeckOpts) {
  const texture = new DataTexture(cloudNoise(), 128, 128, RGBAFormat, UnsignedByteType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  const body = deckUniforms(texture)
  const uniforms = {
    ...AIR,
    ...body,
    uLit: { value: new Color() },
    uShade: { value: new Color() },
    uSunFlat: { value: new Vector2(1, 0) },
    uDeckFade: { value: new Vector3(1, 30, 110) },
    uDeckHole: { value: new Vector4(0, 0, -2, -1) },
    uDeckHoleMin: { value: 0.15 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  })
  const mesh = new Mesh(disc(opts.radius), material)
  mesh.name = "cloud deck"
  mesh.position.set(opts.centre[0], opts.height, opts.centre[1])
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  const maskUniforms = {
    ...body,
    uWindow: ATMOSPHERE.uCloudWindow,
    uSlant: ATMOSPHERE.uCloudSlant,
    uHeight: { value: opts.height },
  }
  const mask = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      uniforms: maskUniforms,
      vertexShader: MASK_VERTEX,
      fragmentShader: MASK_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    }),
  )
  mask.frustumCulled = false
  const sunFlat = new Vector2()
  return {
    mesh,
    mask,
    uniforms,
    /** Per frame: the eye and what it looks at, for the fades and the clear patch. */
    view(eye: Vector3, target: readonly [number, number, number], veil: number) {
      const gap = eye.y - opts.height
      uniforms.uDeckFade.value.x = deckGapFade(gap) * veil
      // the near fade grows with the gap: from far above the deck may come no nearer than half of it
      const near = Math.max(30, 0.6 * Math.abs(gap))
      uniforms.uDeckFade.value.y = near * 0.5
      uniforms.uDeckFade.value.z = near * 1.6
      const focus = deckFocus([eye.x, eye.y, eye.z], target, opts.height)
      if (focus) uniforms.uDeckHole.value.set(focus[0], focus[1], opts.span * 0.35, opts.span * 0.95)
      else uniforms.uDeckHole.value.set(0, 0, -2, -1)
    },
    /** The sun's (or moon's) direction across the ground: the side the clouds are lit from. */
    sun(x: number, z: number) {
      sunFlat.set(x, z)
      if (sunFlat.lengthSq() < 1e-6) sunFlat.set(1, 0)
      uniforms.uSunFlat.value.copy(sunFlat.normalize())
    },
    dispose() {
      mesh.removeFromParent()
      mesh.geometry.dispose()
      material.dispose()
      mask.geometry.dispose()
      mask.material.dispose()
      texture.dispose()
    },
  }
}

export type Deck = ReturnType<typeof createDeck>
