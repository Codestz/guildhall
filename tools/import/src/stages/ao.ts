/**
 * Bake per-vertex ambient occlusion into _SHADE and COLOR_0 (T14, ADR 003: COLOR_0 = swatch × shade × AO).
 *
 * Each vertex casts `rays` cosine-weighted hemisphere rays along its normal (a fixed Hammersley set, so
 * the bake is deterministic), offset by EPSILON, against the whole piece in world space (one BVH) plus
 * the ground plane y = 0, so bottoms and contact edges darken. A ray that hits within `distance` counts
 * as occluded; the vertex factor is 1 − strength × occluded fraction. The factor multiplies the stored
 * `_SHADE` and the RGB of `COLOR_0`; when colour has not run (no `_SHADE`), `_SHADE` is created from
 * NEUTRAL_SHADE × factor and COLOR_0 is left absent.
 */
import type { Accessor, Document, Node, Primitive } from "@gltf-transform/core"
import { DMath } from "@guildhall/core"
import { BufferAttribute, BufferGeometry, DoubleSide, Ray } from "three"
import { MeshBVH } from "three-mesh-bvh"
import { defaultScene } from "../read.ts"
import type { Stage } from "./types.ts"

export interface AOOptions {
  rays?: number
  /** Max ray length in metres; default: AUTO_DISTANCE × bbox diagonal, clamped. */
  distance?: number
  /** How dark a fully occluded vertex gets: factor = 1 − strength. */
  strength?: number
}

export const AO_DEFAULTS = { rays: 48, strength: 0.6 } as const
const AUTO_DISTANCE = { scale: 0.25, min: 0.3, max: 2 } as const
/** Ray origins sit this far off the surface (metres) so a vertex does not hit its own faces. */
const EPSILON = 1e-3
/** `_SHADE` byte for "no lightness offset" (uint8 normalized, centred), used only when colour did not run. */
export const NEUTRAL_SHADE = 128
const TRIANGLES = 4

/** `n` cosine-weighted directions in the local frame (z = normal), from the Hammersley sequence. */
export function hemisphere(n: number): Float64Array {
  const dirs = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n
    const phi = 2 * Math.PI * radicalInverse(i)
    const r = Math.sqrt(u)
    dirs[i * 3] = r * DMath.cos(phi)
    dirs[i * 3 + 1] = r * DMath.sin(phi)
    dirs[i * 3 + 2] = Math.sqrt(1 - u)
  }
  return dirs
}

/** Van der Corput base 2: the bits of `i` mirrored about the binary point. */
function radicalInverse(i: number): number {
  let x = 0
  let f = 0.5
  for (let b = i; b > 0; b >>>= 1, f *= 0.5) if (b & 1) x += f
  return x
}

/** clamp(0.25 × bbox diagonal, 0.3, 2) for xyz triples. */
export function autoDistance(positions: ArrayLike<number>): number {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i] as number
    const k = i % 3
    if (v < (min[k] as number)) min[k] = v
    if (v > (max[k] as number)) max[k] = v
  }
  if (positions.length === 0) return AUTO_DISTANCE.min
  const diag = DMath.hypot(
    (max[0] as number) - (min[0] as number),
    (max[1] as number) - (min[1] as number),
    (max[2] as number) - (min[2] as number),
  )
  return Math.min(AUTO_DISTANCE.max, Math.max(AUTO_DISTANCE.min, AUTO_DISTANCE.scale * diag))
}

/** Does a ray from (oy) along (dy) cross the two-sided ground plane y = 0 within `far`? */
function hitsGround(oy: number, dy: number, far: number): boolean {
  if (dy < 0) return oy / -dy < far
  return oy < 0 && dy > 0 && -oy / dy < far
}

/**
 * Per-vertex AO factor in [1 − strength, 1] (1 = open sky) for a triangle soup in world space.
 * `positions`/`normals` are xyz triples; `indices` are triangles over them.
 */
