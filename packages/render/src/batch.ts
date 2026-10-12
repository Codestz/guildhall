/**
 * The static draw path (ADR 007): every static piece of a set (the town) in one BatchedMesh, so each
 * pass (main and every shadow cascade) is one multi-draw call whatever the count or variety. Each
 * distinct (piece, re-tint) is one geometry in it (ADR 008), loaded and baked once.
 */
import type { RecipeInstance } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { BatchedMesh, Matrix4, type Object3D, Quaternion, Vector3 } from "three"
import { batchGeometry } from "./batchGeometry.ts"
import { paletteMaterial } from "./material.ts"
import { instanceSwatchMap } from "./recipe.ts"
import type { Stage } from "./stage.ts"
import { swatchMapKey } from "./tint.ts"

const logger = log("render:batch")

/**
 * One placed static piece: a catalog id, metres, `rot` radians about +y, uniform `scale`, and an
 * optional re-tint. `TownDraw.pieces` (`PieceInstance`) and recipe instances are both this shape.
 */
export type BatchInstance = Pick<
  RecipeInstance,
  "piece" | "x" | "y" | "z" | "rot" | "scale" | "swatchMap" | "rampMap"
>

export interface StaticBatch {
  /** The one draw: in the stage's scene, casting and receiving sun shadows. */
  mesh: BatchedMesh
  /** Instances drawn now. */
  readonly count: number
  /** Distinct (piece, re-tint) geometries held. */
  readonly geometries: number
  /** The instance ids of the pieces the batch was created with, in their order. */
  ids: readonly number[]
  /** Adds more pieces (growing the buffers when they are full); their instance ids, in order. */
  add(instances: readonly BatchInstance[]): Promise<number[]>
  /** Moves, turns, re-tints or swaps the piece of instance `id`. */
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

const position = new Vector3()
const turn = new Quaternion()
const size = new Vector3()
const up = new Vector3(0, 1, 0)

/** The placement of `instance` as a world matrix, as `placeInstance` would pose a scene node. */
export function instanceMatrix(instance: BatchInstance, out = new Matrix4()): Matrix4 {
  position.set(instance.x, instance.y, instance.z)
  turn.setFromAxisAngle(up, instance.rot)
  size.setScalar(instance.scale)
  return out.compose(position, turn, size)
}

/**
 * Every instance in one BatchedMesh added to `stage.scene`, sized exactly to the distinct geometries'
 * vertices and indices and to the instance count. `load` loads a catalog id as a copy of the piece
 * (e.g. `(id) => loadPiece(libraryUrl(catalog.get(id).files.glb))`), called once per piece; a failed
 * load rejects. Per-instance frustum culling runs for the camera and each shadow camera; instances are
 * not sorted (one opaque material). Without `WEBGL_multi_draw` three draws one call per instance, so
 * that is logged as an error.
 */
export async function createStaticBatch(
  stage: Pick<Stage, "scene" | "renderer">,
  instances: readonly BatchInstance[],
  load: (piece: string) => Promise<Object3D>,
): Promise<StaticBatch> {
  const start = performance.now()
  if (!stage.renderer.extensions.has("WEBGL_multi_draw"))
    logger.error("no WEBGL_multi_draw: the batch draws one call per instance")

  const pieces = new Map<string, Promise<Object3D>>()
  const baking = new Map<string, Promise<ReturnType<typeof batchGeometry>>>()
  /** Variant key → geometry id in the mesh. */
  const geometryIds = new Map<string, number>()
  let mesh: BatchedMesh | null = null
  let vertices = 0
  let indices = 0
  let live = 0
  /** The mesh's vertex and index buffer sizes (three keeps them private). */
  let capacity = { vertices: 0, indices: 0 }

  const bake = (instance: BatchInstance) => {
    const key = variantKey(instance)
    let geometry = baking.get(key)
    if (!geometry) {
      let piece = pieces.get(instance.piece)
      if (!piece) {
        piece = load(instance.piece)
        pieces.set(instance.piece, piece)
      }
      geometry = piece.then((root) => batchGeometry(root, instanceSwatchMap(instance)))
      baking.set(key, geometry)
    }
    return geometry
  }

  /**
   * Bakes what `batch` needs that the mesh lacks, grows the mesh to fit it and `adding` more
   * instances, and adds the geometry.
   */
  const fit = async (batch: readonly BatchInstance[], adding: number) => {
    const missing = new Map<string, ReturnType<typeof batchGeometry>>()
    await Promise.all(
      batch.map(async (instance) => {
        const key = variantKey(instance)
        if (!geometryIds.has(key)) missing.set(key, await bake(instance))
      }),
    )
    // Another add may have put some in while this one waited.
    for (const key of missing.keys()) if (geometryIds.has(key)) missing.delete(key)
    let needVertices = vertices
    let needIndices = indices
    for (const g of missing.values()) {
      needVertices += g.getAttribute("position").count
      needIndices += g.index?.count ?? 0
    }
    const needInstances = live + adding
    if (!mesh) {
      mesh = new BatchedMesh(
        Math.max(1, needInstances),
        Math.max(1, needVertices),
        Math.max(1, needIndices),
        paletteMaterial(),
      )
      mesh.name = "static-batch"
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
    for (const [key, g] of missing) {
      geometryIds.set(key, mesh.addGeometry(g))
      vertices += g.getAttribute("position").count
      indices += g.index?.count ?? 0
      // The mesh copied it; the baked geometry is no longer needed.
      g.dispose()
      baking.delete(key)
    }
    return mesh
  }

  const matrix = new Matrix4()
  const reBound = (m: BatchedMesh) => {
    m.computeBoundingBox()
    m.computeBoundingSphere()
  }

  const add = async (batch: readonly BatchInstance[]) => {
    const m = await fit(batch, batch.length)
    const ids = batch.map((instance) => {
      const id = m.addInstance(geometryIds.get(variantKey(instance)) as number)
      m.setMatrixAt(id, instanceMatrix(instance, matrix))
      return id
    })
    live += ids.length
    reBound(m)
    return ids
  }

  const ids = await add(instances)
  const built = mesh as unknown as BatchedMesh
  logger.info("built", {
    instances: live,
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
      return geometryIds.size
    },
    ids,
    add,
    async update(id, instance) {
      const m = await fit([instance], 0)
      m.setGeometryIdAt(id, geometryIds.get(variantKey(instance)) as number)
      m.setMatrixAt(id, instanceMatrix(instance, matrix))
      reBound(m)
    },
    remove(id) {
      const m = mesh as unknown as BatchedMesh
      m.deleteInstance(id)
      live -= 1
      reBound(m)
    },
    dispose() {
      const m = mesh as unknown as BatchedMesh
      m.removeFromParent()
      m.dispose()
    },
  }
}
