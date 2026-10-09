import { useFrame } from "@react-three/fiber"
import { useLayoutEffect } from "react"
import { BatchedMesh, type BufferGeometry, type Material, type Matrix4, Mesh } from "three"
import { bakeStatic, type Placed } from "../render/bake.ts"
import { type DetailTier, FAR, NEAR, pixelsPerUnit, tierAt } from "../render/tiers.ts"
import type { Chunks } from "../world/chunks.ts"
import { shadows } from "./atmosphere/shadows.ts"
import { FRAME } from "./frame.ts"

/**
 * The tier pass: each frame, every region of every tiered layer (the island's batches, the wilds,
 * the grass) is checked against the camera (render/tiers.ts) and swapped only when its tier
 * changes. A swap is a pass over that region's own instances, written into buffers the layer
 * built up front: nothing is allocated, nothing rebuilt, nothing uploaded.
 *
 * A swap leaves the on-demand shadow map (atmosphere/shadows.ts) as it was: it was drawn from
 * full-detail casters, which is at least as right for a far region as its coarse copies would be,
 * and redrawing every caster on a swap cost the swap's frame ~2 ms. Only a new layer's settling
 * redraws it (its first frame may have cast both tiers' shadows).
 */

export interface TieredLayer {
  readonly chunks: Chunks
  /** Each region's tier now (or UNSETTLED / SETTLING while the layer is new). */
  readonly tiers: Uint8Array
  /**
   * Where this layer goes far, as a share of the pieces' own threshold (render/tiers.ts
   * FAR_BELOW): 1 for coarse copies; less for a layer whose far tier is not bounded by FAR_ERROR
   * (the grass drops blades), so it holds its near tier further out.
   */
  readonly farAt: number
  swap(chunk: number, tier: DetailTier): void
}

/**
 * A new layer draws both its tiers for one frame (its builder leaves both shown), so a backend
 * uploads every mesh while the world is loading rather than at a region's first swap: on WebGPU
 * a merged mesh's first draw is its upload, and a far tier first shown mid-zoom stalled ~200 ms.
 * The pass then settles every region with a swap.
 */
const UNSETTLED = 255
const SETTLING = 254

/** The mounted layers: an array, so the pass walks them without an iterator a frame. */
const layers: TieredLayer[] = []

/**
 * Probe only (window.r3f.tiers): `force` pins every region to one tier, for side-by-side shots
 * of a swap; null lets the camera decide. `pixels` is the last frame's fewest CSS pixels per world
 * unit over every region, `far` how many regions were far.
 */
export const tierProbe: { force: DetailTier | null; swaps: number; pixels: number; far: number } = {
  force: null,
  swaps: 0,
  pixels: 0,
  far: 0,
}

/** Registers a layer's regions with the tier pass while it is mounted. */
export function useTiered(layer: TieredLayer | null | undefined): void {
  useLayoutEffect(() => {
    if (!layer) return
    layers.push(layer)
    return () => {
      const at = layers.indexOf(layer)
      if (at >= 0) layers.splice(at, 1)
    }
  }, [layer])
}

/** A layer's regions, unsettled until the pass's first two frames, swapped by `swap`. */
export function tiered(chunks: Chunks, swap: TieredLayer["swap"], farAt = 1): TieredLayer {
  return { chunks, tiers: new Uint8Array(chunks.list.length).fill(UNSETTLED), farAt, swap }
}

/** Mounted once in the scene: runs the tier pass before the frame is drawn. */
export function Tiers() {
  useFrame(({ camera, size }) => {
    let settled = false
    let fewest = Number.POSITIVE_INFINITY
    let far = 0
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l]
      if (!layer) continue
      const { list } = layer.chunks
      for (let i = 0; i < list.length; i++) {
        const chunk = list[i]
        if (!chunk) continue
        const current = layer.tiers[i] ?? NEAR
        // Its first frame drawn with both tiers shown; settled on the next.
        if (current === UNSETTLED) {
          layer.tiers[i] = SETTLING
          continue
        }
        const pixels = pixelsPerUnit(camera, size.height, chunk.centre[0], 0, chunk.centre[1], chunk.radius)
        fewest = Math.min(fewest, pixels)
        if (current === SETTLING) settled = true
        const from = current === SETTLING ? NEAR : (current as DetailTier)
        const next = tierProbe.force ?? tierAt(from, pixels / layer.farAt)
        if (next !== NEAR) far++
        if (next === current) continue
        layer.tiers[i] = next
        layer.swap(i, next)
        tierProbe.swaps++
      }
    }
    tierProbe.pixels = fewest
    tierProbe.far = far
    if (settled) shadows.request()
  }, FRAME.SIM)
  return null
}

/** A piece as a tiered batch draws it: in full, and its coarse copy (null: it draws in full far too). */
export interface TieredPiece {
  near: BufferGeometry
  far: BufferGeometry | null
}

