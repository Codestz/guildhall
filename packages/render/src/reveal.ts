/**
 * Revealing a built island in an order, without a rebuild (plan-hud-events S4, then T1): the island is
 * built once at today's size and a history scrub shows the first n places of it. Every place is a tile's
 * rank in the growth order (world `HexIsland.rank`), and everything drawn is given a place from where it
 * stands: a static instance by its origin, a triangle of the ground, a road or a stair by its centroid.
 *
 *   static batch   `LodBatchedMesh.reveal` (batchMesh.ts): its walk leaves out the instances past the
 *                  count and lists the ones on the frontier with a fade code, grown or dithered in.
 *   triangle soups `createRevealMesh`: triangles sorted by place, so what is revealed is a draw range
 *                  (no upload per scrub); the frontier rises from under the sea or dithers in, by a
 *                  per-vertex place and three uniforms shared by every mesh of one reveal.
 *
 * One `Reveal` owns the uniforms and every mesh and batch it reveals: `set(count)` moves them all at once,
 * so the same count always gives the same picture (a scrub back and forth is stable).
 */
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  Mesh,
  type MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  type WebGLProgramParametersWithUniforms,
} from "three"
import type { LodBatchedMesh } from "./batchMesh.ts"
import type { Stage } from "./stage.ts"
import type { TerrainMesh } from "./terrain.ts"
import type { VertexMeshData } from "./vmeshData.ts"

/** How the frontier comes in: grown from the ground (pieces from their origin, tiles rising), dithered, or at once. */
export type RevealLook = "grow" | "dither" | "snap"

/** The place of what stands at (x, z) with surface normal (nx, nz) in the reveal order; -1: drawn from the start. */
export type PlaceAt = (x: number, z: number, nx: number, nz: number) => number

/** A place that is never reached: a triangle with it as `until` stays as long as it is revealed. */
export const NEVER = 1e9

export interface RevealMeshOpts {
  /** The material to draw with (its light and patches kept); it is cloned, not changed. */
  material: MeshStandardMaterial
  /**
   * Per triangle, the place at which it goes away again (a frontier skirt leaves once the tile beyond it
   * is in); absent: it stays.
   */
  until?: Float32Array
  castShadow?: boolean
}

export interface RevealMesh extends TerrainMesh {
  mesh: Mesh
  readonly triangles: number
}

export interface Reveal {
  readonly look: RevealLook
  /** The count last set. */
  readonly count: number
  /** The count and span as shaders outside the reveal's own meshes read them (the water). */
  readonly uniforms: { count: { value: number }; span: { value: number } }
  /**
   * A triangle soup (positions, linear colours, normals, as `vertexMeshData` makes them) revealed by place:
   * `placeAt` gives each triangle's from its centroid and normal.
   */
  mesh(stage: Pick<Stage, "scene">, data: VertexMeshData, placeAt: PlaceAt, opts: RevealMeshOpts): RevealMesh
  /** Gives every instance of `batch` its place from where it stands, and reveals it with the rest. */
  batch(batch: LodBatchedMesh, placeAt: PlaceAt): void
  /** Reveals the places under `count`; the `span` last ones (places) are on their way in. */
  set(count: number, span?: number): void
  dispose(): void
}

/** How far a tile sinks before it rises (`grow`), metres: under the sea from the island's base. */
export const RISE_METRES = 2.6
/** The frontier's width by default, places: how many tiles are on their way in at once. */
export const DEFAULT_SPAN = 12

const PARS = /* glsl */ `#include <common>
attribute float revealPlace;
attribute float revealUntil;
uniform float uRevealCount;
uniform float uRevealSpan;
uniform float uRevealSink;
varying float vReveal;`

const VERTEX = /* glsl */ `#include <begin_vertex>
{
	float revealW = revealPlace < 0.0 ? 1.0 : clamp( ( uRevealCount - revealPlace ) / uRevealSpan, 0.0, 1.0 );
	vReveal = revealW;
	transformed.y -= uRevealSink * ( 1.0 - revealW );
	// gone again past its until (a skirt once the tile beyond it is in): collapsed, far under
	if ( uRevealCount >= revealUntil + uRevealSpan ) transformed = vec3( 0.0, -1000.0, 0.0 );
}`

