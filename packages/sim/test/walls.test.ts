/**
 * Nobody walks through a wall (decisions.md 10-14, user: "characters and townsfolk sometimes walk through
 * walls to take a shorter path, visible in the castle"): the walls sweep (walls-sweep.ts) over the
 * islands the Studio opens, every townsperson's day and the saga's heroes (and every place's hero spots
 * from the gathering and back), sampled every 10 cm against the collision layer's buildings, walls and
 * fences, a door's threshold and a shoulder's brush (`BRUSH`) aside.
 *
 *   castle     nothing cuts into a wall, a tower, the keep or a court's building inside the castle;
 *   heroes     no hero stands in a wall, and their ways keep out (a body's brush at a well aside);
 *   the rest   no stop (a chat, a slump, a tipsy weave, a routine's step down a row, a petitioner, a
 *              reader at the board) stands in one; what is left are walks to spots in pockets the tiles
 *              leave (an archer behind the butts, a seat behind a tavern), kept under a budget that only
 *              goes down.
 */
import { describe, expect, test } from "bun:test"
import { installTiles } from "./life-choreo-fixtures.ts"
import { type Cut, type Source, sweepIsland } from "./walls-sweep.ts"

installTiles()

/** Sources that must stay at 0 cut segments everywhere. */
const NONE: readonly Source[] = [
  "carry trip",
  "tipsy weave",
  "chat/wave stop",
  "routine shift",
  "stay spot",
  "petitioner lane",
  "board reader spot",
  "hero direct",
  "hero stay",
]
/** Walked segments still cutting in (spots in the tiles' pockets), at most, per island. */
const BUDGET = 30
/** A hero's way may brush this deep into a wall's foot (a well's rim on a crowded square), metres. */
const HERO_BRUSH = 0.4

const show = (c: Cut) =>
  `${c.source} ${c.who} ${c.depth.toFixed(2)} m ${c.piece ?? ""} at ${c.x.toFixed(1)},${c.z.toFixed(1)}`

describe("nobody walks through a wall", () => {
  for (const [files, seeds] of [
    [4000, [1, 2, 3, 4, 5, 6]],
    [12000, [1, 3, 6]],
  ] as const)
    for (const seed of seeds)
      test(`seed ${seed}, ${files} files: the castle clean, no stop in a wall, the rest under budget`, () => {
        const { table, cuts } = sweepIsland({ seed, files })
        const walked = cuts.filter((c) => !c.source.startsWith("raw"))
        expect(walked.filter((c) => c.castle).map(show)).toEqual([])
        for (const s of NONE) expect([s, table[s].cuts]).toEqual([s, 0])
        expect(walked.filter((c) => c.source.startsWith("hero") && c.depth > HERO_BRUSH).map(show)).toEqual(
          [],
        )
        expect(walked.length).toBeLessThanOrEqual(BUDGET)
        // (and it looked at everything: the townsfolk's walks, the heroes', their stops)
        expect(table["detour (clearWay)"].seen + table["walk-graph edge"].seen).toBeGreaterThan(5000)
        expect(table["hero route"].seen).toBeGreaterThan(1000)
      }, 120_000)
})
