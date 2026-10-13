/**
 * The static draw path (ADR 007): every static piece of a set (the town) in one BatchedMesh, so each
 * pass (main and every shadow cascade) is one multi-draw call whatever the count or variety. Each
 * distinct (piece, re-tint) is one geometry in it (ADR 008), loaded and baked once, with coarser LOD
 * tiers simplified from it at load; a cluster (a compiled house) also gets one merged shell for far
 * away. Which tier each instance draws is picked per pass by screen size (batchMesh.ts, lod.ts).
 */
import type { RecipeInstance } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { type BufferGeometry, Euler, Matrix4, type Object3D, Quaternion, Vector3 } from "three"
import { batchGeometry } from "./batchGeometry.ts"
import { LodBatchedMesh } from "./batchMesh.ts"
import { type LodCounts, PIECE_TIERS, SHELL, TIER_MIN_AREA, TIER_MIN_SAVING } from "./lod.ts"
import { lodError, shellGeometry, simplifierReady, simplifyGeometry, surfaceArea } from "./lodGeometry.ts"
import { batchMaterial } from "./material.ts"
import { GLOW_SWATCHES } from "./night/glow.ts"
import { instanceSwatchMap } from "./recipe.ts"
import { createSlicer } from "./slice.ts"
import type { Stage } from "./stage.ts"
import { swatchMapKey } from "./tint.ts"

const logger = log("render:batch")

/**
 * One placed static piece: a catalog id, metres, `rot` radians about +y, uniform `scale`, and an
 * optional re-tint. `TownDraw.pieces` (`PieceInstance`) and recipe instances are both this shape.
 */
export type BatchInstance = Pick<
  RecipeInstance,
  "piece" | "x" | "y" | "z" | "rot" | "scale" | "swatchMap" | "rampMap" | "tilt"
> & {
  /** Stretch along the piece's own x on top of `scale` (a wall piece fitted to its run). */
  stretch?: number
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

const variantKey = (instance: BatchInstance) =>
  `${instance.piece}|${swatchMapKey(instanceSwatchMap(instance))}`

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
  stage: Pick<Stage, "scene" | "renderer">,
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
      mesh = new LodBatchedMesh(
        Math.max(1, needInstances),
        Math.max(1, needVertices),
        Math.max(1, needIndices),
        batchMaterial(),
      )
      mesh.name = "static-batch"
      mesh.fadeMaterial = batchMaterial(true)
      mesh.perObjectFrustumCulled = true
      mesh.sortObjects = false
      mesh.castShadow = true
      mesh.receiveShadow = true
      stage.scene.add(mesh)
      capacity = { vertices: Math.max(1, needVertices), indices: Math.max(1, needIndices) }
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
