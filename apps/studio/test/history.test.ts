import { describe, expect, test } from "bun:test"
import { hexIsland } from "@guildhall/world"
import { tilePlaces } from "../src/replay/places.ts"

/** Whether, with the tiles placed under `count` in, any land still out is cut off from the sea (a hole). */
function hasHole(h: ReturnType<typeof hexIsland>, place: Int32Array, count: number): boolean {
  const g = h.grid
  const N = g.size
  const seen = new Uint8Array(N)
  const queue: number[] = []
  // flood the outside from every sea tile over the land not yet in
  for (let i = 0; i < N; i++)
    if (place[i] === -1) {
      seen[i] = 1
      queue.push(i)
    }
  while (queue.length) {
    const i = queue.pop() as number
    for (const j of g.neighbours(i)) {
      if (j < 0 || seen[j]) continue
      if ((place[j] as number) >= count) {
        seen[j] = 1
        queue.push(j)
      }
    }
  }
  for (let i = 0; i < N; i++) if ((place[i] as number) >= count && !seen[i]) return true
  return false
}

describe("replay places", () => {
  for (const [seed, files] of [
    [1, 7252],
    [3, 1500],
    [7, 400],
  ] as const) {
    test(`seed ${seed}, ${files} files: places follow the rank, the sea stays out, no island of n tiles has a hole`, () => {
      const h = hexIsland({ seed, files })
      const { place, ranked } = tilePlaces(h)
      let filled = 0
      for (let i = 0; i < h.grid.size; i++) {
        const rk = h.rank[i] as number
        const p = place[i] as number
        if (rk >= 0) {
          expect(p).toBeGreaterThanOrEqual(0)
          // never later than its rank: filling a hole only brings a tile forward
          expect(p).toBeLessThanOrEqual(rk)
          if (p !== rk) filled++
        } else if (h.coast[i] === 0) expect(p).toBe(-1)
        else {
          // land without a rank (an inland sea filled in) is placed last, then brought forward as a hole
          expect(p).toBeGreaterThanOrEqual(0)
          expect(p).toBeLessThanOrEqual(ranked)
        }
      }
      // the ranks are dense: every rank under `ranked` is some tile's
      const ranks = new Set<number>()
      for (let i = 0; i < h.grid.size; i++) if ((h.rank[i] as number) >= 0) ranks.add(h.rank[i] as number)
      expect(ranks.size).toBe(ranked)
      for (const count of [1, 80, 200, 330, 560, 900, Math.floor(ranked / 2), ranked, ranked + 1])
        expect(hasHole(h, place, count)).toBe(false)
      // the filled holes are few (seed 1 at 7,252 files: 115 of 2,294): the order is still the growth order
      expect(filled).toBeLessThan(ranked * 0.1)
    })
  }
})
