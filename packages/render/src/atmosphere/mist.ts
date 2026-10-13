/**
 * The sea mist round an island (V1's look: the island floats in a warm sea of mist, and the sea's end
 * never shows). Two cheap parts:
 *
 * - The fog ring (air.ts `uFogRing`): every lit program, the clouds and the mist fade toward the sky's
 *   own colour by distance across the ground from the island's middle, so far out the sea becomes the
 *   horizon whatever the view, and the sea plane's edge (or the far plane's cut) is never seen.
 * - Banks of low mist: a few stacked horizontal sheets over the sea (one draw, back to front), each a
 *   slowly drifting noise read from one small tiling texture, kept off the coast by the shore field and
 *   thickening outward. Lit like the clouds (look.ts) with a soft sunward rim, tinted by the horizon.
 *
 * No raymarching: per fragment a sheet reads three texels of noise and one of the shore field.
 */
import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector4,
} from "three"
import type { DayLight } from "../light.ts"
import type { ShoreField } from "../shoreField.ts"
import type { Stage } from "../stage.ts"
import { AIR, GRADE_GLSL, RING_GLSL, SKY_GLSL } from "./air.ts"
import { smoothstep } from "./field.ts"
import { cloudLook } from "./look.ts"

export interface MistParams {
  /** The banks' thickness: 0 none, 1 the default, 2 thick (they also creep nearer the coast). */
  mist: number
  /** The fog ring: 0 none (the sea runs to its edge), 1 the default, 2 close in. */
  haze: number
}

export interface MistOpts {
  /** The light now (the sky's `light`): read every frame. */
  light: () => DayLight
  /** The island's middle (x, z) and its radius, metres (the farthest land from the middle). */
  centre: [number, number]
  radius: number
  /** The sea's surface, metres. */
  level: number
  params?: Partial<MistParams>
}

export interface Mist {
  /** How far each point of the water is from land: the banks keep off the coast with it. */
  setShore(field: ShoreField | null): void
  set(params: Partial<MistParams>): void
  params(): MistParams
  dispose(): void
}

export const DEFAULT_MIST: MistParams = { mist: 1, haze: 1 }

/** The sheets' heights over the sea, metres, lowest first (drawn in this order: back to front from above). */
export const SHEETS = [0.5, 1.8, 3.6, 6] as const

/** The fog ring for an island of `radius` at `haze`: where it starts and where it is whole, its most. */
export function fogRing(radius: number, haze: number): { start: number; whole: number; max: number } {
  if (haze <= 0) return { start: 1e5, whole: 2e5, max: 0 }
  const h = Math.min(2, haze)
  return { start: radius * (0.45 + 0.5 / h), whole: radius * (1.0 + 1.4 / h), max: 1 }
}

/** Where the banks start to gather and where they are thickest, metres from the middle. */
export function mistBand(radius: number, mist: number): [number, number] {
  const m = Math.min(2, Math.max(0, mist))
  return [radius * (0.78 - 0.18 * (m - 1)), radius * (1.4 - 0.25 * (m - 1))]
}

/** A tiling value-noise texture: R a broad fbm, G a finer one, both wrapping at the edges. */
export function mistNoise(size = 128, seed = 7): Uint8Array {
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
      const r = smoothstep(0.2, 0.8, fbm(broad, x, y))
      const g = smoothstep(0.2, 0.8, fbm(fine, x, y))
      out[i] = Math.round(255 * r)
      out[i + 1] = Math.round(255 * g)
      out[i + 2] = 0
      out[i + 3] = 255
    }
  return out
}

const VERTEX = /* glsl */ `
attribute float aSheet;
varying vec3 vWorld;
varying float vSheet;
void main() {
	vSheet = aSheet;
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vWorld = world.xyz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`

