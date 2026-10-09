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
  /** How far in from that spot the sill lies, along the way the door faces (default DOOR_DEPTH). */
  depth?: number
  /** How high the sill is above the step, when a flight of steps leads up to it. */
  y?: number
}

/** The sill a pace in from the step when a door doesn't say. */
export const DOOR_DEPTH = 1.1

/** A point on a prefab: a lit window's glow, a chimney's top. `y` is its height above the ground. */
export interface Fixture {
  x: number
  y: number
  z: number
}

export type PrefabKind = "house" | "market" | "plaza" | "civic" | "wall" | "venue"

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
  /** Where people go in (a venue's door is its first); empty for what nobody enters. */
  doors: readonly Door[]
  /** A venue's glow spots (windows, the furnace's mouth): lit while someone is inside. */
  windows?: readonly Fixture[]
  /** A venue's chimney tops: smoking while someone is inside. */
  chimneys?: readonly Fixture[]
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
    return {
      x,
      z,
      rot: round(rot + door.rot),
      ...(door.depth ? { depth: door.depth } : {}),
      ...(door.y ? { y: door.y } : {}),
    }
  })
}

/** A prefab's fixtures (windows, chimneys) in the world, by the same transform; `y` lifts them. */
export function fixturesOf(
  list: readonly Fixture[] | undefined,
  at: readonly [number, number],
  rot: number,
  y = 0,
): Fixture[] {
  return (list ?? []).map((fixture) => {
    const [x, z] = toWorld(at, rot, fixture.x, fixture.z)
    return { x, y: round(fixture.y + y), z }
  })
}
