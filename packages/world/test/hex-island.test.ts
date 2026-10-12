import { describe, expect, test } from "bun:test"
import { hexGrid, hexIsland, kindOf, landTiles } from "../src/hex/index.ts"

const isLand = (h: ReturnType<typeof hexIsland>, i: number) => !["sea", "shallows"].includes(kindOf(h, i))

describe("hex grid", () => {
  test("a map of r rings holds 3r(r+1)+1 tiles, each with six neighbours inside", () => {
    const g = hexGrid(5)
    expect(g.size).toBe(91)
    const centre = g.index(0, 0)
    expect([...g.neighbours(centre)].every((j) => j >= 0 && g.ring(j) === 1)).toBe(true)
  })
})

describe("hex island", () => {
  test("same seed, same island", () => {
    const a = hexIsland({ seed: 4 })
    const b = hexIsland({ seed: 4 })
    expect([...a.kind]).toEqual([...b.kind])
    expect([...a.level]).toEqual([...b.level])
  })

  test("size follows the repo: 2 × (40 + 13·√files), capped", () => {
    expect(landTiles(0)).toBe(80)
    expect(landTiles(10000)).toBe(2680)
    expect(landTiles(1e6)).toBe(2800)
  })

  test("every island has a lake of several tiles, and a bigger island keeps it", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const mid = hexIsland({ seed, files: 1500 })
      const big = hexIsland({ seed, files: 8000 })
      const lake = (h: typeof mid) => [...h.kind.keys()].filter((i) => kindOf(h, i) === "lake")
      expect(lake(mid).length).toBeGreaterThanOrEqual(5)
      const kept = new Set(lake(big))
      // the nature lake (most of mid's lake tiles) is lake in the bigger island too
      expect(lake(mid).filter((i) => kept.has(i)).length).toBeGreaterThanOrEqual(5)
    }
  })

  test("stable growth: every land tile of a smaller island is land in a bigger one", () => {
    for (const seed of [1, 2, 3]) {
      const small = hexIsland({ seed, files: 600 })
      const big = hexIsland({ seed, files: 6000 })
      let kept = 0
      let was = 0
      for (let i = 0; i < small.grid.size; i++)
        if (isLand(small, i)) {
          was++
          if (isLand(big, i)) kept++
        }
      expect(kept).toBe(was)
    }
  })
})