const FRAGMENT = /* glsl */ `
${SKY_GLSL}
${GRADE_GLSL}
${RING_GLSL}
uniform sampler2D uNoise;
uniform sampler2D uField;
uniform vec4 uFieldWindow;
uniform float uFieldReach;
uniform float uHasField;
uniform vec2 uCentre;
uniform vec2 uBand;
uniform vec2 uDrift;
uniform vec2 uSunFlat;
uniform vec2 uWind;
uniform float uMist;
uniform vec3 uLit;
uniform vec3 uShade;
varying vec3 vWorld;
varying float vSheet;
void main() {
	vec2 p = vWorld.xz;
	// the higher sheets are broader, drift faster and are offset, so the layers never line up
	// banks drawn out along the wind (long soft streaks, not blobs)
	vec2 w = p + uDrift * ( 0.6 + 0.6 * vSheet );
	vec2 q = vec2( dot( w, uWind ), dot( w, vec2( -uWind.y, uWind.x ) ) * 1.9 ) / ( 260.0 + 90.0 * vSheet ) + vSheet * vec2( 0.37, 0.71 );
	float a = texture2D( uNoise, q ).r;
	float b = texture2D( uNoise, q * 2.7 + vec2( 0.13, 0.41 ) - uDrift * 0.004 ).g;
	float n = 0.7 * a + 0.3 * b;
	// off the coast: the shore field (water only; land reads 0), the open sea past its window
	float coast = 1.0;
	if ( uHasField > 0.5 ) {
		vec2 uv = ( p - uFieldWindow.xy ) * uFieldWindow.zw;
		float d = all( greaterThan( uv, vec2( 0.0 ) ) ) && all( lessThan( uv, vec2( 1.0 ) ) )
			? texture2D( uField, uv ).r : 1.0;
		coast = smoothstep( 0.35, 1.0, d );
	}
	float r = length( p - uCentre );
	float out_ = smoothstep( uBand.x, uBand.y, r );
	float thick = clamp( uMist, 0.0, 2.0 );
	float threshold = 0.58 - 0.42 * out_ + 0.06 * vSheet - 0.12 * ( thick - 1.0 );
	float alpha = smoothstep( threshold - 0.1, threshold + 0.4, n );
	alpha *= coast * smoothstep( 0.0, 0.35, out_ + 0.1 ) * ( 0.8 - 0.35 * vSheet ) * min( thick, 1.0 );
	if ( alpha < 0.004 ) discard;
	// lit from the sun's side: brighter where the noise falls away toward the sun (a rim), higher sheets brighter
	float toward = texture2D( uNoise, q + uSunFlat * 0.035 ).r;
	float lit = clamp( 0.55 + ( a - toward ) * 6.0, 0.0, 1.0 );
	lit = mix( lit, 1.0, 0.2 + 0.45 * vSheet );
	vec3 colour = mix( uShade, uLit, 0.3 + 0.7 * lit );
	vec3 toEye = vWorld - cameraPosition;
	// a painterly mist takes the horizon's colour (warm toward the sun, cool away)
	colour = mix( colour, mistColour( normalize( toEye ) ), 0.5 );
	colour = mix( colour, mistColour( normalize( toEye ) ), fogRing( vWorld ) );
	gl_FragColor = vec4( colour, alpha );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb = airGrade( gl_FragColor.rgb );
}
`

