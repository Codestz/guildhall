/**
 * The static draw path (ADR 007): every static piece of a set (the town) in one BatchedMesh, so each
 * pass (main and every shadow cascade) is one multi-draw call whatever the count or variety. Each
 * distinct (piece, re-tint) is one geometry in it (ADR 008), loaded and baked once, with coarser LOD
 * tiers simplified from it at load; a cluster (a compiled house) also gets one merged shell for far
 * away. Which tier each instance draws is picked per pass by screen size (batchMesh.ts, lod.ts).
 */
import { PALETTE, rampMapToSwatchMap } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  type Material,
  Matrix4,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { batchGeometry } from "./batchGeometry.ts"
import { LodBatchedMesh } from "./batchMesh.ts"
import { type LodCounts, PIECE_TIERS, SHELL, TIER_MIN_AREA, TIER_MIN_SAVING } from "./lod.ts"
import { lodError, shellGeometry, simplifierReady, simplifyGeometry, surfaceArea } from "./lodGeometry.ts"
import { batchMaterial } from "./material.ts"
import { GLOW_SWATCHES } from "./night/glow.ts"
import { createSlicer } from "./slice.ts"
import type { Stage } from "./stage.ts"
import { swatchMapKey } from "./tint.ts"
import { depthMaterialFor, warmPrograms } from "./warm.ts"

const logger = log("render:batch")

/** One placed piece: metres, `rot` in radians about +y. */
export interface RecipeInstance {
  /** A catalog id. */
  piece: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  /**
   * A lean before the turn: radians about the piece's own x, then its own z (Euler YXZ with `rot`), for
   * a piece stood on end or leaned (a bow in a rack). None: upright.
   */
  tilt?: [number, number]
  /** Swatch id → swatch id, a per-instance re-tint. */
  swatchMap?: Record<number, number>
  /** Ramp name → ramp name, tone for tone (ADR 008). */
  rampMap?: Record<string, string>
}

/**
 * One placed static piece: a catalog id, metres, `rot` radians about +y, uniform `scale`, and an
 * optional re-tint. `TownDraw.pieces` (`PieceInstance`) is this shape.
 */
export type BatchInstance = RecipeInstance & {
  /** Stretch along the piece's own x on top of `scale` (a wall piece fitted to its run). */
  stretch?: number
}

/**
 * An instance's full re-tint: its `rampMap` as swatch pairs, then its `swatchMap` on top, since a
 * swatch map is the single-swatch fix (ADR 008) and so wins over its ramp.
 */
export function instanceSwatchMap(
  instance: Pick<RecipeInstance, "rampMap" | "swatchMap">,
): Record<number, number> {
  const ramps = instance.rampMap ? rampMapToSwatchMap(PALETTE, instance.rampMap) : {}
  return { ...ramps, ...instance.swatchMap }
}

/** Puts `object` where `instance` says: metres, `rot` radians about +y (after its `tilt`), uniform `scale`. */
export function placeInstance(object: Object3D, instance: RecipeInstance): Object3D {
  object.position.set(instance.x, instance.y, instance.z)
  object.rotation.set(instance.tilt?.[0] ?? 0, instance.rot, instance.tilt?.[1] ?? 0, "YXZ")
  object.scale.setScalar(instance.scale)
  return object
}

/**
 * A group of pieces drawn as one when far away (a compiled house): `parts` in cluster space, placed by
 * the cluster's own x, y, z, rot and scale. Clusters with the same `key` share one shell (the bigger
 * parts merged and simplified), made from the first one's parts: give one key only to clusters whose
 * parts look the same from afar (e.g. a recipe id and seed; tiles whose pieces lie alike to the metre).
 */
export interface BatchCluster extends Pick<BatchInstance, "x" | "y" | "z" | "rot" | "scale"> {
  key: string
  parts: readonly BatchInstance[]
}

