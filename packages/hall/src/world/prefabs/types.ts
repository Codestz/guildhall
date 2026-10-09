import type { KitColour } from "../gen/biomes.ts"
import type { LandPiece, LandPlacement } from "../lands.ts"

/**
 * A prefab: one composed structure from the land pack's pieces, laid out once in data and placed by
 * the generator (gen/dress/town.ts) instead of piece by piece. Coordinates are world units in the
 * prefab's own frame: origin at its anchor hex's centre, +z its front (where the door faces), +x to
 * its right. Placed at a hex with a turn, it is the same shape the lab (`?lab=prefabs`) shows.
 */

/** One piece of a prefab. `{kit}` in the name is the district's colour (the homes come in four). */
export interface Part {
  piece: string
  x: number
  z: number
  /** Turn about the vertical, radians (0 faces +z). */
  rot?: number
  y?: number
  /** Relative to the pack's 5× drawing size. */
  scale?: number
}

/** Where someone enters: a spot in front of a door, and the way the door faces. */
export interface Door {
  x: number
  z: number
  rot: number
}

export type PrefabKind = "house" | "market" | "plaza" | "civic" | "wall" | "site"

export interface Prefab {
  /** Stable: lots, saves and shots refer to it. */
  id: string
  label: string
  kind: PrefabKind
  /** Hex rings round the anchor it needs (0 is the one hex, 1 is it and its six neighbours). */
  rings: 0 | 1 | 2
  /** Houses it holds (a lot's density), for the houses. */
  houses?: number
  parts: readonly Part[]
  /** For visitable buildings later; empty for what nobody enters. */
  doors: readonly Door[]
}

const round = (value: number): number => Math.round(value * 100) / 100

/** The kit-coloured name a part resolves to. */
export const pieceOf = (name: string, kit: KitColour): LandPiece => name.replace("{kit}", kit) as LandPiece

/** A point of the prefab's frame in the world, the prefab stood at `at` and turned by `rot`. */
function toWorld(at: readonly [number, number], rot: number, x: number, z: number): [number, number] {
  const sin = Math.sin(rot)
  const cos = Math.cos(rot)
  return [round(at[0] + x * cos + z * sin), round(at[1] - x * sin + z * cos)]
}

/** The prefab stood at `at`, turned by `rot` (its front toward (sin rot, cos rot)), lifted by `y`. */
export function instantiate(
  prefab: Prefab,
  at: readonly [number, number],
  rot: number,
  kit: KitColour,
  y = 0,
): LandPlacement[] {
  return prefab.parts.map((part) => {
    const [x, z] = toWorld(at, rot, part.x, part.z)
    const lift = y + (part.y ?? 0)
    return {
      piece: pieceOf(part.piece, kit),
      x,
      z,
      rot: round(rot + (part.rot ?? 0)),
      ...(lift ? { y: lift } : {}),
      ...(part.scale ? { scale: part.scale } : {}),
    }
  })
}

/** A prefab's door spots in the world, by the same transform. */
export function doorsOf(prefab: Prefab, at: readonly [number, number], rot: number): Door[] {
  return prefab.doors.map((door) => {
    const [x, z] = toWorld(at, rot, door.x, door.z)
    return { x, z, rot: round(rot + door.rot) }
  })
}
