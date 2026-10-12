import { describe, expect, test } from "bun:test"
import { chunksOf, SPLIT, split } from "../src/world/chunks.ts"
import { key, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld } from "../src/world/lands.ts"
import { handWorld, repoWorld, type World } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

/** world/chunks.ts: the island cut into regions for detail tiers (research world-gen-v2 §5.2, P0). */

const grown = (entries: RepoEntry[], gen: 1 | 2 = 1): World =>
  repoWorld(islandFromTree(entries, 0, gen), { repo: "fixture/x", source: "fixture" })
const WORLDS: Record<string, () => World> = {
  hand: () => handWorld(),
  "guildhall v1": () => grown(SELF.entries as RepoEntry[]),
  "react v2": () => grown(REACT.entries as RepoEntry[], 2),
}
const landOf = (world: World): string[] =>
  world.terrain.cells().filter((id) => world.terrain.at(unkey(id)) !== "~")

describe("the island's regions", () => {
  for (const [name, make] of Object.entries(WORLDS)) {
    test(`${name}: every land hex is in exactly one region, and the region it says`, () => {
      const world = make()
      const { list, at } = chunksOf(world)
      const seen = new Map<string, number>()
      list.forEach((chunk, i) => {
        for (const cell of chunk.cells) {
          expect({ name, id: key(cell), twice: seen.has(key(cell)) }).toEqual({
            name,
            id: key(cell),
            twice: false,
          })
          seen.set(key(cell), i)
        }
      })
      const land = landOf(world)
      expect(seen.size).toBe(land.length)
      for (const id of land) expect(at(...cellToWorld(unkey(id)))).toBe(seen.get(id) as number)
    })

    test(`${name}: regions hold at most about SPLIT hexes and bound their hexes`, () => {
      for (const chunk of chunksOf(make()).list) {
        expect(chunk.hexes).toBe(chunk.cells.length)
        expect(chunk.hexes).toBeLessThanOrEqual(SPLIT * 1.5)
        for (const cell of chunk.cells) {
          const [x, z] = cellToWorld(cell)
          expect(Math.hypot(x - chunk.centre[0], z - chunk.centre[1])).toBeLessThan(chunk.radius)
        }
      }
    })
  }

  test("a repo island's regions never straddle two districts", () => {
    const world = WORLDS["react v2"]?.() as World
    for (const chunk of chunksOf(world).list) {
      const districts = new Set(chunk.cells.map((cell) => world.terrain.district?.(cell)))
      expect(districts.size).toBe(1)
    }
  })

  test("React's island is cut into a few dozen regions; a small island into a handful", () => {
    expect(chunksOf(WORLDS["react v2"]?.() as World).list.length).toBeGreaterThan(15)
    expect(chunksOf(WORLDS["react v2"]?.() as World).list.length).toBeLessThan(40)
    expect(chunksOf(handWorld()).list.length).toBeLessThanOrEqual(6)
  })

  test("a point off the land (the sea's tiles) belongs to the region nearest it", () => {
    const { list, at } = chunksOf(handWorld())
    const far = at(500, 500)
    const nearest = list
      .map((chunk, i) => ({ i, d: Math.hypot(chunk.centre[0] - 500, chunk.centre[1] - 500) }))
      .sort((a, b) => a.d - b.d)[0]?.i
    expect(far).toBe(nearest as number)
  })

  test("the same world cuts the same way", () => {
    const strip = (world: World) => chunksOf(world).list.map((chunk) => chunk.cells.map(key).join(" "))
    expect(strip(grown(REACT.entries as RepoEntry[], 2))).toEqual(
      strip(grown(REACT.entries as RepoEntry[], 2)),
    )
  })

  test("a district of SPLIT hexes or fewer is one region; a bigger one is cut", () => {
    const line = (n: number) =>
      Array.from({ length: n }, (_, i) => [i, i % 2 === 0 ? 0 : 1] as [number, number])
    expect(split(line(SPLIT)).length).toBe(1)
    expect(split(line(SPLIT + 1)).length).toBe(2)
    expect(split([])).toEqual([])
  })
})