export interface StaticBatch {
  /** The one draw: in the stage's scene, casting and receiving sun shadows. */
  mesh: LodBatchedMesh
  /** Pieces placed now (cluster parts included, shells not). */
  readonly count: number
  /** Distinct (piece, re-tint) geometries held (their LOD tiers and the shells not counted). */
  readonly geometries: number
  /** Clusters placed. */
  readonly clusters: number
  /** What the last frame's main pass drew, per LOD tier. */
  readonly lod: LodCounts
  /** The instance ids of the loose pieces the batch was created with, in their order. */
  ids: readonly number[]
  /** Adds more pieces (growing the buffers when they are full); their instance ids, in order. */
  add(instances: readonly BatchInstance[]): Promise<number[]>
  /** Moves, turns, re-tints or swaps the piece of instance `id` (a cluster part's shell stays as it was). */
  update(id: number, instance: BatchInstance): Promise<void>
  /** Takes instance `id` out of the draw. */
  remove(id: number): void
  /** Takes the mesh out of the scene and frees its buffers (the palette material is shared). */
  dispose(): void
}

/** How much more than asked the buffers grow by when an add overflows them. */
const GROWTH = 1.5

/** The batch's three programs' materials: the main draw, the crossfade's, the shadow pass's. */
const BATCH_PROGRAMS = (): Material[] => [
  batchMaterial(),
  batchMaterial(true),
  depthMaterialFor(batchMaterial()),
]

/** An attribute of a stand-in geometry: name, item size, normalized, and float (else bytes; `u16`: 16-bit ints). */
export type StandInAttribute = [
  name: string,
  itemSize: number,
  normalized: boolean,
  floats: boolean,
  u16?: boolean,
]

/** The attributes a baked batch geometry carries (batchGeometry.ts), for a stand-in that compiles the same program. */
const BATCH_ATTRIBUTES: StandInAttribute[] = [
  ["position", 3, false, true],
  ["normal", 3, false, true],
  ["color", 3, true, false],
  ["_swatch", 1, false, false],
  ["_shade", 1, true, false],
  ["_ao", 1, true, false],
  ["_glow", 1, true, false],
]

/**
 * One triangle with a baked geometry's attributes: a batch mesh holding it compiles the programs the
 * real pieces draw with (a BatchedMesh takes its attributes from its first geometry; with none, three
 * compiles a flat-shaded variant that is never drawn).
 */
export function standInGeometry(attributes = BATCH_ATTRIBUTES): BufferGeometry {
  const geometry = new BufferGeometry()
  for (const [name, itemSize, normalized, floats, u16] of attributes) {
    const n = 3 * itemSize
    const array = floats ? new Float32Array(n) : u16 ? new Uint16Array(n) : new Uint8Array(n)
    geometry.setAttribute(name, new BufferAttribute(array, itemSize, normalized))
  }
  geometry.setIndex([0, 1, 2])
  return geometry
}

/**
 * Starts linking the batch's programs now, on a one-triangle stand-in with the baked geometry's
 * attributes, and resolves when the links are ready; the batch built later finds them made. On
 * ANGLE/Metal the batch's three programs take ~1.4 s to compile in the GPU process, and the first
 * call that reads one waits for it: started at the map stage, under the loading cover, that compile
 * runs while the pieces load and bake instead of after them.
 */
export async function warmBatchPrograms(
  stage: Pick<Stage, "scene" | "renderer" | "camera"> & Partial<Pick<Stage, "drawTarget">>,
): Promise<void> {
  const geometry = standInGeometry()
  const mesh = new LodBatchedMesh(1, 3, 3, batchMaterial())
  mesh.addInstance(mesh.addGeometry(geometry))
  // the program's key takes in whether the object casts and receives shadows: as the batch does
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.visible = false
  try {
    await warmPrograms(stage, mesh, BATCH_PROGRAMS(), { prefetch: false })
  } finally {
    mesh.dispose()
    geometry.dispose()
  }
}

/** An instance's key is asked for twice per add (baking, placing): kept, since it is a string of its re-tint. */
const keys = new WeakMap<BatchInstance, string>()
const variantKey = (instance: BatchInstance) => {
  let key = keys.get(instance)
  if (key === undefined) {
    key = `${instance.piece}|${swatchMapKey(instanceSwatchMap(instance))}`
    keys.set(instance, key)
  }
  return key
}

