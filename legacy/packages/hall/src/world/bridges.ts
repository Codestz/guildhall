import { DMath } from "./dmath.ts"
import type { Spot } from "./layout.ts"
import type { Quay } from "./linkStub.ts"

/**
 * A stone bridge between two islands' quays: ramps up from each landing onto a level deck, arched
 * spans on piers between. This is its shape as data (scene/links/bridgeMesh.ts draws it) and the
 * walkable centreline agents will follow. Pure geometry, no three.
 */

/** The deck over the water, at least this high (world units; the sea lies at -0.95). */
export const DECK_Y = 3.6
/** The walkway's width: the walkable lane, on the axis. */
export const WALK_WIDTH = 4.6
/**
 * A lane kept clear beside the walkway (to its right, looking from the first landing to the second)
 * for a railway to run along later: the deck is laid and its bed drawn, nothing runs on it yet.
 */
export const RAIL_WIDTH = 3.2
/** The deck's edges across the axis, between the parapets: the walkway's left, the rail lane's right. */
export const DECK_EDGES = [-WALK_WIDTH / 2, WALK_WIDTH / 2 + RAIL_WIDTH] as const
/** A parapet's thickness; lantern posts stand on it. */
export const PARAPET = 0.75
/** A ramp, from a landing up to the level deck: this long. */
export const RAMP = 15
/** A span between piers is about this long (a bridge of 70 has three; a longer one more, with a tower). */
const SPAN = 13
/** The level deck stands at least this far above either landing's ground. */
const LAND_CLEAR = 2.2
/** The walkable centreline is sampled this often. */
const STEP = 2

/** A point on the deck: x, z and the height people walk at. */
export type DeckPoint = readonly [x: number, z: number, y: number]

export interface Bridge {
  /** The walkable centreline, from the first quay's landing to the second's. */
  path: readonly DeckPoint[]
  length: number
  /** Heading of the bridge's axis from the first landing to the second (radians, 0 = +z). */
  heading: number
  /** The level deck's height. */
  deck: number
  /** Distances along the axis where the level deck starts and ends (the ramps lie outside). */
  level: readonly [from: number, to: number]
  /** Distances along the axis of the piers: the two abutments first and last, the piers between. */
  piers: readonly number[]
  /** Distances along the axis of the towers flanking a long bridge's middle pier (none on a short one). */
  towers: readonly number[]
  /** Lantern posts: where they stand, on the parapets. */
  lamps: readonly DeckPoint[]
  /** Ground heights at the two landings. */
  ground: readonly [number, number]
}

const smooth = (u: number): number => {
  const c = Math.max(0, Math.min(1, u))
  return c * c * (3 - 2 * c)
}

/** The deck's height at distance `s` along the bridge: up from the landing's ground, then level. */
export function deckAt(bridge: Pick<Bridge, "deck" | "level" | "ground" | "length">, s: number): number {
  const [from, to] = bridge.level
  if (s < from) return bridge.ground[0] + (bridge.deck - bridge.ground[0]) * smooth(s / from)
  if (s > to) {
    const u = (bridge.length - s) / (bridge.length - to)
    return bridge.ground[1] + (bridge.deck - bridge.ground[1]) * smooth(u)
  }
  return bridge.deck
}

/** The bridge from quay `a` to quay `b`, landing on their dry points. */
export function bridgeOf(a: Quay, b: Quay): Bridge {
  const dx = b.land[0] - a.land[0]
  const dz = b.land[1] - a.land[1]
  const length = DMath.hypot(dx, dz)
  const ux = dx / length
  const uz = dz / length
  const deck = Math.max(DECK_Y, a.height + LAND_CLEAR, b.height + LAND_CLEAR)
  const ramp = Math.min(RAMP + Math.max(a.height, b.height) * 2, length / 3)
  const spans = Math.max(1, Math.round((length - 2 * ramp) / SPAN))
  const piers = Array.from({ length: spans + 1 }, (_, i) => ramp + ((length - 2 * ramp) * i) / spans)
  // A long bridge is given a tower at its middle pier.
  const towers = spans >= 4 ? [piers[Math.floor(spans / 2)] as number] : []
  const shape: Bridge = {
    path: [],
    length,
    heading: DMath.atan2(ux, uz),
    deck,
    level: [ramp, length - ramp],
    piers,
    towers,
    lamps: [],
    ground: [a.height - 0.5, b.height - 0.5],
  }
  const at = (s: number, side = 0): DeckPoint => [
    a.land[0] + ux * s + uz * side,
    a.land[1] + uz * s - ux * side,
    deckAt(shape, s),
  ]
  const count = Math.max(1, Math.round(length / STEP))
  const path = Array.from({ length: count + 1 }, (_, i) => at((i / count) * length))
  // A lantern post at each abutment, each side, on the parapet.
  const [left, right] = DECK_EDGES
  const lamps = [ramp, length - ramp].flatMap((s) => [at(s, left - PARAPET / 2), at(s, right + PARAPET / 2)])
  return { ...shape, path, lamps }
}

/** Where a bridge's centreline meets the first/last landing: its endpoints, for tests and agents. */
export const endsOf = (bridge: Bridge): readonly [Spot, Spot] => {
  const first = bridge.path[0] as DeckPoint
  const last = bridge.path[bridge.path.length - 1] as DeckPoint
  return [
    [first[0], first[1]],
    [last[0], last[1]],
  ]
}