export function bakeAO(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  opts: AOOptions = {},
): Float32Array {
  const count = positions.length / 3
  const rays = opts.rays ?? AO_DEFAULTS.rays
  const strength = opts.strength ?? AO_DEFAULTS.strength
  const far = opts.distance ?? autoDistance(positions)
  const out = new Float32Array(count).fill(1)
  if (count === 0 || rays <= 0 || strength <= 0) return out

  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices.slice(), 1))
  const bvh = indices.length > 0 ? new MeshBVH(geometry) : undefined
  const dirs = hemisphere(rays)
  const ray = new Ray()
  // Colour splits vertices; copies with the same position and normal share one bake.
  const seen = new Map<string, number>()

  for (let v = 0; v < count; v++) {
    const px = positions[v * 3] as number
    const py = positions[v * 3 + 1] as number
    const pz = positions[v * 3 + 2] as number
    let nx = normals[v * 3] as number
    let ny = normals[v * 3 + 1] as number
    let nz = normals[v * 3 + 2] as number
    const key = `${px},${py},${pz},${nx},${ny},${nz}`
    const prior = seen.get(key)
    if (prior !== undefined) {
      out[v] = prior
      continue
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len === 0) {
      seen.set(key, 1)
      continue
    }
    nx /= len
    ny /= len
    nz /= len
    // Orthonormal basis around n without trig (Duff et al. 2017).
    const sign = nz >= 0 ? 1 : -1
    const a = -1 / (sign + nz)
    const b = nx * ny * a
    const tx = 1 + sign * nx * nx * a
    const ty = sign * b
    const tz = -sign * nx
    const bx = b
    const by = sign + ny * ny * a
    const bz = -ny
    ray.origin.set(px + nx * EPSILON, py + ny * EPSILON, pz + nz * EPSILON)

    let hits = 0
    for (let r = 0; r < rays; r++) {
      const lx = dirs[r * 3] as number
      const ly = dirs[r * 3 + 1] as number
      const lz = dirs[r * 3 + 2] as number
      const dx = tx * lx + bx * ly + nx * lz
      const dy = ty * lx + by * ly + ny * lz
      const dz = tz * lx + bz * ly + nz * lz
      if (hitsGround(ray.origin.y, dy, far)) {
        hits++
        continue
      }
      if (!bvh) continue
      ray.direction.set(dx, dy, dz)
      if (bvh.raycastFirst(ray, DoubleSide, 0, far)) hits++
    }
    const factor = 1 - (strength * hits) / rays
    out[v] = factor
    seen.set(key, factor)
  }
  return out
}

/** One triangle primitive placed in the world, as a slice of the merged arrays. */
interface Part {
  prim: Primitive
  start: number
  count: number
}

/** Every triangle primitive of the default scene, merged into one world-space soup. */
function gather(doc: Document): {
  parts: Part[]
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
} {
  const parts: Part[] = []
  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const visit = (node: Node): void => {
    const mesh = node.getMesh()
    if (mesh) {
      const m = node.getWorldMatrix()
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute("POSITION")
        if (prim.getMode() !== TRIANGLES || !position) continue
        const start = pos.length / 3
        const count = position.getCount()
        const local = position.getArray() as ArrayLike<number>
        const tris = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: count }, (_, i) => i)
        const normal = prim.getAttribute("NORMAL")?.getArray() ?? vertexNormals(local, tris)
        for (let i = 0; i < count; i++) {
          const x = local[i * 3] as number
          const y = local[i * 3 + 1] as number
          const z = local[i * 3 + 2] as number
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12])
          pos.push(m[1] * x + m[5] * y + m[9] * z + m[13])
          pos.push(m[2] * x + m[6] * y + m[10] * z + m[14])
          const n = normalToWorld(
            m,
            normal[i * 3] as number,
            normal[i * 3 + 1] as number,
            normal[i * 3 + 2] as number,
          )
          nor.push(n[0], n[1], n[2])
        }
        for (let i = 0; i < tris.length; i++) idx.push(start + (tris[i] as number))
        parts.push({ prim, start, count })
      }
    }
    for (const child of node.listChildren()) visit(child)
  }
  for (const node of defaultScene(doc)?.listChildren() ?? []) visit(node)
  return {
    parts,
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nor),
    indices: Uint32Array.from(idx),
  }
}