const triangles = (g: BufferGeometry) => (g.index?.count ?? 0) / 3

/**
 * `base` and its coarser PIECE_TIERS, finest first; a tier that saves too few triangles over the one
 * before, or loses too much of the outline (surface area), is that one again (the same object).
 */
function withTiers(base: BufferGeometry): BufferGeometry[] {
  const out = [base]
  const area = surfaceArea(base)
  for (const tier of PIECE_TIERS) {
    const previous = out[out.length - 1] as BufferGeometry
    const coarser = simplifyGeometry(base, tier)
    if (
      triangles(coarser) > TIER_MIN_SAVING * triangles(previous) ||
      surfaceArea(coarser) < TIER_MIN_AREA * area
    ) {
      coarser.dispose()
      out.push(previous)
    } else out.push(coarser)
  }
  return out
}

const position = new Vector3()
const turn = new Quaternion()
const size = new Vector3()
const up = new Vector3(0, 1, 0)
const lean = new Euler(0, 0, 0, "YXZ")

/** The placement of `instance` as a world matrix, as `placeInstance` would pose a scene node. */
export function instanceMatrix(
  instance: Pick<BatchInstance, "x" | "y" | "z" | "rot" | "scale" | "tilt" | "stretch">,
  out = new Matrix4(),
): Matrix4 {
  position.set(instance.x, instance.y, instance.z)
  if (instance.tilt) turn.setFromEuler(lean.set(instance.tilt[0], instance.rot, instance.tilt[1], "YXZ"))
  else turn.setFromAxisAngle(up, instance.rot)
  size.setScalar(instance.scale)
  if (instance.stretch !== undefined) size.x *= instance.stretch
  return out.compose(position, turn, size)
}

/**
 * Every instance and cluster in one BatchedMesh added to `stage.scene`, sized exactly to the distinct
 * geometries' vertices and indices (LOD tiers and shells included) and to the instance count. `load`
 * loads a catalog id as a copy of the piece (e.g. `(id) => loadPiece(libraryUrl(catalog.get(id).files.glb))`),
 * called once per piece; a failed load rejects. Per-instance frustum culling runs for the camera and
 * each shadow camera; instances are not sorted (one opaque material). Without `WEBGL_multi_draw` three
 * draws one call per instance, so that is logged as an error.
 *
 * The baking (LOD tiers, shells, the copies into the mesh) is sliced across frames (slice.ts): the same
 * geometry lands, but no single task holds the main thread (it was ~330 ms for 18 k pieces).
 */
