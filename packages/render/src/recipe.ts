/** A composed prefab (ADR 005) as one scene node: every recipe instance loaded, re-tinted and placed. */
import { PALETTE, type Recipe, type RecipeInstance, rampMapToSwatchMap } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { Group, type Object3D } from "three"
import { recolourPiece } from "./tint.ts"

const logger = log("render:recipe")

/**
 * An instance's full re-tint: its `rampMap` as swatch pairs, then its `swatchMap` on top, since a
 * swatch map is the single-swatch fix (ADR 008) and so wins over its ramp.
 */
export function instanceSwatchMap(instance: RecipeInstance): Record<number, number> {
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
 * The recipe as a Group named after it, one child per instance in recipe order (`userData.instance`
 * holds its index, `name` its piece id). `pieces` loads a catalog id as a fresh copy of the piece,
 * e.g. `(id) => loadPiece(libraryUrl(catalog.get(id).files.glb))`; a failed load rejects the whole
 * recipe. Geometry belongs to the piece and variant caches: remove the group, never dispose it.
 */
export async function recipeObject(
  recipe: Recipe,
  pieces: (id: string) => Promise<Object3D>,
): Promise<Object3D> {
  const children = await Promise.all(
    recipe.instances.map(async (instance, i) => {
      const piece = recolourPiece(await pieces(instance.piece), instanceSwatchMap(instance))
      piece.name = instance.piece
      piece.userData.instance = i
      return placeInstance(piece, instance)
    }),
  )
  const root = new Group()
  root.name = recipe.id
  if (children.length > 0) root.add(...children)
  logger.debug("built", { recipe: recipe.id, instances: children.length })
  return root
}
