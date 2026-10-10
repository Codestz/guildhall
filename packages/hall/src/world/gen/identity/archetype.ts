import { hash } from "../hex.ts"
import type { Archetype, IslandHint } from "./types.ts"

/**
 * The shape an island's land takes (plan/shapes.ts), chosen from what its tree and its place in the
 * archipelago say, never from chance alone: each shape scores the island's traits, a seeded wobble
 * breaks ties, and the best allowed one wins. Pure and deterministic.
 *
 *   atoll     low and spread out, little bound to others (its land is a ring round a lagoon: it needs 180 hexes)
 *   ridge     deep trees, many folders down: a long spine of mountain (130 to 700 hexes: a longer ridge would stretch past the shore's bake)
 *   cone      what the others lean on, or the old: one massif at the middle (130 hexes)
 *   plateau   broad and flat in its folders, or big: a squarer island, its main range a mesa (200 hexes)
 *   reef      the smallest, and the unbound: a body and islets off it (any size; the only one under 130)
 */

/** What an island's choice reads: its land (hexes), the files' mean depth, how bound it is, its years. */
export interface Traits {
  land: number
  /** Mean depth of its files from its root. */
  depth: number
  weight: number
  years: number
  core: boolean
}

/** Land an archetype needs (it has room for its shape, and for its mountain where it has one). */
const MIN: Readonly<Record<Archetype, number>> = { reef: 0, atoll: 180, ridge: 130, cone: 130, plateau: 200 }
/** …and the most (a ring or a reef of a big island is a ring of lobes: those are for the small and the middling). */
const MAX: Readonly<Record<Archetype, number>> = {
  reef: 260,
  atoll: 450,
  ridge: 700,
  cone: Number.POSITIVE_INFINITY,
  plateau: Number.POSITIVE_INFINITY,
}

const clamp = (value: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, value))

/** How well each shape suits the traits (higher wins); the ones the land cannot hold are left out. */
function scoresOf(t: Traits): [Archetype, number][] {
  const age = clamp(t.years / 20)
  const bound = clamp(t.weight / 2)
  const out: [Archetype, number][] = [
    ["reef", 0.1 + (t.land < 130 ? 1.6 : 0) + 0.4 * (1 - bound)],
    ["atoll", 0.3 + 0.5 * (1 - bound) + (t.land < 300 ? 0.25 : -0.7) + (t.depth < 1.3 ? 0.3 : 0)],
    ["ridge", 0.35 + 0.4 * clamp(t.depth - 1.5, 0, 3) + (t.core ? -0.3 : 0)],
    ["cone", 0.1 + 1.1 * bound + (t.core ? 1.1 : 0) + 0.6 * age],
    ["plateau", 0.2 + (t.land >= 250 ? 0.6 : -0.3) + (t.depth <= 2 ? 0.3 : 0) + 0.5 * age],
  ]
  return out.filter(([shape]) => t.land >= MIN[shape] && t.land <= MAX[shape])
}

/** The shape of an island with these traits; `seed` wobbles the scores so two alike do not always match. */
export function archetypeOf(t: Traits, seed: number): Archetype {
  let best: Archetype = "reef"
  let top = Number.NEGATIVE_INFINITY
  for (const [shape, score] of scoresOf(t)) {
    const wobbled = score + 0.9 * (hash(`${seed}:${shape}`) / 4294967296)
    if (wobbled > top) {
      top = wobbled
      best = shape
    }
  }
  return best
}

/** The traits of an island from its tree's shape and its hint. */
export function traitsOf(land: number, depth: number, hint: IslandHint | undefined): Traits {
  return {
    land,
    depth,
    weight: hint?.weight ?? 0,
    years: hint?.years ?? 0,
    core: !hint || hint.core === true,
  }
}
