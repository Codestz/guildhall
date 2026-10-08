import type { Role } from "@guildhall/roster"

/**
 * The great hall, in KayKit's native units (a floor tile is 4×4, a wall 4 high, a character ~2.5 tall).
 * x runs left→right, z back→front; the gate is in the front wall. Positions are data so the
 * layout can be tuned (and later edited in the Lab) without touching scene code.
 */

export type StationId = Role["station"]
export type Spot = readonly [x: number, z: number]
/** Where someone stands and which way they face (radians, 0 = facing +z / the camera side). */
export type Post = readonly [x: number, z: number, facing: number]

export const TILE = 4
export const ROOM = { cols: 9, rows: 6, width: 36, depth: 24, wallHeight: 4 } as const

export interface Station {
  id: StationId
  label: string
  /** Centre, for lamps and labels. */
  at: Spot
  /** One post per adventurer who can work here at once. */
  posts: readonly Post[]
}

/** Facing the back wall / facing the gate. */
const TO_BACK = Math.PI
const TO_GATE = 0

export const STATIONS: Record<StationId, Station> = {
  // The dais first (the guildmaster's place), then two seats beside it for the guildmasters of other
  // parties on the island at once (guild/parties.ts): one per conversation, never shared.
  "quest-board": {
    id: "quest-board",
    label: "Quest board",
    at: [0, -10],
    posts: [
      [0, -7.4, TO_BACK],
      [4.4, -7.6, TO_BACK],
      [9.2, -6.8, TO_BACK],
    ],
  },
  library: {
    id: "library",
    label: "Library",
    at: [-13, -10.5],
    posts: [
      [-14.5, -8.4, TO_BACK],
      [-11.5, -8.4, TO_BACK],
    ],
  },
  forge: {
    id: "forge",
    label: "Forge",
    at: [13, -9.5],
    posts: [
      [9.6, -7.6, TO_BACK],
      [13, -7.6, TO_BACK],
      [16.2, -7.6, TO_BACK],
    ],
  },
  "drafting-table": {
    id: "drafting-table",
    label: "Drafting table",
    at: [-13, -1.5],
    posts: [[-13, 0.6, TO_BACK]],
  },
  easel: { id: "easel", label: "Designer's corner", at: [13, -1.5], posts: [[13, 0.6, TO_BACK]] },
  "map-table": {
    id: "map-table",
    label: "Map table",
    at: [-13, 6.5],
    posts: [
      [-14.6, 4.2, TO_GATE],
      [-11.4, 4.2, TO_GATE],
    ],
  },
  "scroll-desk": { id: "scroll-desk", label: "Scroll desk", at: [-5.5, 7], posts: [[-5.5, 5, TO_GATE]] },
  "inspection-bench": {
    id: "inspection-bench",
    label: "Inspection bench",
    at: [13, 7],
    posts: [[13, 5, TO_GATE]],
  },
  overflow: {
    id: "overflow",
    label: "Overflow",
    at: [6, -2],
    posts: [
      [4.5, -0.6, TO_BACK],
      [7.5, -0.6, TO_BACK],
      [4.5, -3.4, TO_GATE],
      [7.5, -3.4, TO_GATE],
    ],
  },
}

export const HEARTH: Spot = [0, -1.5]
/** Just outside the gate: where adventurers arrive from and fade out to. */
export const GATE: Spot = [0, 16]

/** Tavern stools, front right: finished adventurers rest here until they leave or are resumed. */
export const TAVERN: readonly Post[] = [
  [3.2, 4.4, Math.PI / 2],
  [3.2, 6.4, Math.PI / 2],
  [3.2, 8.4, Math.PI / 2],
  [6.8, 4.4, -Math.PI / 2],
  [6.8, 6.4, -Math.PI / 2],
  [6.8, 8.4, -Math.PI / 2],
]

/** What an adventurer sits or lies on at their post. */
export type Seat = "stool" | "floor" | "bed"

/** Infirmary beds, back middle-left: failed adventurers lie here until dismissed. */
export const INFIRMARY: readonly Post[] = [
  [-6.5, -9.2, 0],
  [-3.5, -9.2, 0],
  [-9.5, -9.2, 0],
]

/**
 * When every bed is taken: bedrolls on the floor in front of them (a run with six failed
 * subagents stacked three to a bed). Lying down puts the body ~1.8 behind the post, on the mat.
 */
export const INFIRMARY_MATS: readonly Post[] = [
  [-6.5, -5.4, 0],
  [-3.5, -5.4, 0],
  [-9.5, -5.4, 0],
]

/** Seats on the floor round the hearth (`hearthSeat`); past them a crowd finds floor nearby (guild/crowd.ts). */
export const HEARTH_SEATS = 9

/** When the tavern is full: sit on the floor around the hearth. */
export function hearthSeat(n: number): Post {
  const angle = Math.PI * 0.2 + n * ((Math.PI * 2) / HEARTH_SEATS)
  const x = HEARTH[0] + Math.cos(angle) * 3.4
  const z = HEARTH[1] + Math.sin(angle) * 3.4
  return [x, z, Math.atan2(HEARTH[0] - x, HEARTH[1] - z)]
}

/** Where the guildmaster takes loot: just in front of the dais. */
export const HAND_IN: Post = [1.8, -5.6, -Math.PI * 0.75]

/** Where loot is handed to each seat's guildmaster (STATIONS["quest-board"].posts), facing them. */
export const HAND_INS: readonly Post[] = [
  HAND_IN,
  [6, -5.6, Math.atan2(-1.6, -2)],
  [10.6, -5, Math.atan2(-1.4, -1.8)],
]