/** Normal through the inverse-transpose of the matrix's 3×3 (the cofactor matrix; scale is renormalized). */
function normalToWorld(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  const at = (k: number): number => m[k] as number
  const [a, b, c, d, e, f, g, h, i] = [at(0), at(1), at(2), at(4), at(5), at(6), at(8), at(9), at(10)]
  // Columns (a b c), (d e f), (g h i); cofactor matrix rows applied to (x y z).
  return [
    (e * i - f * h) * x + (f * g - d * i) * y + (d * h - e * g) * z,
    (h * c - i * b) * x + (i * a - g * c) * y + (g * b - h * a) * z,
    (b * f - c * e) * x + (c * d - a * f) * y + (a * e - b * d) * z,
  ]
}

/** Area-weighted vertex normals for a primitive that has none. */
function vertexNormals(p: ArrayLike<number>, tris: ArrayLike<number>): Float32Array {
  const n = new Float32Array(p.length)
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const [i, j, k] = [tris[t] as number, tris[t + 1] as number, tris[t + 2] as number]
    const ux = (p[j * 3] as number) - (p[i * 3] as number)
    const uy = (p[j * 3 + 1] as number) - (p[i * 3 + 1] as number)
    const uz = (p[j * 3 + 2] as number) - (p[i * 3 + 2] as number)
    const vx = (p[k * 3] as number) - (p[i * 3] as number)
    const vy = (p[k * 3 + 1] as number) - (p[i * 3 + 1] as number)
    const vz = (p[k * 3 + 2] as number) - (p[i * 3 + 2] as number)
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    for (const v of [i, j, k]) {
      n[v * 3] = (n[v * 3] as number) + cx
      n[v * 3 + 1] = (n[v * 3 + 1] as number) + cy
      n[v * 3 + 2] = (n[v * 3 + 2] as number) + cz
    }
  }
  return n
}

/** Multiplies the first `channels` components of each element by its vertex factor (integers rounded). */
function darken(accessor: Accessor, factors: Float32Array, channels: number): void {
  const src = accessor.getArray()
  if (!src) return
  const out = src.slice()
  const size = accessor.getElementSize()
  const integer = !(out instanceof Float32Array)
  for (let v = 0; v < factors.length; v++)
    for (let c = 0; c < channels; c++) {
      const value = (out[v * size + c] as number) * (factors[v] as number)
      out[v * size + c] = integer ? Math.round(value) : value
    }
  accessor.setArray(out)
}

export const ao: Stage = async (doc, ctx) => {
  if (ctx.pack.ao === false) return
  const started = performance.now()
  const { parts, positions, normals, indices } = gather(doc)
  if (parts.length === 0) return
  const factors = bakeAO(positions, normals, indices, ctx.pack.ao ?? {})
  // A primitive (or accessor) placed by several nodes is baked once, from its first placement.
  const done = new Set<Primitive | Accessor>()
  for (const { prim, start, count } of parts) {
    if (done.has(prim)) continue
    done.add(prim)
    const f = factors.subarray(start, start + count)
    const shade = prim.getAttribute("_SHADE")
    if (shade && !done.has(shade)) darken(shade, f, 1)
    else if (!shade) {
      const bytes = Uint8Array.from(f, (x) => Math.round(NEUTRAL_SHADE * x))
      const buffer = prim.getAttribute("POSITION")?.getBuffer() ?? doc.getRoot().listBuffers()[0] ?? null
      prim.setAttribute(
        "_SHADE",
        doc.createAccessor().setType("SCALAR").setArray(bytes).setNormalized(true).setBuffer(buffer),
      )
    }
    if (shade) done.add(shade)
    const colour = prim.getAttribute("COLOR_0")
    if (colour && !done.has(colour)) {
      darken(colour, f, 3)
      done.add(colour)
    }
  }
  ctx.log.debug("ao baked", {
    verts: positions.length / 3,
    tris: indices.length / 3,
    ms: Math.round(performance.now() - started),
  })
}
