import { ARCHETYPES } from "@guildhall/roster"
import type { Post } from "../world/layout.ts"
import type { World } from "../world/world.ts"
import type { Names } from "./casting.ts"
import type { Docket, Petition, Tint } from "./docket.ts"
import type { AdventurerView } from "./views.ts"

/**
 * The petitioners as the cast draws them (PROTOCOL.md §7): each open issue the docket seats
 * (guild/docket.ts) is an AdventurerView — a hooded Wanderer waiting in the queue at the head of the
 * quay, tinted by its labels — so the hall's own figures, crowd, chips and dissolves carry it
 * unchanged. A newcomer walks down from the road behind the queue; when its issue closes it turns
 * and walks back up the road and dissolves.
 */

/** The party every petitioner is in: never an agent party's id. */
export const PETITION_PARTY = "petitions"
/** A petitioner opened this recently (run ms) walks in; an older one is simply there. */
export const WALK_IN_MS = 6_000
/** A closed issue's petitioner is shown leaving for this long (run ms), then is let go. */
export const WALK_OFF_MS = 9_000
/** The road behind the queue where petitioners come from and go back to, in world units from the quay. */
const ROAD = 6
/** Where the queue starts, how far apart its rows are, and how wide it is. */
const FIRST = 1.4
const ROW = 1.9
const HALF_WIDTH = 1.1

/** A petitioner's tint: what its issue's labels make of its cloak. */
export const TINTS: Readonly<Record<Tint, string>> = {
  bug: "#d9604f",
  feature: "#4f9fd9",
  other: "#a79a86",
}

/** The quay's head and the way inland from it (a unit vector towards the keep at the origin). */
function quayHead(world: World): { x: number; z: number; ux: number; uz: number } {
  const dock = world.island.landmarks.find((mark) => mark.kind === "dock")
  const [x, z] = dock ? [dock.x, dock.z] : [0, 0]
  const length = Math.hypot(x, z)
  return length < 1 ? { x, z, ux: 0, uz: -1 } : { x, z, ux: -x / length, uz: -z / length }
}

const round = (value: number): number => Math.round(value * 100) / 100

/** Place `place` in the queue, facing the quay: two abreast, row after row going inland. */
export function queueSpot(world: World, place: number): Post {
  const { x, z, ux, uz } = quayHead(world)
  const row = FIRST + Math.floor(place / 2) * ROW
  const across = (place % 2 === 0 ? -1 : 1) * HALF_WIDTH
  return [round(x + ux * row - uz * across), round(z + uz * row + ux * across), Math.atan2(-ux, -uz)]
}

/** Up the road behind the queue, facing the quay: where a petitioner walks in from, and off to. */
function roadSpot(world: World, place: number): Post {
  const { x, z, ux, uz } = quayHead(world)
  const side = (place % 3) - 1
  return [
    round(x + ux * (FIRST + 5 * ROW + ROAD) - uz * side * 1.2),
    round(z + uz * (FIRST + 5 * ROW + ROAD) + ux * side * 1.2),
    Math.atan2(-ux, -uz),
  ]
}

const shorten = (title: string, max = 34): string =>
  title.length > max ? `${title.slice(0, max - 1)}…` : title

/**
 * The petitioners at run time `time`: every seated one who is waiting, and those whose issue closed
 * in the last WALK_OFF_MS, leaving. `previous` views are kept by identity where nothing changed.
 */
export function petitionersOf(
  docket: Docket,
  time: number,
  world: World,
  names: Names,
  previous: ReadonlyMap<string, AdventurerView> = new Map(),
): AdventurerView[] {
  const views: AdventurerView[] = []
  for (const petition of docket.petitions) {
    const leaving = petition.closed !== undefined
    if (leaving && time - (petition.closed as number) > WALK_OFF_MS) continue
    if (petition.place === -1 && !leaving) continue
    const view = viewOf(petition, time, world, names, leaving)
    const before = previous.get(view.id)
    views.push(before && JSON.stringify(before) === JSON.stringify(view) ? before : view)
  }
  return views
}

function viewOf(
  petition: Petition,
  time: number,
  world: World,
  names: Names,
  leaving: boolean,
): AdventurerView {
  const archetype = ARCHETYPES.wanderer
  const color = TINTS[petition.tint]
  const named = names === "world"
  const place = Math.max(0, petition.place)
  const road = roadSpot(world, place)
  const view = {
    id: `petition:${petition.key}`,
    agent: `#${petition.number}`,
    title: `#${petition.number}`,
    role: named ? "Petitioner" : "issue",
    subtitle: shorten(petition.title),
    glyph: "#",
    plural: named ? "Petitioners" : "issues",
    archetype: archetype.id,
    rank: "apprentice" as const,
    ordinal: 1,
    color,
    character: archetype.model,
    master: false,
    thinking: false,
    doing: shorten(petition.title, 60),
    stung: false,
    party: PETITION_PARTY,
    banner: color,
  }
  if (leaving) return { ...view, phase: "leaving", target: road }
  const walkIn = time - petition.since < WALK_IN_MS
  return {
    ...view,
    phase: "idle",
    target: queueSpot(world, place),
    ...(walkIn ? { enter: { kind: "gate" as const, at: road } } : {}),
  }
}