/** One placed copy: its piece, where it stands (its own matrix), and its region. */
export interface TieredInstance {
  piece: TieredPiece
  matrix: Matrix4
  chunk: number
}

/** A batch's meshes, and how it swaps a region's tier. */
export interface TieredBatch {
  meshes: Mesh[]
  swap(chunk: number, tier: DetailTier): void
}

/**
 * One BatchedMesh (WebGL: one multi-draw call, per-instance culling) holding each piece's full
 * geometry and its coarse copy once, and an instance per copy. A region's swap points its own
 * instances at the other geometry (`setGeometryIdAt`), read from a table laid out by region when
 * the batch is built. `added` sees each instance as it is added (the growth film's marks).
 */
export function tieredBatch<I extends TieredInstance>(
  material: Material,
  instances: readonly I[],
  chunks: number,
  added?: (mesh: BatchedMesh, id: number, instance: I) => void,
): TieredBatch {
  const geometries = new Map<BufferGeometry, number>()
  for (const { piece } of instances) {
    geometries.set(piece.near, -1)
    if (piece.far) geometries.set(piece.far, -1)
  }
  let vertices = 0
  let indices = 0
  for (const geometry of geometries.keys()) {
    vertices += geometry.getAttribute("position").count
    indices += geometry.getIndex()?.count ?? 0
  }
  const mesh = new BatchedMesh(instances.length, vertices, indices, material)
  for (const geometry of geometries.keys()) geometries.set(geometry, mesh.addGeometry(geometry))
  const idOf = (geometry: BufferGeometry): number => geometries.get(geometry) ?? 0
  // The swap table: [instance, near geometry, far geometry] per swappable instance, by region.
  const offsets = new Uint32Array(chunks + 1)
  for (const { piece, chunk } of instances) if (piece.far) offsets[chunk + 1] = (offsets[chunk + 1] ?? 0) + 1
  for (let c = 0; c < chunks; c++) offsets[c + 1] = (offsets[c + 1] ?? 0) + (offsets[c] ?? 0)
  const table = new Int32Array((offsets[chunks] ?? 0) * 3)
  const filled = offsets.slice(0, chunks)
  for (const instance of instances) {
    const id = mesh.addInstance(idOf(instance.piece.near))
    mesh.setMatrixAt(id, instance.matrix)
    added?.(mesh, id, instance)
    const { far } = instance.piece
    if (!far) continue
    const at = (filled[instance.chunk] ?? 0) * 3
    filled[instance.chunk] = (filled[instance.chunk] ?? 0) + 1
    table[at] = id
    table[at + 1] = idOf(instance.piece.near)
    table[at + 2] = idOf(far)
  }
  // Opaque and depth-tested: sorting would only cost CPU every frame. Culling stays on.
  mesh.sortObjects = false
  mesh.computeBoundingSphere()
  return {
    meshes: [mesh],
    swap(chunk, tier) {
      const column = tier === FAR ? 2 : 1
      for (let k = offsets[chunk] ?? 0, end = offsets[chunk + 1] ?? 0; k < end; k++)
        mesh.setGeometryIdAt(table[k * 3] ?? 0, table[k * 3 + column] ?? 0)
    },
  }
}

/**
 * The same batch for WebGPU (no multi-draw: a BatchedMesh there is a call per instance): one merged
 * mesh per region (render/bake.ts), and a second of its coarse copies where it has any. Each is
 * culled whole by its own bounds, and a swap only shows one and hides the other. Both are shown
 * until the tier pass settles the region (its first frame uploads them). `decorate` adds
 * per-vertex attributes to each baked copy (bakeStatic's).
 */
export function tieredMerge(
  material: Material,
  instances: readonly TieredInstance[],
  chunks: number,
  decorate?: (copy: BufferGeometry, at: Placed) => void,
): TieredBatch {
  const near: (Mesh | null)[] = []
  const far: (Mesh | null)[] = []
  const meshes: Mesh[] = []
  const merged = (placed: Placed[]): Mesh | null => {
    const geometry = bakeStatic(placed, decorate)
    if (!geometry) return null
    const mesh = new Mesh(geometry, material)
    meshes.push(mesh)
    return mesh
  }
  const byChunk = Array.from({ length: chunks }, (): TieredInstance[] => [])
  for (const instance of instances) byChunk[instance.chunk]?.push(instance)
  byChunk.forEach((own, c) => {
    near[c] = merged(own.map(({ piece, matrix }) => ({ geometry: piece.near, matrix })))
    const coarse = own.some(({ piece }) => piece.far)
    far[c] = coarse
      ? merged(own.map(({ piece, matrix }) => ({ geometry: piece.far ?? piece.near, matrix })))
      : null
  })
  return {
    meshes,
    swap(chunk, tier) {
      const shown = far[chunk]
      const full = near[chunk]
      if (!shown || !full) return
      shown.visible = tier === FAR
      full.visible = tier !== FAR
    },
  }
}