export async function createStaticBatch(
  stage: Pick<Stage, "scene" | "renderer" | "camera"> & Partial<Pick<Stage, "drawTarget">>,
  instances: readonly BatchInstance[],
  load: (piece: string) => Promise<Object3D>,
  clusters: readonly BatchCluster[] = [],
): Promise<StaticBatch> {
  const start = performance.now()
  if (!stage.renderer.extensions.has("WEBGL_multi_draw"))
    logger.error("no WEBGL_multi_draw: the batch draws one call per instance")

  const pieces = new Map<string, Promise<Object3D>>()
  /** Variant key → its baked geometry and LOD tiers, finest first, kept for building shells. */
  const baked = new Map<string, Promise<BufferGeometry[]>>()
  /** Variant key, or `shell:` + cluster key → geometry id in the mesh. */
  const geometryIds = new Map<string, number>()
  const slicer = createSlicer()
  let mesh: LodBatchedMesh | null = null
  let vertices = 0
  let indices = 0
  let live = 0
  let clustered = 0
  /** The mesh's vertex and index buffer sizes (three keeps them private). */
  let capacity = { vertices: 0, indices: 0 }

  const bake = (instance: BatchInstance) => {
    const key = variantKey(instance)
    let geometry = baked.get(key)
    if (!geometry) {
      let piece = pieces.get(instance.piece)
      if (!piece) {
        piece = load(instance.piece)
        pieces.set(instance.piece, piece)
      }
      geometry = Promise.all([piece, simplifierReady]).then(async ([root]) => {
        // many pieces resolve in one tick: their bakes are spread over frames
        await slicer.yield()
        return withTiers(batchGeometry(root, instanceSwatchMap(instance), GLOW_SWATCHES[instance.piece]))
      })
      baked.set(key, geometry)
    }
    return geometry
  }

  const shellKey = (cluster: BatchCluster) => `shell:${cluster.key}`

  /**
   * Bakes what `batch` and `groups` need that the mesh lacks (each variant with its LOD tiers, each
   * cluster key's shell), grows the mesh to fit it and `adding` more instances, and adds the geometry.
   */
  const fit = async (batch: readonly BatchInstance[], groups: readonly BatchCluster[], adding: number) => {
    const missing = new Map<string, BufferGeometry[]>()
    const loose = [...batch, ...groups.flatMap((cluster) => cluster.parts)]
    await Promise.all(loose.map(bake))
    for (const instance of loose) {
      const key = variantKey(instance)
      if (!geometryIds.has(key) && !missing.has(key)) missing.set(key, await bake(instance))
    }
    for (const cluster of groups) {
      const key = shellKey(cluster)
      if (geometryIds.has(key) || missing.has(key)) continue
      const parts = await Promise.all(
        cluster.parts.map(async (part) => {
          const tiers = await bake(part)
          return { geometry: tiers[tiers.length - 1] as BufferGeometry, matrix: instanceMatrix(part) }
        }),
      )
      await slicer.yield()
      missing.set(key, [shellGeometry(parts, SHELL)])
    }
    // Another add may have put some in while this one waited.
    for (const key of missing.keys()) if (geometryIds.has(key)) missing.delete(key)
    let needVertices = vertices
    let needIndices = indices
    for (const tiers of missing.values())
      for (const g of new Set(tiers)) {
        needVertices += g.getAttribute("position").count
        needIndices += g.index?.count ?? 0
      }
    const needInstances = live + clustered + adding
    if (!mesh) {
      // three more vertices and indices: the stand-in triangle that sets the mesh's attributes (below)
      mesh = new LodBatchedMesh(
        Math.max(1, needInstances),
        Math.max(1, needVertices) + 3,
        Math.max(1, needIndices) + 3,
        batchMaterial(),
      )
      mesh.name = "static-batch"
      // Its attributes come from its first geometry, and its programs' keys from its attributes: the
      // stand-in (no instance, never drawn) makes the warm-up below compile the programs the pieces draw with.
      const standIn = standInGeometry()
      mesh.addGeometry(standIn)
      standIn.dispose()
      vertices += 3
      indices += 3
      needVertices += 3
      needIndices += 3
      mesh.fadeMaterial = batchMaterial(true)
      mesh.perObjectFrustumCulled = true
      // The island is always partly in view, so the whole-mesh test never culls; off, three also draws
      // the mesh while it is still empty, which allocates its buffers on the GPU (one upload, ~30 ms
      // for 130 MB) before the geometry lands: the sliced copies below then go up as ranges, a few MB
      // a frame, in place of one 100–300 ms upload on the first real draw.
      mesh.frustumCulled = false
      mesh.sortObjects = false
      mesh.castShadow = true
      mesh.receiveShadow = true
      // Its three programs (the main draw, the crossfade's, the shadow pass's) link in the background
      // before the first draw (warm.ts; `warmBatchPrograms` may have started them long before); it
      // is shown once its geometry is all in (below).
      mesh.visible = false
      stage.scene.add(mesh)
      capacity = { vertices: Math.max(1, needVertices), indices: Math.max(1, needIndices) }
      await warmPrograms(stage, mesh, BATCH_PROGRAMS())
    } else {
      if (needVertices > capacity.vertices || needIndices > capacity.indices) {
        capacity = {
          vertices: Math.max(needVertices, Math.ceil(capacity.vertices * GROWTH)),
          indices: Math.max(needIndices, Math.ceil(capacity.indices * GROWTH)),
        }
        mesh.setGeometrySize(capacity.vertices, capacity.indices)
      }
      if (needInstances > mesh.maxInstanceCount)
        mesh.setInstanceCount(Math.max(needInstances, Math.ceil(mesh.maxInstanceCount * GROWTH)))
    }
    for (const [key, tiers] of missing) {
      // the copies into the mesh, a few a slice (a frame drawn meanwhile has no instance of them yet)
      await slicer.yield()
      const ids = new Map<BufferGeometry, number>()
      for (const g of tiers) {
        if (ids.has(g)) continue
        const id = mesh.addGeometry(g)
        ids.set(g, id)
        mesh.setLodError(id, lodError(g))
        vertices += g.getAttribute("position").count
        indices += g.index?.count ?? 0
      }
      const [base, ...coarser] = tiers.map((g) => ids.get(g) as number) as [number, ...number[]]
      geometryIds.set(key, base)
      if (coarser.length > 0) mesh.setTiers(base, coarser)
      // The mesh copied it; a variant's tiers stay baked for later shells.
      if (key.startsWith("shell:")) tiers[0]?.dispose()
    }
    return mesh
  }

  const matrix = new Matrix4()
  const placed = new Matrix4()
  const reBound = (m: LodBatchedMesh) => {
    m.computeBoundingBox()
    m.computeBoundingSphere()
  }

  const place = (m: LodBatchedMesh, instance: BatchInstance, world?: Matrix4) => {
    const id = m.addInstance(geometryIds.get(variantKey(instance)) as number)
    instanceMatrix(instance, matrix)
    m.setMatrixAt(id, world ? placed.multiplyMatrices(world, matrix) : matrix)
    return id
  }

  const add = async (batch: readonly BatchInstance[], groups: readonly BatchCluster[] = []) => {
    const parts = groups.reduce((sum, cluster) => sum + cluster.parts.length + 1, 0)
    const m = await fit(batch, groups, batch.length + parts)
    const ids = batch.map((instance) => place(m, instance))
    live += ids.length
    const world = new Matrix4()
    for (const cluster of groups) {
      instanceMatrix(cluster, world)
      const shell = m.addInstance(geometryIds.get(shellKey(cluster)) as number)
      m.setMatrixAt(shell, world)
      m.addCluster(
        shell,
        cluster.parts.map((part) => place(m, part, world)),
      )
      live += cluster.parts.length
      clustered++
    }
    reBound(m)
    return ids
  }

  const ids = await add(instances, clusters)
  const built = mesh as unknown as LodBatchedMesh
  // Shown now, with every geometry in, so its buffers go up once (~30 ms for 130 MB): drawn while the
  // sliced copies landed, each copy into a buffer the frame before was still reading made ANGLE/Metal
  // copy the whole buffer again, and the GPU process fell seconds behind (every GL call then waited).
  built.visible = true
  logger.info("built", {
    instances: live,
    clusters: clustered,
    geometries: geometryIds.size,
    vertices,
    indices,
    ms: Math.round(performance.now() - start),
  })

  return {
    mesh: built,
    get count() {
      return live
    },
    get geometries() {
      return [...geometryIds.keys()].filter((key) => !key.startsWith("shell:")).length
    },
    get clusters() {
      return clustered
    },
    get lod() {
      return built.lod
    },
    ids,
    add: (batch) => add(batch),
    async update(id, instance) {
      const m = await fit([instance], [], 0)
      m.setGeometryIdAt(id, geometryIds.get(variantKey(instance)) as number)
      m.setMatrixAt(id, instanceMatrix(instance, matrix))
      reBound(m)
    },
    remove(id) {
      const m = mesh as unknown as LodBatchedMesh
      m.deleteInstance(id)
      live -= 1
      reBound(m)
    },
    dispose() {
      const m = mesh as unknown as LodBatchedMesh
      m.removeFromParent()
      m.dispose()
      for (const tiers of baked.values())
        tiers
          .then((list) => {
            for (const g of new Set(list)) g.dispose()
          })
          .catch(() => {})
    },
  }
}
