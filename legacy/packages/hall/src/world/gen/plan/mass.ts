import type { Cell } from "../../lands.ts"
import { key } from "../hex.ts"
import type { Archetype, Identity } from "../identity/types.ts"
import {
  coastalHearts,
  coastalStands,
  coastalWishes,
  disc,
  type Heart,
  inlandChoice,
  inlandHeart,
  zoneOf,
} from "./heart.ts"
import { bayOf, type Form, HUB, inBay, RESERVED } from "./keep.ts"
import { flood, LOOKS, lagoonOf, outline, reefOf } from "./shapes.ts"

/**
 * Generator v2's island outline (ADR 0020 §2): one landmass drawn before any district claims it,
 * so a big repo reads as one island with an organic coast instead of a ring of lobes on thin necks
 * round an inner sea (v1's districts grow freely, each as far out as its land pushes it).
 *
 * The outline is a level set (plan/shapes.ts), its look the island's archetype's (identity/archetype.ts):
 * the land floods out from the keep, lowest score first, until it holds the island's hexes. Flooding
 * keeps it one piece; the level set keeps it the shape it is. The centre sits a little north of the
 * keep, so the harbour's cove (narrower than v1's bay) reaches the open sea south of the hub without
 * the keep ending up on the shore. The island's heart (plan/heart.ts) is grown with the keep's ground:
 * an inland one's hexes are seeds of the flood, a coastal one is found on the finished coast.
 */

/** Half-angle of the harbour's cove south of the hub (v1's bay is 35°). */
const COVE = (24 * Math.PI) / 180
/** The rings of land round the hub that every island has. */
const APRON = 0

export const inCove = bayOf(COVE)

/** What the planner needs of the land's shape beyond the mass itself. */
export interface Massing {
  mass: Set<string>
  /** A reef's islets: land no road reaches (a subset of the mass). */
  reef: ReadonlySet<string>
  /** An atoll's lagoon: the sea inside its ring. */
  lagoon: ReadonlySet<string>
  /** The shape the land took: the archetype wished for, unless its room was not there (an atoll with no lagoon is a cone). */
  shape: Archetype
  heart?: Heart
}

const refuse = (cell: Cell): boolean => inCove(cell)

/** The land with `seeds` as its first hexes, in the look of `shape`. */
export function grow(
  size: number,
  seed: number,
  shape: Archetype,
  seeds: ReadonlySet<string>,
): Omit<Massing, "heart"> {
  const look = LOOKS[shape]
  if (shape === "atoll") {
    const found = lagoonOf(size, look, seed, seeds, (cell) => refuse(cell) || inBay(cell))
    if (found)
      return {
        mass: flood(size, seeds, found.score, refuse, found.lagoon),
        reef: new Set(),
        lagoon: found.lagoon,
        shape,
      }
    return grow(size, seed, "cone", seeds)
  }
  if (shape === "reef") {
    const { islets, moat, score } = reefOf(size, look, seed, seeds, refuse)
    return {
      mass: flood(size, new Set([...seeds, ...islets]), score, refuse, moat),
      reef: islets,
      lagoon: new Set(),
      shape,
    }
  }
  return {
    mass: flood(size, seeds, outline(size, seed, look), refuse),
    reef: new Set(),
    lagoon: new Set(),
    shape,
  }
}

/**
 * The island's land and its heart: the first wish the land carries and the coast allows, in order. A
 * coastal wish is looked for on the land grown without it; an inland one is grown in.
 */
export function massOf(size: number, seed: number, identity?: Identity): Massing {
  const shape = identity?.archetype ?? "cone"
  // The keep's ground, and the harbour's apron: the land round the hub, whatever shape the outline is (a narrow one has none there).
  const apron = disc(HUB, APRON).filter((cell) => !inCove(cell))
  const base = new Set<string>([key(HUB), ...RESERVED, ...apron.map(key)])
  const core = identity?.role === "core"
  let bare: Omit<Massing, "heart"> | undefined
  for (const id of identity?.wish ?? []) {
    const coastal = coastalWishes([id], size)[0]
    if (coastal) {
      bare ??= grow(size, seed, shape, base)
      // The land is grown round each place the heart may stand, the best first, until one stands.
      for (const heart of coastalHearts(coastal, bare.mass, seed)) {
        const made = grow(size, seed, shape, new Set([...base, ...heart.cells]))
        if (coastalStands(heart, made.mass)) return { ...made, heart }
      }
      continue
    }
    const choice = inlandChoice([id], size, core)
    if (!choice) continue
    const seeds = new Set([...base, ...zoneOf(choice.cell, choice.rings).map(key)])
    return {
      ...grow(size, seed, shape, seeds),
      heart: inlandHeart(choice.id, choice.cell, choice.rings, seed),
    }
  }
  if (!identity) return grow(size, seed, shape, base)
  const last = inlandChoice(["islet-fort"], size, core)
  const fort = last as NonNullable<typeof last>
  const seeds = new Set([...base, ...zoneOf(fort.cell, fort.rings).map(key)])
  return { ...grow(size, seed, shape, seeds), heart: inlandHeart(fort.id, fort.cell, fort.rings, seed) }
}

/** Generator v2's form: an outline of `size` hexes round the keep, the cove left open, and the heart's ground reserved. */
export function massForm(size: number, seed: number, identity?: Identity): Form {
  const { mass, reef, lagoon, shape, heart } = massOf(size, seed, identity)
  return {
    bay: inCove,
    mass,
    reserved: heart ? new Set([...RESERVED, ...heart.cells]) : RESERVED,
    reef,
    lagoon,
    shape,
    ...(heart ? { heart } : {}),
  }
}