const DISCARD = /* glsl */ `#include <clipping_planes_fragment>
if ( vReveal < 1.0 ) {
	float revealD = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	if ( revealD >= vReveal ) discard;
}`

interface Uniforms {
  uRevealCount: { value: number }
  uRevealSpan: { value: number }
  uRevealSink: { value: number }
}

function patchReveal(shader: WebGLProgramParametersWithUniforms, uniforms: Uniforms, dither: boolean): void {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", PARS)
    .replace("#include <begin_vertex>", VERTEX)
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    "#include <common>\nvarying float vReveal;",
  )
  if (dither)
    shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>", DISCARD)
}

/** `base` with the reveal on top of its own patches (its light, shadows, speckle kept). */
function withReveal(base: MeshStandardMaterial, uniforms: Uniforms, dither: boolean): MeshStandardMaterial {
  const material = base.clone()
  material.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer)
    patchReveal(shader, uniforms, dither)
  }
  const key = base.customProgramCacheKey()
  material.customProgramCacheKey = () => `${key}-reveal${dither ? "-dither" : ""}`
  return material
}

/** The first index in ascending `sorted` whose value is at or over `v` (all of them under: the length). */
function lowerBound(sorted: Float32Array, v: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] as number) < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The BatchedMesh internals the placement reads (three keeps them private). */
interface Internals {
  _instanceInfo: { active: boolean }[]
  _matricesTexture: { image: { data: Float32Array } }
}

/**
 * A hex map's places as a texture a shader reads by axial coordinates (q + radius, r + radius): the
 * water's reveal (water.ts). `placeOf(i)` gives tile i's place, -1 for the sea. Per texel: the place
 * (r), and the first and last place of the land within two rings (g, b; -1 without any), so a sea pixel
 * knows whether all the land near it is in (today's baked shore), none (open sea), or some (a frontier).
 */
