/**
 * Walks from the Guildhall are no longer than the land makes them (zones.ts shortcuts, sites.ts postern):
 * on the walk graph, from the castle's heart to every place's heart, the walk over the straight line.
 * Before the shortcuts (seeds 1–12, 4,000 and 12,000 files) the median was 2.1× and one in ten went
 * over 4.3× (the Guildhall's island: zone 4 166 m by road, 42 m straight); held at a median of 1.6× and
 * a ninetieth percentile of 2.2×.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  guildhallZone,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  parseTilePrefabs,
  useOf,
  workTiles,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

/** The walk over the straight line from the Guildhall's heart to every other place's heart. */
function detours(seed: number, files: number): number[] {
  const h = hexIsland({ seed, files })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const home = guildhallZone(walk, z)
  const a = walk.hearts[home]!
  const out: number[] = []
  for (const [zi, b] of walk.hearts.entries()) {
    if (zi === home || b < 0) continue
    const way = walk.route(a, b)
    expect(way).not.toBeNull()
    let len = 0
    for (let k = 1; k < way!.length; k++) {
      const p = walk.nodes[way![k - 1]!]!
      const q = walk.nodes[way![k]!]!
      len += Math.hypot(p.x - q.x, p.z - q.z)
    }
    const p = walk.nodes[a]!
    const q = walk.nodes[b]!
    out.push(len / Math.hypot(p.x - q.x, p.z - q.z))
  }
  return out
}

describe("walks from the Guildhall", () => {
  test("no longer than the land makes them: a median of 1.6× the straight line at most, nine in ten 2.2×", () => {
    const all: number[] = []
    for (const files of [4000, 12000]) for (let seed = 1; seed <= 4; seed++) all.push(...detours(seed, files))
    all.sort((p, q) => p - q)
    const at = (f: number) => all[Math.floor(f * all.length)]!
    expect(all.length).toBeGreaterThan(100)
    expect(at(0.5)).toBeLessThanOrEqual(1.6)
    expect(at(0.9)).toBeLessThanOrEqual(2.2)
  }, 120_000)

  test("a postern on the castle's far side opens onto a road", () => {
    let posterns = 0
    for (let seed = 1; seed <= 12; seed++) {
      const h = hexIsland({ seed, files: 4000 })
      const z = hexZones(h)
      const plan = z.castle
      if (!plan || plan.postern < 0) continue
      posterns++
      const g = h.grid
      expect(g.neighbours(plan.postern)[plan.posternSide]).toBe(plan.posternEntry)
      expect(plan.role.get(plan.postern)).toBe("court")
      // a road runs from the postern out through its side
      const road = z.roads.find((r) => r.tiles.includes(plan.postern) && r.tiles.includes(plan.posternEntry))
      expect(road).toBeDefined()
      expect(useOf(z, plan.posternEntry)).toMatch(/road|square/)
    }
    expect(posterns).toBeGreaterThan(0)
  }, 60_000)
})
