import { describe, expect, test } from "bun:test"
import { FERRIES, type FerryAt, ferryAt, PERIOD_S } from "../src/scene/archipelago/ferries.ts"
import { flightSize, frameOf, HOME, mapFrame } from "../src/scene/archipelago/view.ts"
import { patchSquares, seaSquares } from "../src/scene/nature/shore.ts"
import {
  crossingsOf,
  DEFAULT_ARCHIPELAGO,
  extentOf,
  HOME_HALF,
  mainLanguage,
  OFFING,
  PATCH_HALF,
  placeIslands,
  portOf,
  SEA_CELL,
  type Shore,
} from "../src/world/archipelago.ts"
import { islandIndexOf, parseArchipelagoLink } from "../src/world/archipelagoLink.ts"
import type { Archipelago } from "../src/world/archipelagoSource.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { reachOf, repoWorld } from "../src/world/world.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import MINTROOT from "./fixtures/repos/codestz__mintroot.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"

const cheb = (a: readonly number[], b: readonly number[]) =>
  Math.max(Math.abs((a[0] ?? 0) - (b[0] ?? 0)), Math.abs((a[1] ?? 0) - (b[1] ?? 0)))
const seeds = (n: number) => Array.from({ length: n }, (_, i) => ({ repo: `owner/repo-${i}` }))
const FIXTURES = [HINDSIGHT, MCPX, COCKPIT, MINTROOT] as { repo: string; entries: RepoEntry[] }[]

describe("placeIslands", () => {
  for (const n of [1, 4, 6])
    test(`${n} islands: patches clear the home shore and each other, on the sea grid`, () => {
      const placed = placeIslands(seeds(n))
      expect(placed).toHaveLength(n)
      for (const [i, at] of placed.entries()) {
        expect(cheb(at, [0, 0])).toBeGreaterThanOrEqual(PATCH_HALF + HOME_HALF)
        expect(Math.abs(at[0] % SEA_CELL)).toBe(0)
        expect(Math.abs(at[1] % SEA_CELL)).toBe(0)
        for (const other of placed.slice(i + 1))
          expect(cheb(at, other)).toBeGreaterThanOrEqual(2 * PATCH_HALF)
      }
    })

  test("the same repos land in the same places", () => {
    const repos = DEFAULT_ARCHIPELAGO.map((repo) => ({ repo }))
    expect(placeIslands(repos)).toEqual(placeIslands(repos))
  })
})

describe("the default archipelago's fixtures", () => {
  test("every island grows and fits inside its shore patch", () => {
    for (const fixture of FIXTURES) {
      const world = repoWorld(islandFromTree(fixture.entries), { repo: fixture.repo, source: "fixture" })
      expect(reachOf(world)).toBeLessThan(PATCH_HALF - 5)
    }
  })

  test("each island's main language is its repo's", () => {
    expect(FIXTURES.map((fixture) => mainLanguage(fixture.entries).name)).toEqual([
      "Rust",
      "Go",
      "TypeScript",
      "Kotlin",
    ])
  })
})

describe("crossings", () => {
  const ring = placeIslands(seeds(4))
  const islands: Shore[] = [{ at: [0, 0], reach: 82 }, ...ring.map((at) => ({ at, reach: 118 }))]

  test("no crossing passes over a third island", () => {
    const crossings = crossingsOf(islands)
    expect(crossings.length).toBeGreaterThan(0)
    // Opposite islands of the ring would sail over the home island: never a crossing.
    for (const [i, j] of crossings) expect(i === 1 && j === 3).toBe(false)
  })

  test("a port lies off its island's coast, facing the other island", () => {
    const a = islands[0] as Shore
    const b = islands[1] as Shore
    const [x, z] = portOf(a, b)
    expect(Math.hypot(x, z)).toBeCloseTo(a.reach + OFFING, 5)
    expect(Math.hypot(x - b.at[0], z - b.at[1])).toBeLessThan(Math.hypot(b.at[0], b.at[1]))
  })

  test("the extent reaches the furthest land", () => {
    const furthest = Math.max(...ring.map((at) => Math.hypot(at[0], at[1])))
    expect(extentOf(islands)).toBeCloseTo(furthest + 118, 5)
  })
})

describe("ferries", () => {
  const ring = placeIslands(seeds(4))
  const islands: Shore[] = [{ at: [0, 0], reach: 82 }, ...ring.map((at) => ({ at, reach: 110 }))]
  const crossings = crossingsOf(islands)
  const at = (): FerryAt => ({ x: 0, z: 0, heading: 0, shown: 0 })

  test("the same story time puts every ferry in the same place", () => {
    for (let ferry = 0; ferry < FERRIES; ferry++) {
      const a = at()
      const b = at()
      expect(ferryAt(islands, crossings, ferry, 1234.5, a)).toBe(
        ferryAt(islands, crossings, ferry, 1234.5, b),
      )
      expect(a).toEqual(b)
    }
  })

  test("now and then at sea, and never over land", () => {
    let sailing = 0
    let samples = 0
    for (let t = 0; t < PERIOD_S * 40; t += 3)
      for (let ferry = 0; ferry < FERRIES; ferry++) {
        samples++
        const where = at()
        if (!ferryAt(islands, crossings, ferry, t, where)) continue
        sailing++
        for (const island of islands)
          expect(Math.hypot(where.x - island.at[0], where.z - island.at[1])).toBeGreaterThan(island.reach + 8)
      }
    expect(sailing / samples).toBeGreaterThan(0.05)
    expect(sailing / samples).toBeLessThan(0.9)
  })

  test("no crossings, no ferries", () => {
    expect(ferryAt(islands, [], 0, 100, at())).toBe(false)
  })
})

