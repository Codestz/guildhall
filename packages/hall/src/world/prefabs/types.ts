import type { KitColour } from "../gen/biomes.ts"
import type { LandPiece } from "../lands.ts"

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
  /** For a variation's props: the chance it stands there at all (default ½). */
  chance?: number
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

/**
 * How a prefab may differ from one placement to the next, by a seed (variants.ts): the same seed
 * always gives the same structure, and seed 0 is the plain one the catalogue draws. Each choice is
 * drawn from the seed on its own, so a few declared ones make dozens of looks.
 */
export interface Variation {
  /** Parts named `{kit}` take one of the four team colours (the district's most often), not always the district's. */
  tint?: boolean
  /** The layout may flip left for right, doors with it. Not for what has windows or chimneys the world lights. */
  mirror?: boolean
  /** Extra props, there or not by the seed. */
  props?: readonly Part[]
  /** Pieces that may be swapped for another: a market's blue awning for the red. */
  swaps?: Readonly<Record<string, readonly string[]>>
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
  /** What a seed may change (the homes', the inn's and the market's: so a town is not one house over and over). */
  variation?: Variation
}

/** The kit-coloured name a part resolves to. */
export const pieceOf = (name: string, kit: KitColour): LandPiece => name.replace("{kit}", kit) as LandPiece
