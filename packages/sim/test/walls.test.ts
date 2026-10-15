/**
 * Nobody walks through a wall (decisions.md 10-14, user: "characters and townsfolk sometimes walk through
 * walls to take a shorter path, visible in the castle"; again: "do agents still walk through walls?"):
 * the walls sweep (walls-sweep.ts) over the islands the Studio opens, every townsperson's day and the
 * demo stories' heroes (and every place's hero spots from the gathering and back), sampled every 10 cm
 * against the collision layer's buildings, walls and fences. The graveyard too (decisions.md 10-14: a
 * Warden "walked out where there's no gate and then through walls"): its fence and arch are walls, its
 * graves are walked to by the gate, struck and left by the gate, from the gathering and every place.
 *
 * Zero, every source on every island: the walk graph's own edges (a quay's too), every walk's every bit
 * of way, every stop. A doorway's threshold aside (a walk's run out of its house, under a forge's porch),
 * and a shoulder's brush (`BRUSH`); what a walk's end stands in (its seat, the butts a spot is set
 * against) only as far as it takes to step off it (world `ownRoom`): a spot in a pocket is reached by its
 * real way in, or offered to nobody. The Studio's crowd at runtime: apps/studio walls-runtime.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { installTiles } from "./life-choreo-fixtures.ts"
import { type Cut, SOURCES, sweepIsland } from "./walls-sweep.ts"

installTiles()

const show = (c: Cut) =>
  `${c.source} ${c.who} ${c.depth.toFixed(2)} m ${c.piece ?? ""} at ${c.x.toFixed(1)},${c.z.toFixed(1)}`

describe("nobody walks through a wall", () => {
  for (const [files, seeds] of [
    [4000, [1, 2, 3, 4, 5, 6]],
    [12000, [1, 3, 6]],
  ] as const)
    for (const seed of seeds)
      test(`seed ${seed}, ${files} files: no bit of anyone's way and no stop cuts into a wall`, () => {
        const { table, cuts, struck } = sweepIsland({ seed, files })
        expect(cuts.map(show)).toEqual([])
        for (const s of SOURCES) expect([s, table[s].cuts]).toEqual([s, 0])
        // (and it looked at everything: the townsfolk's walks, the heroes', their stops)
        expect(table["detour (clearWay)"].seen + table["walk-graph edge"].seen).toBeGreaterThan(5000)
        expect(table["hero route"].seen).toBeGreaterThan(1000)
        expect(table["stay spot"].seen).toBeGreaterThan(500)
        // (the graveyard's: every grave walked to and from by its gate, and the stories' strikes there)
        expect(table["hero to a grave"].seen).toBeGreaterThan(1000)
        expect(table["hero from a grave"].seen).toBeGreaterThan(1000)
        expect(struck).toBeGreaterThan(0)
      }, 120_000)
})
