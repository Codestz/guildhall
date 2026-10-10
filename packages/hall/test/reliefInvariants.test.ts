import { describe, expect, test } from "bun:test"
import { key, neighbours, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { CLEAR } from "../src/world/gen/plan/zones.ts"
import { CAP, reliefOf } from "../src/world/gen/relief/index.ts"
import { LEDGE_STEP } from "../src/world/gen/relief/shape.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld } from "../src/world/lands.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

/** The ranges are planned before anything is built, and the field agrees with itself, on every fixture and several seeds. */

const SEEDS = [0, 1, 2, 3]
const FIXTURES = { city: REACT, town: COCKPIT, village: SELF } as const
/** The land share each tier's ranges aim for (terrain v2 §2.1), a little below it for what the roads take back. */
const SHARE = { city: [0.2, 0.3], town: [0.14, 0.22], village: [0.09, 0.15] } as const

const cases = Object.entries(FIXTURES).flatMap(([name, fixture]) =>
  SEEDS.map((seed) => {
    const island = islandFromTree(fixture.entries as RepoEntry[], seed, 2)
    const relief = reliefOf({ plan: island.plan, level: (cell) => island.levels.get(key(cell)) ?? 0 })
    return { name: name as keyof typeof FIXTURES, seed, island, relief }
  }),
)

describe("the plan reserves mountain ground (gen 2)", () => {
  test("a v1 plan has no ranges", () => {
    expect(islandFromTree(REACH_ENTRIES()).plan.ranges).toEqual([])
  })

  test("the massifs hold their tier's share of the land", () => {
    for (const { name, island, relief } of cases) {
      const share = relief.keys.size / island.plan.land.size
      expect(share).toBeGreaterThanOrEqual(SHARE[name][0])
      expect(share).toBeLessThanOrEqual(SHARE[name][1])
    }
  })

  test("ranges stand clear of the keep, inland, and off roads, lots, sites and fields", () => {
    for (const { island, relief } of cases)
      for (const id of relief.keys) {
        expect("=KVvswd").not.toContain(island.plan.land.get(id)?.char ?? "=")
        const [x, z] = cellToWorld(unkey(id))
        expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(CLEAR - 1e-6)
      }
  })

  test("ranges are not pushed to the coast: the main range stands inland of the shore", () => {
    for (const { island, relief } of cases) {
      const main = relief.massifs[0]
      const inland = main?.cells.filter((cell) =>
        neighbours(cell).every((next) => island.plan.land.has(key(next))),
      )
      expect(inland?.length ?? 0).toBeGreaterThan((main?.cells.length ?? 0) * 0.6)
    }
  })

  test("the main range crosses the island's interior: it is not all on one side of the keep", () => {
    for (const { relief } of cases.filter((c) => c.name === "city")) {
      const spread = relief.massifs[0]?.cells.map((cell) => cellToWorld(cell)) ?? []
      const xs = spread.map(([x]) => x)
      const zs = spread.map(([, z]) => z)
      expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))).toBeGreaterThan(
        60,
      )
    }
  })
})

describe("the field agrees with itself", () => {
  test("a massif's stated height is its tallest ground, and its first peak stands there", () => {
    for (const { relief } of cases)
      for (const massif of relief.massifs) {
        const peak = massif.peaks[0]
        expect(peak?.height).toBeCloseTo(massif.height, 4)
        expect(relief.heightAt(peak?.at[0] ?? 0, peak?.at[1] ?? 0)).toBeCloseTo(massif.height, 3)
        expect(Math.max(...massif.grid.data.filter((h) => !Number.isNaN(h)))).toBeCloseTo(massif.height, 4)
      }
  })

  test("every peak's stated height is the ground's, and peaks are listed tallest first", () => {
    for (const { relief } of cases)
      for (const massif of relief.massifs) {
        massif.peaks.forEach((peak, i) => {
          expect(relief.heightAt(peak.at[0], peak.at[1])).toBeCloseTo(peak.height, 3)
          if (i > 0) expect(peak.height).toBeLessThanOrEqual(massif.peaks[i - 1]?.height ?? 0)
        })
      }
  })

  test("every saddle's stated height is the ground's, strictly below both peaks it joins", () => {
    for (const { relief } of cases)
      for (const massif of relief.massifs)
        for (const saddle of massif.saddles) {
          const [a, b] = saddle.between
          expect(relief.heightAt(saddle.at[0], saddle.at[1])).toBeCloseTo(saddle.height, 3)
          expect(saddle.height).toBeLessThan(
            Math.min(massif.peaks[a]?.height ?? 0, massif.peaks[b]?.height ?? 0),
          )
        }
  })

  test("a City's main range is a real mountain, a second range stands lower, none passes its cap", () => {
    for (const { name, relief } of cases) {
      expect(relief.massifs[0]?.height).toBeLessThanOrEqual(CAP[relief.tier] + 1.3)
      if (name === "city") expect(relief.massifs[0]?.height).toBeGreaterThanOrEqual(7 * LEDGE_STEP)
    }
  })
})

function REACH_ENTRIES(): RepoEntry[] {
  return REACT.entries as RepoEntry[]
}
