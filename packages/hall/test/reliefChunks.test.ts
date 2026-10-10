import { describe, expect, test } from "bun:test"
import { chunksOf } from "../src/world/chunks.ts"
import { key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { reliefCells } from "../src/world/reliefChunks.ts"
import { repoWorld } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** world/reliefChunks.ts: the relief cut by the island's regions, and meshed per region and tier. */

const made = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const world = repoWorld(made, { repo: "fixture/react", source: "fixture", gen: 2 } as never)
const relief = world.relief
if (!relief) throw new Error("React at gen 2 has no relief")
const chunks = chunksOf(world)
const cut = reliefCells(relief, chunks)
const triangles = (cells: (typeof cut)[number], tier: 0 | 1 | 2): number =>
  reliefMesh(relief, cells, tier).position.length / 9
/** Faces that look up: the ground itself, not a skirt or a riser. */
const ground = (cells: (typeof cut)[number]): number => {
  const { normal } = reliefMesh(relief, cells, 0)
  let up = 0
  for (let v = 1; v < normal.length; v += 9) if ((normal[v] as number) > 0.01) up++
  return up
}

describe("the relief cut by regions", () => {
  test("every massif hex is in exactly one region", () => {
    const seen = new Map<string, number>()
    cut.forEach((cells, i) => {
      for (const cell of cells) {
        expect(seen.has(key(cell))).toBe(false)
        seen.set(key(cell), i)
      }
    })
    expect(seen.size).toBe(relief.keys.size)
    for (const id of relief.keys) expect(seen.has(id)).toBe(true)
  })

  test("a region's hexes are all massif hexes, and the cut is one list per region", () => {
    expect(cut.length).toBe(chunks.list.length)
    for (const cells of cut) for (const cell of cells) expect(relief.massifAt(cell)).toBeDefined()
  })

  test("the regions' ground joins up: the same up-facing faces as the massifs whole", () => {
    const whole = relief.massifs.reduce((sum, m) => sum + ground(m.cells), 0)
    expect(cut.reduce((sum, cells) => sum + ground(cells), 0)).toBe(whole)
  })
})

describe("a region's tiers", () => {
  test("never gain triangles going far, and the far tier is the cheaper in all", () => {
    let near = 0
    let far = 0
    for (const cells of cut) {
      if (cells.length === 0) continue
      const [t0, t1, t2] = [triangles(cells, 0), triangles(cells, 1), triangles(cells, 2)]
      expect(t1).toBeLessThanOrEqual(t0 * 1.05)
      expect(t2).toBeLessThan(t1)
      near += t0
      far += t2
    }
    // The stairs run to the summit, so the far tier keeps their risers: cheaper, not a fraction.
    expect(far).toBeLessThan(near * 0.6)
  })

  test("the far tier keeps the summit: its highest point is the near tier's", () => {
    const top = (cells: (typeof cut)[number], tier: 0 | 2): number => {
      const { position } = reliefMesh(relief, cells, tier)
      let high = Number.NEGATIVE_INFINITY
      for (let v = 1; v < position.length; v += 3) high = Math.max(high, position[v] as number)
      return high
    }
    const highest = cut.reduce((best, cells) => (top(cells, 0) > top(best, 0) ? cells : best))
    // The coarse copy may shave its peak, by how much depending on where the island's triangles fall: none
    // to 12% of the height over React's first six seeds. Not a flattened mountain.
    expect(top(highest, 2)).toBeGreaterThan(top(highest, 0) * 0.85)
  })
})
