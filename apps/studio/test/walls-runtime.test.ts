/**
 * Nobody is drawn through a wall at runtime either (decisions.md 10-14): the Studio's crowd (space.ts:
 * rounds apart, side-steps, queueing) over the townsfolk's whole day on three islands, with the notice
 * board's readers called over by a quest pinned every couple of hours (readers.ts), every frame's drawn
 * positions against the collision layer's buildings, walls and fences (walls-runtime.ts). A nudge never
 * leaves a body inside one its way is not in; a reader's way to the board and back keeps out. A
 * doorway's threshold aside. The plan's own ways: packages/sim walls.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { type Intrusion, installTiles, runtimeSweep } from "./walls-runtime.ts"

installTiles()

const show = (i: Intrusion) =>
  `${i.kind} ${i.who} ${i.depth.toFixed(2)} m ${i.piece ?? ""} at ${i.x.toFixed(1)},${i.z.toFixed(1)} h${i.hour.toFixed(2)}`

describe("nobody is drawn through a wall", () => {
  for (const seed of [1, 3, 6])
    test(`seed ${seed}: a day of the crowd and the board's readers, nobody inside a wall`, () => {
      const r = runtimeSweep({ seed, files: 4000 })
      expect([...new Set(r.intrusions.map(show))].slice(0, 10)).toEqual([])
      // (and the crowd did something: people pushed aside, readers at the board)
      expect(r.looked).toBeGreaterThan(1_000_000)
      expect(r.pushed).toBeGreaterThan(10_000)
      expect(r.readers).toBeGreaterThan(0)
    }, 180_000)
})
