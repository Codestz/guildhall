import type { Craft } from "@guildhall/core"
import type { Placement } from "../furniture.ts"
import type { Post, Spot } from "../layout.ts"
import type { VenueDoor } from "../venues.ts"

/**
 * An island's hall: the open-roofed floor its main landmark keeps for the folk who work on the
 * island, where the home island's great hall (scene/Room.tsx) stands at the keep. It is plain data
 * (a Web Worker posts it) built by world/hall/build.ts, placed in front of the landmark's door by
 * world/hall/site.ts, and drawn from the kit by scene/HallRoom.tsx. Every coordinate is the
 * island's own (the keep at the origin), like the rest of the world.
 */

/** What a hall is like, by the landmark it belongs to (world/hall/styles.ts). */
export type HallStyle =
  | "great-hall"
  | "keep-yard"
  | "workshop"
  | "scriptorium"
  | "observatory"
  | "harbour-hall"
  | "chapel"
  | "lantern-loft"
  | "watch-post"

/** What stands at a work spot: what a deed there is, to the people who do it. */
export type SpotKind = "desk" | "pew" | "bench" | "anvil" | "shelf" | "table" | "stand"

/** One place to sit or work. A visitor takes a free one that suits the deed (world/hall/spots.ts). */
export interface HallSpot {
  /** "<kind>.<n>": stable for a hall. */
  id: string
  kind: SpotKind
  /** They sit (a chair, a stool or a pew), else they stand and work. */
  seat: boolean
  /** Where they sit or stand, and the way they face. */
  post: Post
  /** The clip they play there (a seated one for a seat: world/hall/spots.ts). */
  clip: string
  /** The crafts it suits best. */
  crafts: readonly Craft[]
}

/** The four walls, so the one between the camera and the floor can be cut away (as the great hall's). */
export type WallSide = "back" | "front" | "left" | "right"

export interface Hall {
  style: HallStyle
  /** The hall's centre, and the turn of its frame (its +z is where its gate looks, away from the landmark). */
  at: Spot
  rot: number
  /** Its floor, across (x) and deep (z), in its own frame. */
  w: number
  d: number
  floor: readonly Placement[]
  walls: readonly { side: WallSide; pieces: readonly Placement[] }[]
  /** Furniture and what hangs or stands about: never faded. */
  props: readonly Placement[]
  spots: readonly HallSpot[]
  /** The gate: step outside it, sill within, the heading of someone going in (a venue's door, world/venues.ts). */
  door: VenueDoor
  /** The landmark's door the back wall opens onto: the hall is part of it. */
  entry: Spot
}
