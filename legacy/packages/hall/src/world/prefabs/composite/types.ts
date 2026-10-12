import type { KitColour } from "../../gen/biomes.ts"
import type { Door, Fixture, Part, Prefab } from "../types.ts"

/**
 * A composite: a landmark built from child prefabs and kit pieces at relative transforms, in nested
 * groups, and flattened to the plain parts the island batches (flatten.ts), so it costs no draw call
 * beyond the kit materials. It is laid out in the same frame as a prefab (origin the anchor hex's
 * centre, +z its front, +x its right) and the seed varies its structure (a wing more, a tower fewer,
 * a flipped plan, another palette): the same seed always gives the same landmark, seed 0 the plain one.
 */

/** Where a group or a child stands in its parent's frame; the scale multiplies positions and parts alike. */
export interface Pose {
  x?: number
  z?: number
  y?: number
  rot?: number
  scale?: number
}

/** A child prefab or composite by id, placed as a whole (its own variation drawn from the seed). */
export interface Ref extends Pose {
  ref: string
}

/** What a group offers the landmark's users, in the group's own frame. */
export interface Marks {
  doors?: readonly Door[]
  windows?: readonly Fixture[]
  chimneys?: readonly Fixture[]
  /** Where smoke rises (a furnace, a smelter): a point, not tied to a venue being busy. */
  smoke?: readonly Fixture[]
  /** The spot the landmark's eye lands on: its keep's top, its spire (the camera's aim). */
  focal?: Fixture
}

/** A named group of children: a wing, a wall, a tier. The tree is what the lab's inspector lists. */
export interface Group extends Pose, Marks {
  name: string
  kids: readonly Node[]
}

export type Node = Part | Group | Ref

export const isGroup = (node: Node): node is Group => "kids" in node
export const isRef = (node: Node): node is Ref => "ref" in node

export type Size = "S" | "M" | "L"

/** The seed's choices, each drawn on its own (so a few declared make dozens of looks). Seed 0 is the plain landmark. */
export interface Variant {
  seed: number
  /** The colour `{kit}` parts take (when the composite tints). */
  kit: KitColour
  /** The banner colour: the pack has flags in blue, red and yellow. */
  flag: "blue" | "red" | "yellow"
  /** An integer in [lo, hi]; `plain` when seed is 0. */
  int(salt: string, plain: number, lo: number, hi: number): number
  /** The picks that came out other than the first of their list, as `salt → choice` (what a seed swapped). */
  readonly swapped: string[]
  /** One of `list`; the first when seed is 0. */
  pick<T>(salt: string, list: readonly T[]): T
  /** Whether something with this chance is there: at seed 0, when the chance is a half or more. */
  has(salt: string, chance?: number): boolean
}

export interface Composite {
  /** Stable: lots, saves and shots refer to it. */
  id: string
  label: string
  size: Size
  /** Hex rings round the anchor it needs (its parts stay inside, a coastal one's dock apart). */
  rings: 0 | 1 | 2
  /** Its back (-z) edge stands on a coast: the sea wall and dock lie there, one hex into the water. */
  coastal?: boolean
  /** What a seed may flip: the plan's mirror and the district's colour on `{kit}` parts. */
  variation: { mirror?: boolean; tint?: boolean }
  build(v: Variant): Group
}

/** A group's tree as the inspector shows it: name, the pieces beneath, the groups within. */
export interface Tree {
  name: string
  pieces: number
  kids: Tree[]
}

/** A composite as one seed made it: a plain prefab (everything that takes one works) and what the landmark adds. */
export interface Composed extends Prefab {
  composite: Composite
  seed: number
  /** The colour its `{kit}` parts took (the seed's tint), and the banners' (`flag`). */
  kit: KitColour
  flag: Variant["flag"]
  mirrored: boolean
  /** The sub-parts the seed swapped for another (`pick`s that left the first of their list). */
  swapped: string[]
  /** Where the eye lands, in the frame (y up); the group's focal, or the tallest part's top. */
  focal: Fixture
  smoke: readonly Fixture[]
  tree: Tree
}
