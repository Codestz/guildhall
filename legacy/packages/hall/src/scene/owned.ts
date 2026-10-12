import { type DependencyList, useEffect, useState } from "react"
import type { BatchedMesh, BufferGeometry, Material, Mesh, Texture } from "three"
import { shadows } from "./atmosphere/shadows.ts"

/**
 * One lifecycle for every GPU layer (instanced, batched or merged meshes): built and freed by the
 * same effect, held in state. Building in useMemo and disposing in an effect cleanup breaks under
 * StrictMode's double effect run: the cleanup frees what the second mount keeps drawing, which is
 * fatal for a BatchedMesh (dispose() drops its matrix texture, so every later frame throws). Here
 * every mount builds its own and frees exactly that one.
 */

/** What a mount holds: the value and the deps it was made for. */
export interface Held<T> {
  readonly value: T
  readonly deps: DependencyList
}

/**
 * The held value, if it was made for `deps`; null once they have changed. The render that sees new
 * deps (a new world) commits before the effect frees the old value, and a frame can run in between:
 * whatever that render hands out — to `useFrame`, to a `<primitive>` — must already be null, or the
 * frame draws or writes into a value about to be freed (a BatchedMesh's `setMatrixAt` on its
 * dropped matrix texture: "Cannot read properties of null (reading 'image')").
 */
export function heldFor<T>(held: Held<T> | null, deps: DependencyList): T | null {
  if (!held || held.deps.length !== deps.length) return null
  return held.deps.every((dep, i) => Object.is(dep, deps[i])) ? held.value : null
}

/** A value made and freed by the same mount; rebuilt (old one freed) when `deps` change. */
export function useOwned<T>(make: () => T, free: (value: T) => void, deps: DependencyList): T | null {
  const [held, setHeld] = useState<Held<T> | null>(null)
  useEffect(
    () => {
      const made = make()
      setHeld({ value: made, deps })
      return () => {
        setHeld(null)
        free(made)
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's `deps` decide when to rebuild
    deps,
  )
  return heldFor(held, deps)
}

/** What a layer's build returns: the meshes it draws, plus anything else the layer keeps. */
export interface Layer {
  readonly meshes: readonly Mesh[]
}

/**
 * What a layer does *not* own, so must not free:
 *   "textures"   its materials are its own, but their maps belong to a loaded model (a clone of a
 *                glTF material shares the original's textures)
 *   "materials"  its materials (and their maps) belong to a loaded model; only geometry is its own
 * Geometry is always the layer's own.
 */
export type Borrowed = "textures" | "materials"

/**
 * Builds a layer and returns it with the function that frees it. When any mesh casts into the
 * static shadow map, building and freeing both ask for a redraw (atmosphere/shadows.ts).
 */
export function ownLayer<T extends Layer>(build: () => T, borrowed?: Borrowed): { layer: T; free(): void } {
  const layer = build()
  const casts = layer.meshes.some((mesh) => mesh.castShadow)
  if (casts) shadows.request()
  return {
    layer,
    free() {
      freeMeshes(layer.meshes, borrowed)
      if (casts) shadows.request()
    },
  }
}

/**
 * A GPU layer built on mount (and again when `deps` change) and freed on unmount: the meshes,
 * their geometry, and — unless `borrowed` — their materials and the materials' textures. Null until
 * the first build has committed. Render each of `meshes` as a `<primitive>`.
 */
export function useOwnedMeshes<T extends Layer>(
  build: () => T,
  deps: DependencyList,
  borrowed?: Borrowed,
): T | null {
  return (
    useOwned(
      () => ownLayer(build, borrowed),
      (owned) => owned.free(),
      deps,
    )?.layer ?? null
  )
}

/**
 * Takes the meshes out of the scene (a freed BatchedMesh must never be drawn again, even for the
 * frame before React removes it) and frees them, their geometry, and what else they own. Each
 * resource is freed once, however many meshes share it.
 */
export function freeMeshes(meshes: readonly Mesh[], borrowed?: Borrowed): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  for (const mesh of meshes) {
    // A BatchedMesh frees its own (internal) geometry in dispose().
    if (!(mesh as BatchedMesh).isBatchedMesh) geometries.add(mesh.geometry)
    if (borrowed === "materials") continue
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material)
      if (borrowed === "textures") continue
      for (const value of Object.values(material))
        if ((value as Texture | null)?.isTexture) textures.add(value as Texture)
    }
  }
  for (const mesh of meshes) {
    mesh.removeFromParent()
    // InstancedMesh and BatchedMesh free their instance buffers (and a BatchedMesh its textures).
    ;(mesh as Mesh & { dispose?: () => void }).dispose?.()
  }
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}