describe("the archipelago's sea", () => {
  test("a patch fills its hole in the sea exactly", () => {
    const hole: [number, number] = [300, -40]
    const sea = seaSquares(600, [{ at: hole, half: PATCH_HALF }], SEA_CELL)
    const inside = (x: number, z: number) =>
      Math.abs(x - hole[0]) < PATCH_HALF && Math.abs(z - hole[1]) < PATCH_HALF
    // Every sea triangle's centre is outside the hole…
    for (let i = 0; i < sea.length; i += 3) {
      const x = ((sea[i]?.[0] ?? 0) + (sea[i + 1]?.[0] ?? 0) + (sea[i + 2]?.[0] ?? 0)) / 3
      const z = ((sea[i]?.[1] ?? 0) + (sea[i + 1]?.[1] ?? 0) + (sea[i + 2]?.[1] ?? 0)) / 3
      expect(inside(x, z)).toBe(false)
    }
    // …and the patch, moved there, covers exactly the hole: (2·half / cell)² squares.
    const patch = patchSquares(PATCH_HALF, SEA_CELL)
    expect(patch.length).toBe(((2 * PATCH_HALF) / SEA_CELL) ** 2 * 6)
    for (const [x, z] of patch) expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThanOrEqual(PATCH_HALF)
  })
})

describe("archipelago links", () => {
  test("`archipelago` is the default list", () => {
    expect(parseArchipelagoLink("?archipelago")?.repos).toEqual([...DEFAULT_ARCHIPELAGO])
    expect(parseArchipelagoLink("?archipelago=0")).toBeNull()
    expect(parseArchipelagoLink("?story=saga")).toBeNull()
  })

  test("`repos=` reads, dedupes, skips the home repo and caps at six", () => {
    const link = parseArchipelagoLink(
      "?repos=a/b,https://github.com/c/d,A/B,Codestz/guildhall,not a repo,e/f,g/h,i/j,k/l,m/n,o/p",
    )
    expect(link?.repos).toEqual(["a/b", "c/d", "e/f", "g/h", "i/j", "k/l"])
    expect(link?.ignored.some((reason) => reason.includes("not a repo"))).toBe(true)
    expect(link?.ignored.some((reason) => reason.includes("m/n"))).toBe(true)
  })

  test("`island=` resolves by name or repo, home or map", () => {
    const repos = ["Codestz/claude-hindsight", "Codestz/mcpx"]
    expect(islandIndexOf("mcpx", repos)).toBe(1)
    expect(islandIndexOf("Codestz/Claude-Hindsight", repos)).toBe(0)
    expect(islandIndexOf("home", repos)).toBe(-1)
    expect(islandIndexOf("guildhall", repos)).toBe(-1)
    expect(islandIndexOf("map", repos)).toBe("map")
    expect(islandIndexOf("nowhere", repos)).toBeUndefined()
    expect(parseArchipelagoLink("?archipelago&island=mcpx")?.island).toBe("mcpx")
  })
})

describe("the map and flights", () => {
  const archipelago = {
    home: { repo: "h/h", name: "h", at: [0, 0], reach: 80 },
    islands: [
      { repo: "a/a", name: "a", at: [300, 0], reach: 100 },
      { repo: "b/b", name: "b", at: [-300, 40], reach: 110 },
    ],
  } as unknown as Archipelago

  test("the map holds every island's land", () => {
    const frame = mapFrame(archipelago)
    for (const { at, reach } of [archipelago.home, ...archipelago.islands]) {
      expect(Math.abs(at[0] - frame.x) + reach).toBeLessThanOrEqual(frame.radius)
      expect(Math.abs(at[1] - frame.z) + reach).toBeLessThanOrEqual(frame.radius)
    }
  })

  test("an island's frame is its keep and reach", () => {
    expect(frameOf(1, archipelago)).toEqual({ x: -300, z: 40, radius: 110 })
    expect(frameOf(HOME, archipelago)).toEqual({ x: 0, z: 0, radius: 80 })
  })

  test("a flight starts and lands on its sizes and pulls out between", () => {
    expect(flightSize(10, 2, 0, 0.4, true)).toBeCloseTo(10, 6)
    expect(flightSize(10, 2, 1, 0.4, true)).toBeCloseTo(2, 6)
    expect(flightSize(10, 10, 0.5, 0.4, true)).toBeCloseTo(6, 6)
    // Perspective: a pull-out is a longer distance.
    expect(flightSize(100, 100, 0.5, 0.4, false)).toBeGreaterThan(100)
  })
})
