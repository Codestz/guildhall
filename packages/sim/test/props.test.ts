/**
 * Nobody walks through a prop (the props sweep, walls-sweep.ts `mode: "props"`): every townsperson's day
 * and the demo stories' heroes (and every place's hero spots from the gathering and back), sampled every
 * 10 cm, against the props as their outlines are drawn (a cart, a crate, a stall's table, a bench, a
 * barrel, a lamp's post, a tree's trunk): a walker's body (PROP_BODY) more than a brush into one, what its
 * walk's ends stand at aside (the bench it gets up from, the cart it works at), and nobody standing with
 * their middle in one (a seat sat on aside).
 *
 * Before the blockers took their pieces' real shapes and the walks a body's room off the props (the walk
 * planner's last pass, walk.ts `clearWay`), these six islands had 3,378 such bits of way (568 after); the
 * target is none.
 * What is left is held under a budget per island, so it only goes down: mostly where the layout itself has
 * no room for a body (a beer garden's packed stools, a smithy's shed whose eaves hang at chest height, the
 * hay round a farmstead's yard), which a walk can only squeeze past.
 */
import { describe, expect, test } from "bun:test"
import { installTiles } from "./life-choreo-fixtures.ts"
import { type Cut, SOURCES, sweepIsland } from "./walls-sweep.ts"

installTiles()

const show = (c: Cut) =>
  `${c.source} ${c.who} ${c.depth.toFixed(2)} m ${c.piece ?? ""} at ${c.x.toFixed(1)},${c.z.toFixed(1)}`

/** The most cuts each island may have (today's, and a little room for a reshuffle), by seed at 4,000 files. */
const BUDGET: Record<number, number> = { 1: 110, 2: 110, 3: 100, 4: 140, 5: 110, 6: 130 }

describe("nobody walks through a prop", () => {
  for (const seed of [1, 2, 3, 4, 5, 6])
    test(`seed ${seed}, 4000 files: the bits of way into a prop stay under the island's budget`, () => {
      const { table, cuts } = sweepIsland({ seed, files: 4000 }, { mode: "props" })
      const n = SOURCES.reduce((m, s) => m + table[s].cuts, 0)
      if (n > BUDGET[seed]!)
        expect(
          cuts
            .sort((a, b) => b.depth - a.depth)
            .slice(0, 12)
            .map(show),
        ).toEqual([])
      expect(n).toBeLessThanOrEqual(BUDGET[seed]!)
      // nobody stands in a prop (a merchant in his stall's table, a guard's post in a cart)
      expect(table["stay spot"].cuts + table["hero stay"].cuts + table["routine shift"].cuts).toBe(0)
      // (and it looked at everything)
      expect(table["detour (clearWay)"].seen + table["walk-graph edge"].seen).toBeGreaterThan(5000)
    }, 120_000)
})