/** The stacked sheets: annuli from `inner` to `outer`, one per height, lowest first, with `aSheet` 0..1. */
function sheets(inner: number, outer: number, level: number): BufferGeometry {
  const segments = 96
  const rings = [inner, inner + (outer - inner) * 0.15, inner + (outer - inner) * 0.4, outer]
  const position: number[] = []
  const sheet: number[] = []
  const index: number[] = []
  SHEETS.forEach((h, k) => {
    const base = position.length / 3
    for (const r of rings)
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2
        position.push(Math.cos(a) * r, level + h, Math.sin(a) * r)
        sheet.push(k / (SHEETS.length - 1))
      }
    for (let j = 0; j < rings.length - 1; j++)
      for (let s = 0; s < segments; s++) {
        const a = base + j * segments + s
        const b = base + j * segments + ((s + 1) % segments)
        const c = a + segments
        const d = b + segments
        // facing up (counter-clockwise seen from above)
        index.push(a, b, c, b, d, c)
      }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3))
  geometry.setAttribute("aSheet", new Float32BufferAttribute(sheet, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

const RAD = Math.PI / 180
/** The mist's own slow drift: the wind's heading (atmosphere's default), metres a second. */
const DRIFT = { heading: 30, speed: 1.6 }

export function createMist(stage: Stage, opts: MistOpts): Mist {
  let params: MistParams = { ...DEFAULT_MIST, ...opts.params }
  const noise = new DataTexture(mistNoise(), 128, 128, RGBAFormat, UnsignedByteType)
  noise.wrapS = RepeatWrapping
  noise.wrapT = RepeatWrapping
  noise.magFilter = LinearFilter
  noise.minFilter = LinearMipmapLinearFilter
  noise.generateMipmaps = true
  noise.needsUpdate = true
  const uniforms = {
    ...AIR,
    uNoise: { value: noise as Texture },
    uField: { value: null as Texture | null },
    uFieldWindow: { value: new Vector4() },
    uFieldReach: { value: 1 },
    uHasField: { value: 0 },
    uCentre: { value: new Vector2(...opts.centre) },
    uBand: { value: new Vector2() },
    uDrift: { value: new Vector2() },
    uSunFlat: { value: new Vector2(1, 0) },
    uWind: { value: new Vector2(Math.cos(DRIFT.heading * RAD), Math.sin(DRIFT.heading * RAD)) },
    uMist: { value: 1 },
    uLit: { value: new Color() },
    uShade: { value: new Color() },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
  })
  const outer = fogRing(opts.radius, 0.5).whole * 1.05
  const geometry = sheets(opts.radius * 0.45, outer, opts.level)
  const mesh = new Mesh(geometry, material)
  mesh.name = "mist"
  mesh.frustumCulled = false
  // after the water and the land, before the clouds (clouds.ts: 10)
  mesh.renderOrder = 5
  mesh.position.set(opts.centre[0], 0, opts.centre[1])
  stage.scene.add(mesh)

  const apply = () => {
    const ring = fogRing(opts.radius, params.haze)
    AIR.uFogRing.value.set(opts.centre[0], opts.centre[1], ring.start, ring.whole)
    AIR.uFogRingMax.value = ring.max
    AIR.uMistWarm.value = 1
    uniforms.uBand.value.set(...mistBand(opts.radius, params.mist))
    uniforms.uMist.value = params.mist
    mesh.visible = params.mist > 0
  }
  apply()

  let hour = Number.NaN
  const drift = { x: 0, z: 0 }
  const unsubscribe = stage.onFrame((dt) => {
    const light = opts.light()
    if (light.hour !== hour) {
      hour = light.hour
      const look = cloudLook(light, 0.35)
      // mist is thinner than cloud: its shade is lifted toward its lit side
      uniforms.uLit.value.copy(look.lit)
      uniforms.uShade.value.copy(look.shade).lerp(look.lit, 0.35)
      const [x, , z] = light.moonIntensity > light.sunIntensity ? light.moonTrue : light.sunTrue
      const flat = Math.hypot(x, z) || 1
      uniforms.uSunFlat.value.set(x / flat, z / flat)
    }
    const step = DRIFT.speed * Math.min(dt, 0.1)
    // wraps far past any texture period, so the float never loses its fraction
    drift.x = (drift.x + Math.cos(DRIFT.heading * RAD) * step) % 52000
    drift.z = (drift.z + Math.sin(DRIFT.heading * RAD) * step) % 52000
    uniforms.uDrift.value.set(drift.x, drift.z)
  })

  return {
    setShore(field) {
      uniforms.uField.value = field?.texture ?? null
      if (field) uniforms.uFieldWindow.value.copy(field.window)
      uniforms.uFieldReach.value = field?.reach ?? 1
      uniforms.uHasField.value = field ? 1 : 0
    },
    set(next) {
      params = { ...params, ...next }
      apply()
    },
    params: () => ({ ...params }),
    dispose() {
      unsubscribe()
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
      noise.dispose()
      AIR.uFogRingMax.value = 0
      AIR.uMistWarm.value = 0
    },
  }
}