export function placesTexture(
  grid: { radius: number; size: number; q: Int16Array; r: Int16Array; neighbours(i: number): Int32Array },
  placeOf: (i: number) => number,
): DataTexture {
  const side = 2 * grid.radius + 1
  const data = new Float32Array(side * side * 4).fill(-1)
  const places = new Float32Array(grid.size)
  for (let i = 0; i < grid.size; i++) places[i] = placeOf(i)
  for (let i = 0; i < grid.size; i++) {
    const x = (grid.q[i] as number) + grid.radius
    const y = (grid.r[i] as number) + grid.radius
    let first = -1
    let last = -1
    const seen = new Set<number>([i])
    for (const j of grid.neighbours(i)) {
      if (j < 0) continue
      seen.add(j)
      for (const k of grid.neighbours(j)) if (k >= 0) seen.add(k)
    }
    for (const j of seen) {
      const p = places[j] as number
      if (p < 0) continue
      if (first < 0 || p < first) first = p
      if (p > last) last = p
    }
    const at = (y * side + x) * 4
    data[at] = places[i] as number
    data[at + 1] = first
    data[at + 2] = last
    data[at + 3] = 1
  }
  const texture = new DataTexture(data, side, side, RGBAFormat, FloatType)
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export function createReveal(look: RevealLook): Reveal {
  const uniforms: Uniforms = {
    uRevealCount: { value: Number.POSITIVE_INFINITY },
    uRevealSpan: { value: DEFAULT_SPAN },
    uRevealSink: { value: look === "grow" ? RISE_METRES : 0 },
  }
  const dither = look === "dither"
  const meshes: { mesh: Mesh; places: Float32Array; dispose(): void }[] = []
  const batches: LodBatchedMesh[] = []
  const materials: MeshStandardMaterial[] = []
  let count = Number.POSITIVE_INFINITY
  /** A snap has no frontier: one place wide, nothing sinks. */
  const spanOf = (span: number) => (look === "snap" ? 1e-3 : Math.max(1e-3, span))

  const apply = () => {
    uniforms.uRevealCount.value = count
    for (const m of meshes) {
      // the triangles placed under the count, in place order: a draw range, nothing uploaded
      const k = lowerBound(m.places, count)
      m.mesh.geometry.setDrawRange(0, k * 3)
    }
    for (const b of batches) {
      b.revealCount = count
      b.revealSpan = uniforms.uRevealSpan.value
    }
  }

  return {
    look,
    get count() {
      return count
    },
    uniforms: { count: uniforms.uRevealCount, span: uniforms.uRevealSpan },
    mesh(stage, data, placeAt, opts) {
      const n = data.position.length / 9
      const place = new Float32Array(n)
      const order = new Uint32Array(n)
      for (let t = 0; t < n; t++) {
        const o = t * 9
        const p = data.position
        const cx = ((p[o] as number) + (p[o + 3] as number) + (p[o + 6] as number)) / 3
        const cz = ((p[o + 2] as number) + (p[o + 5] as number) + (p[o + 8] as number)) / 3
        place[t] = placeAt(cx, cz, data.normal[o] as number, data.normal[o + 2] as number)
        order[t] = t
      }
      // triangles in place order (stable: ties keep their order)
      order.sort((a, b) => (place[a] as number) - (place[b] as number) || a - b)
      const position = new Float32Array(data.position.length)
      const color = new Float32Array(data.color.length)
      const normal = new Float32Array(data.normal.length)
      const places = new Float32Array(n)
      const perVertex = new Float32Array(n * 3)
      const until = new Float32Array(n * 3).fill(NEVER)
      for (let k = 0; k < n; k++) {
        const t = order[k] as number
        position.set(data.position.subarray(t * 9, t * 9 + 9), k * 9)
        color.set(data.color.subarray(t * 9, t * 9 + 9), k * 9)
        normal.set(data.normal.subarray(t * 9, t * 9 + 9), k * 9)
        const pl = place[t] as number
        places[k] = pl
        perVertex[k * 3] = perVertex[k * 3 + 1] = perVertex[k * 3 + 2] = pl
        if (opts.until) until[k * 3] = until[k * 3 + 1] = until[k * 3 + 2] = opts.until[t] as number
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute("position", new BufferAttribute(position, 3))
      geometry.setAttribute("color", new BufferAttribute(color, 3))
      geometry.setAttribute("normal", new BufferAttribute(normal, 3))
      geometry.setAttribute("revealPlace", new BufferAttribute(perVertex, 1))
      geometry.setAttribute("revealUntil", new BufferAttribute(until, 1))
      const material = withReveal(opts.material, uniforms, dither)
      materials.push(material)
      const mesh = new Mesh(geometry, material)
      mesh.receiveShadow = true
      mesh.castShadow = opts.castShadow ?? true
      // the frontier sinks under its own bounds: the culling must not clip a rising tile
      geometry.computeBoundingSphere()
      if (geometry.boundingSphere) geometry.boundingSphere.radius += RISE_METRES
      stage.scene.add(mesh)
      const entry = {
        mesh,
        places,
        dispose() {
          mesh.removeFromParent()
          geometry.dispose()
          material.dispose()
        },
      }
      meshes.push(entry)
      apply()
      return {
        mesh,
        triangles: n,
        dispose() {
          entry.dispose()
          const at = meshes.indexOf(entry)
          if (at >= 0) meshes.splice(at, 1)
        },
      }
    },
    batch(batch, placeAt) {
      const self = batch as unknown as Internals
      const info = self._instanceInfo
      const matrices = self._matricesTexture.image.data
      const places = new Int32Array(batch.maxInstanceCount).fill(-1)
      for (let i = 0; i < info.length; i++) {
        if (!info[i]?.active) continue
        // the instance's origin in the batch's space (the island's: the batch sits at the origin)
        places[i] = placeAt(matrices[i * 16 + 12] as number, matrices[i * 16 + 14] as number, 0, 0)
      }
      batch.reveal = places
      batch.revealLook = look === "dither" ? "dither" : "grow"
      batches.push(batch)
      apply()
    },
    set(next, span = DEFAULT_SPAN) {
      count = next
      uniforms.uRevealSpan.value = spanOf(span)
      apply()
    },
    dispose() {
      for (const m of meshes) m.dispose()
      meshes.length = 0
      for (const b of batches) b.reveal = null
      batches.length = 0
    },
  }
}
