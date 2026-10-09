import { useLayoutEffect } from "react"
import { type BatchedMesh, Color, Matrix4, type Mesh, type Object3D } from "three"
import { growing } from "../../world/chronicle/growthControl.ts"
import type { Role } from "../../world/chronicle/growthPieces.ts"
import { cellAt, key } from "../../world/gen/hex.ts"
import { KEEP } from "../../world/gen/plan.ts"

/**
 * What the growth timelapse (`?grow`, ADR 0021) may move: the island's own batches (scene/Island,
 * nature/Wilds) and the fields' group, registered by those layers while they are mounted. Each
 * batch says, per instance it drew, what kind of piece it is and where it stands
 * (`markGrowable`); the film (scene/growth/drive.ts) then rides those instances up and down with
 * per-instance matrices, visibility and colour: no React, no new draw calls. Registering costs
 * nothing when no film is asked; while one is (even still loading) a new batch is hidden at once,
 * the keep aside, so today's island never flashes up before the film starts.
 */

export interface GrowthMarks {
  ids: number[]
  roles: Role[]
  /** x, z per instance. */
  spots: number[]
  /** The piece each instance draws, where the layer said (growth film v2 tells stages apart by it). */
  pieces: string[]
  /** A mountain's massifs (their hex keys), so it rises with its land (growthRelief.ts); undefined for the rest. */
  massifs: (readonly ReadonlySet<string>[] | undefined)[]
  /** Each instance's own matrix as built: what `restore` puts back. */
  base?: Float32Array
}

/** Marks a batch's instance `id` as a growable piece (in the layer's build, as it adds instances). */
export function markGrowable(
  mesh: BatchedMesh,
  id: number,
  role: Role,
  x: number,
  z: number,
  piece = "",
  massifs?: readonly ReadonlySet<string>[],
): void {
  const marks: GrowthMarks = marksOf(mesh) ?? { ids: [], roles: [], spots: [], pieces: [], massifs: [] }
  mesh.userData.growth = marks
  marks.ids.push(id)
  marks.roles.push(role)
  marks.spots.push(x, z)
  marks.pieces.push(piece)
  marks.massifs.push(massifs)
}

export const marksOf = (mesh: BatchedMesh): GrowthMarks | undefined =>
  mesh.userData.growth as GrowthMarks | undefined

const batches = new Set<BatchedMesh>()
const groups = new Map<Object3D, readonly (readonly [number, number])[]>()

/** The registered batches and groups (scene/growth/drive.ts reads them each frame). */
export const growables = { batches, groups }

const matrix = new Matrix4()
const white = new Color(1, 1, 1)

function capture(mesh: BatchedMesh, marks: GrowthMarks): void {
  if (marks.base) return
  marks.base = new Float32Array(marks.ids.length * 16)
  marks.ids.forEach((id, i) => {
    mesh.getMatrixAt(id, matrix)
    marks.base?.set(matrix.elements, i * 16)
  })
}

const inKeep = (x: number, z: number): boolean => KEEP.has(key(cellAt([x, z])))

/** Everything but the sea floor and the keep under the sea: the film's first frame, before it has one. */
function veil(mesh: BatchedMesh, marks: GrowthMarks): void {
  marks.ids.forEach((id, i) => {
    if (marks.roles[i] === "sea") return
    if (!inKeep(marks.spots[i * 2] as number, marks.spots[i * 2 + 1] as number)) mesh.setVisibleAt(id, false)
  })
}

/** Hides every registered piece but the sea floor and the keep: a film asked on an island already up. */
export function veilGrowables(): void {
  for (const mesh of batches) {
    const marks = marksOf(mesh)
    if (marks) veil(mesh, marks)
  }
  for (const group of groups.keys()) group.visible = false
}

/** Puts every registered piece back as it was built (the film ended, or never had a plan). */
export function restoreGrowables(): void {
  for (const mesh of batches) {
    const marks = marksOf(mesh)
    if (!marks?.base) continue
    marks.ids.forEach((id, i) => {
      matrix.fromArray(marks.base as Float32Array, i * 16)
      mesh.setMatrixAt(id, matrix)
      mesh.setVisibleAt(id, true)
      // Only a batch that took a colour has a colour texture to whiten again.
      if ((mesh as unknown as { _colorsTexture: unknown })._colorsTexture) mesh.setColorAt(id, white)
    })
  }
  for (const group of groups.keys()) group.visible = true
}

/** Registers a layer's batches (those that marked instances) while they are mounted. */
export function useGrowable(meshes: readonly Mesh[] | undefined): void {
  useLayoutEffect(() => {
    if (!meshes) return
    const mine: BatchedMesh[] = []
    for (const mesh of meshes) {
      const batch = mesh as BatchedMesh
      const marks = batch.isBatchedMesh ? marksOf(batch) : undefined
      if (!marks) continue
      capture(batch, marks)
      if (growing()) veil(batch, marks)
      batches.add(batch)
      mine.push(batch)
    }
    return () => {
      for (const batch of mine) batches.delete(batch)
    }
  }, [meshes])
}

/** Registers a group (the fields) shown once the land under all of `spots` is up and green. */
export function useGrowableGroup(
  object: Object3D | null,
  spots: readonly (readonly [number, number])[],
): void {
  useLayoutEffect(() => {
    if (!object || spots.length === 0) return
    groups.set(object, spots)
    if (growing()) object.visible = false
    return () => {
      groups.delete(object)
    }
  }, [object, spots])
}
