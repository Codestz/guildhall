/**
 * Scenes bigger than a tile (a prefab's `footprint`) placed on the island, and the Guildhall castle
 * growing by tier, with the authored tiles (data/tiles) installed.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { castleTier } from "../src/hex/zones.ts"
import {
  HEX_TILE_SIZE,
  hexAt,
  hexIsland,
  hexWorld,
  hexZones,
  installTilePrefabs,
  kindOf,
  parseTilePrefabs,
  tileFurniture,
  tilePrefab,
  useOf,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
// installed before the islands below are built (at collection)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

const SCENES = ["tavern-garden", "market-square", "smithy-works", "archery-range"]
const build = (seed: number, files: number) => {
  const h = hexIsland({ seed, files })
  const z = hexZones(h)
  return { h, z, w: hexWorld(h, z) }
}

describe("scenes bigger than a tile", () => {
  const islands = [
    [1, 4000],
    [2, 4000],
    [3, 2000],
    [1, 12000],
  ].map(([seed, files]) => build(seed!, files!))

  test("each claims exactly its footprint's neighbours: free open ground on its level, never a road, water or another building", () => {
    let scenes = 0
    for (const { h, z, w } of islands) {
      const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
      const owner = new Map<number, number>()
      for (const t of w.tiles) {
        if (!SCENES.includes(t.prefab ?? "")) continue
        scenes++
        const p = tilePrefab(t.prefab!)!
        const nb = h.grid.neighbours(t.i)
        for (const k of p.footprint!) {
          const j = nb[(k + t.door! + 2) % 6]!
          expect(owner.has(j)).toBe(false)
          owner.set(j, t.i)
          expect(tileOf.get(j)?.prefab).toBe("scene-part")
          expect(h.level[j]).toBe(h.level[t.i]!)
          expect(["sea", "shallows", "lake", "river", "rock", "cliff"]).not.toContain(kindOf(h, j))
          expect(["road", "bridge", "square", "building", "landmark", "dock"]).not.toContain(useOf(z, j))
        }
      }
      // no claimed tile without its scene
      for (const t of w.tiles) if (t.prefab === "scene-part") expect(owner.has(t.i)).toBe(true)
    }
    expect(scenes).toBeGreaterThan(8)
  })

  test("the town gets its market square, a canteen with its beer garden and a smithy with its yard; the camp its range", () => {
    const { w } = islands[0]!
    const have = new Set(w.tiles.map((t) => t.prefab))
    for (const id of SCENES) expect(have.has(id)).toBe(true)
  })

  test("a scene's spots and blockers land on its own tiles, and a claimed tile adds none of its own", () => {
    for (const { h, w } of islands) {
      const furniture = tileFurniture(h.grid, w)
      const tileAt = (x: number, zz: number) => {
        const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
        return h.grid.index(q, r)
      }
      const parts = new Set(w.tiles.filter((t) => t.prefab === "scene-part").map((t) => t.i))
      for (const t of w.tiles) {
        if (!SCENES.includes(t.prefab ?? "")) continue
        const mine = new Set([t.i, ...[...h.grid.neighbours(t.i)].filter((j) => parts.has(j))])
        const spots = furniture.spots.filter((s) => s.tile === t.i)
        expect(spots.length).toBe(tilePrefab(t.prefab!)!.spots!.length)
        for (const s of spots) expect(mine.has(tileAt(s.x, s.z))).toBe(true)
      }
      expect(furniture.spots.filter((s) => parts.has(s.tile))).toEqual([])
    }
  })
})

describe("the Guildhall castle", () => {
  test("its tier follows the repo's files, a step for a big crew or a lone agent", () => {
    expect([500, 2000, 4000, 12000].map((f) => castleTier(f))).toEqual([1, 2, 3, 4])
    expect(castleTier(4000, 8)).toBe(4)
    expect(castleTier(4000, 1)).toBe(2)
    expect(castleTier(100, 1)).toBe(1)
    expect(castleTier(50000, 20)).toBe(4)
  })

  test("it grows its tiles with the tier: a keep alone, then walled, then wards and the great hall, then a citadel", () => {
    const sizes: number[] = []
    for (const files of [500, 2000, 4000, 12000]) {
      const { z, w } = build(1, files)
      const castle = z.zones.find((zz) => zz.kind === "castle")!
      sizes.push(castle.tiles.length)
      const prefab = new Map(w.tiles.map((t) => [t.i, t.prefab]))
      // the keep stays on the castle's first tile
      expect(prefab.get(castle.tiles[0]!)).toBe("castle")
      const near = (p: { x: number; z: number }) =>
        castle.tiles.some((i) => {
          const t = w.tiles.find((u) => u.i === i)!
          return Math.hypot(t.x - p.x, t.z - p.z) < HEX_TILE_SIZE
        })
      const walls = w.pieces.filter((p) => p.piece.startsWith("kaykit-hexagon/wall-") && near(p)).length
      if (z.tier === 1) expect(walls).toBe(0)
      else expect(walls).toBeGreaterThan(0)
      // the great hall (tier 3 up) is the castle's heart, where agents gather
      if (z.tier >= 3) expect(prefab.get(castle.tile)).toBe("great-hall")
      else expect(castle.tile).toBe(castle.tiles[0]!)
      if (z.tier === 4) expect(castle.tiles.some((i) => prefab.get(i) === "castle-tower")).toBe(true)
    }
    for (let k = 1; k < sizes.length; k++) expect(sizes[k]!).toBeGreaterThan(sizes[k - 1]!)
  })

  test("agents passed to the world change what its castle builds", () => {
    const h = hexIsland({ seed: 1, files: 4000 })
    const z = hexZones(h, { agents: 8 })
    expect(z.tier).toBe(4)
    const w = hexWorld(h, z, { agents: 8 })
    expect(w.stats.prefabs["castle-tower"] ?? 0).toBeGreaterThan(0)
  })
})
