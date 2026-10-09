import { describe, expect, test } from "bun:test"
import { key, step, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { KEEP } from "../src/world/gen/plan.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { H_MAX, landOf } from "../src/world/gen/scale.ts"
import { contiguous } from "../src/world/gen/tiles.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import MINTROOT from "./fixtures/repos/codestz__mintroot.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"

/** Generator v2 (ADR 0020 §2): land ∝ √files, capped per island, never shrunk to fit. */

const FIXTURES: Record<string, RepoEntry[]> = {
  "is-odd": IS_ODD.entries as RepoEntry[],
  mcpx: MCPX.entries as RepoEntry[],
  mintroot: MINTROOT.entries as RepoEntry[],
  "claude-hindsight": HINDSIGHT.entries as RepoEntry[],
  guildhall: SELF.entries as RepoEntry[],
  "opencode-cockpit": COCKPIT.entries as RepoEntry[],
  react: REACT.entries as RepoEntry[],
}
const filesOf = (tree: readonly RepoEntry[]): number => tree.filter((entry) => entry.type === "blob").length
const v1 = Object.fromEntries(Object.entries(FIXTURES).map(([name, tree]) => [name, islandFromTree(tree)]))
const v2 = Object.fromEntries(
  Object.entries(FIXTURES).map(([name, tree]) => [name, islandFromTree(tree, 0, 2)]),
)
const landSize = (name: string, of: typeof v1): number => of[name]?.plan.land.size ?? 0

describe("island size, generator v2", () => {
  test("land hexes are 40 + 13·√files: ADR 0020's tiers", () => {
    expect(landOf(12)).toBe(85)
    expect(landOf(147)).toBe(198)
    expect(landOf(390)).toBe(297)
    expect(landOf(784)).toBe(404)
    expect(landOf(7252)).toBe(1147)
  })

  test("one island holds at most H_MAX land hexes", () => {
    expect(landOf(80_000)).toBe(H_MAX)
    expect(landOf(10_000)).toBeLessThan(H_MAX)
  })

  test("each fixture grows to within 8% of its land", () => {
    for (const [name, tree] of Object.entries(FIXTURES)) {
      const ratio = landSize(name, v2) / landOf(filesOf(tree))
      expect({ name, close: Math.abs(ratio - 1) <= 0.08 }).toEqual({ name, close: true })
    }
  })

  test("React grows from ~330 to ~1,150 land hexes", () => {
    expect(landSize("react", v1)).toBeLessThan(340)
    expect(landSize("react", v2)).toBeGreaterThan(1100)
    expect(landSize("react", v2)).toBeLessThan(1200)
  })

  test("village repos are given 15–25% more land than v1 drew", () => {
    for (const name of ["mcpx", "guildhall"]) {
      const growth = landOf(filesOf(FIXTURES[name] ?? [])) / landSize(name, v1) - 1
      expect({ name, growth: growth >= 0.15 && growth <= 0.25 }).toEqual({ name, growth: true })
    }
  })

  test("no island is smaller than v1 drew it", () => {
    for (const name of Object.keys(FIXTURES))
      expect({ name, bigger: landSize(name, v2) >= landSize(name, v1) }).toEqual({ name, bigger: true })
  })

  test("a big island is not shrunk to fit the one shore bake", () => {
    const react = v2.react?.plan
    const reach = Math.max(...[...(react?.land.keys() ?? [])].map((id) => Math.abs(unkey(id)[0]) * 8.66))
    expect(reach).toBeGreaterThan(120)
  })

  test("v2 islands keep v1's rules: the keep at the origin, a coast the tiles draw, one road network", () => {
    for (const [name, made] of Object.entries(v2)) {
      const land = made.plan.land
      for (const [id, char] of KEEP)
        expect({ name, id, char: land.get(id)?.char }).toEqual({ name, id, char })
      for (const [id, hex] of land) {
        if (hex.char === "=") continue
        const wet = [0, 1, 2, 3, 4, 5].filter((dir) => !land.has(key(step(unkey(id), dir))))
        const drawable = wet.length === 0 || (wet.length <= 4 && contiguous(wet) !== undefined)
        expect({ name, id, drawable }).toEqual({ name, id, drawable: true })
      }
      const reached = new Set(["HARBOUR"])
      for (let grew = true; grew; ) {
        grew = false
        for (const [a, b] of made.roads.edges)
          if (reached.has(a) !== reached.has(b)) {
            reached.add(a)
            reached.add(b)
            grew = true
          }
      }
      for (const district of made.districts)
        expect({ name, node: reached.has(district.node) }).toEqual({ name, node: true })
    }
  })

  test("deterministic, and islandFromTree's own default stays v1 (the link-level default is genOf's)", () => {
    const tree = FIXTURES.guildhall ?? []
    expect(islandFromTree([...tree].reverse(), 0, 2)).toEqual(islandFromTree(tree, 0, 2))
    expect(islandFromTree(tree)).toEqual(islandFromTree(tree, 0, 1))
    expect(islandFromTree(tree, 0, 2).plan.land.size).not.toBe(islandFromTree(tree).plan.land.size)
  })
})

/** The hexes of `set` joined to `start` through neighbours in it. */
function reachable(set: ReadonlySet<string>, start: string): Set<string> {
  const seen = new Set([start])
  const todo = [start]
  for (let id = todo.pop(); id !== undefined; id = todo.pop())
    for (let dir = 0; dir < 6; dir++) {
      const next = key(step(unkey(id), dir))
      if (set.has(next) && !seen.has(next)) {
        seen.add(next)
        todo.push(next)
      }
    }
  return seen
}

/** A plan's land along x and z, world units (hex centres). */
function spanOf(land: ReadonlyMap<string, unknown>): { xs: number[]; zs: number[] } {
  const cells = [...land.keys()].map(unkey)
  return { xs: cells.map(([q]) => q * 8.66), zs: cells.map(([, line]) => line * 5) }
}

describe("island shape, generator v2: one landmass (plan/mass.ts)", () => {
  test("the land is one piece, and so is every district", () => {
    for (const [name, made] of Object.entries(v2)) {
      const land = new Set(made.plan.land.keys())
      expect({ name, whole: reachable(land, "0,0").size === land.size }).toEqual({ name, whole: true })
      made.plan.districts.forEach((district, i) => {
        const own = new Set([...made.plan.land].filter(([, hex]) => hex.district === i).map(([id]) => id))
        const first = own.values().next().value
        if (first === undefined) return
        const piece = reachable(own, first).size === own.size
        const folder = district.folder.name
        expect({ name, folder, piece }).toEqual({ name, folder, piece: true })
      })
    }
  })

  test("round, not lobed: little coast for its land, about 1.4 times as wide as it is deep", () => {
    for (const [name, made] of Object.entries(v2)) {
      const land = made.plan.land
      const coast = [...land.keys()].filter((id) =>
        [0, 1, 2, 3, 4, 5].some((dir) => !land.has(key(step(unkey(id), dir)))),
      ).length
      // A disc has 2√π ≈ 3.5 coast hexes per √hex; React's lobes on necks ran to 6.5.
      expect({ name, round: coast / Math.sqrt(land.size) < 4.8 }).toEqual({ name, round: true })
      const { xs, zs } = spanOf(land)
      const aspect = (Math.max(...xs) - Math.min(...xs) + 10) / (Math.max(...zs) - Math.min(...zs) + 10)
      expect({ name, aspect: aspect > 1.15 && aspect < 1.75 }).toEqual({ name, aspect: true })
    }
  })

  test("the keep stands in the middle half of the land, each way, not out on a shore", () => {
    const share = (values: number[]) => -Math.min(...values) / (Math.max(...values) - Math.min(...values))
    for (const [name, made] of Object.entries(v2)) {
      const { xs, zs } = spanOf(made.plan.land)
      expect({ name, x: Math.abs(share(xs) - 0.5) < 0.25 }).toEqual({ name, x: true })
      expect({ name, z: Math.abs(share(zs) - 0.5) < 0.25 }).toEqual({ name, z: true })
    }
  })

  test("React's island stays within ±250 across (its lobes reached 274)", () => {
    const { xs } = spanOf(v2.react?.plan.land ?? new Map())
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(250)
  })
})
