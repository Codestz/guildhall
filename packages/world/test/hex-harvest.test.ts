/**
 * The autumn harvest's placement (hex/harvest.ts): pure, stable, and only on free ground. Checked
 * against the collision layer, the road strips, the walk graph's ways and the spots as the world has
 * them, on the islands the Studio opens, and swept over a few seeds and sizes.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { solidDistance } from "../src/hex/collide.ts"
import { roadStrips, StripGrid } from "../src/hex/roads.ts"
import { tileFurniture } from "../src/hex/spots.ts"
import {
  HARVEST_IDS,
  type HarvestPiece,
  harvestHeaps,
  harvestPiles,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  NATURE_CHOSEN,
  parseTilePrefabs,
  workTiles,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

function build(seed: number, files: number) {
  const h = hexIsland({ seed, files })
  const z = hexZones(h, { wild: NATURE_CHOSEN.wild })
  const w = hexWorld(h, z, { nature: NATURE_CHOSEN })
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  return { h, z, w, walk, piles: harvestPiles(h, w, { walk }) }
}

const key = (p: HarvestPiece) => `${p.tile}:${p.heap}:${p.piece}:${p.x.toFixed(3)},${p.z.toFixed(3)}`

describe("the harvest piles", () => {
  const islands = [
    [1, 1500],
    [2, 4000],
    [3, 4000],
    [5, 500],
  ].map(([seed, files]) => build(seed!, files!))

  test("farms and fields get some, made of the harvest's own pieces", () => {
    for (const { piles, w } of islands) {
      expect(harvestHeaps(piles)).toBeGreaterThan(w.tiles.some((t) => t.prefab === "field") ? 5 : 0)
      for (const p of piles) expect(HARVEST_IDS).toContain(p.piece)
      const farm = new Set(["field", "farmstead", "farmstead-yard", "orchard", "cottage-veg", "homestead"])
      const prefab = new Map(w.tiles.map((t) => [t.i, t.prefab]))
      for (const p of piles) expect(farm.has(prefab.get(p.tile) ?? "")).toBe(true)
    }
  })

  test("are placed the same each time, whatever order the tiles come in", () => {
    for (const island of islands.slice(0, 2)) {
      const again = harvestPiles(island.h, island.w, { walk: island.walk })
      expect(again.map(key)).toEqual(island.piles.map(key))
      // (the order the tiles are listed in is no part of it)
      const reversed = { ...island.w, tiles: [...island.w.tiles].reverse() }
      const back = harvestPiles(island.h, reversed, { walk: island.walk })
      expect(back.map(key).sort()).toEqual(island.piles.map(key).sort())
    }
  })

  test("a farm keeps its piles as the island grows round it: only what stands near it matters", () => {
    // a farm's heaps come from the seed and its own coordinates, never from its index or from what was
    // placed before it. So the same island cut down to what lies within 14 m of a farm (the rest of the
    // world is "not grown yet") gives that farm the very same heaps
    let checked = 0
    for (const { h, w, walk, piles } of islands.slice(0, 3)) {
      const farms = new Map<number, HarvestPiece[]>()
      for (const p of piles) farms.set(p.tile, [...(farms.get(p.tile) ?? []), p])
      let n = 0
      for (const [tile, mine] of farms) {
        if (n++ % 9 !== 0) continue
        const t = w.tiles.find((x) => x.i === tile)!
        const near = (x: number, z: number) => Math.hypot(x - t.x, z - t.z) < 14
        const cut = {
          ...w,
          tiles: w.tiles.filter((x) => near(x.x, x.z)),
          pieces: w.pieces.filter((p) => near(p.x, p.z)),
          stairs: w.stairs.filter((s) => near(s.ax, s.az)),
          bridges: w.bridges.filter((b) => b.legs.some((s) => near(s.ax, s.az))),
        }
        const alone = harvestPiles(h, cut, { walk }).filter((p) => p.tile === tile)
        expect(alone.map(key)).toEqual(mine.map(key))
        checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
  }, 60_000)

  test("never stand on a road, a path, a spot or a solid, nor in the water", () => {
    for (const { h, w, walk, piles } of islands) {
      const furniture = tileFurniture(h.grid, w)
      const strips = new StripGrid(roadStrips(h, w))
      const solids = furniture.solids.filter((s) => !s.soft)
      for (const p of piles) {
        // a road, a street, a stair, a deck
        expect(strips.on(p.x, p.z, 0.1)).toBe(false)
        // a spot someone works or sits at
        for (const s of furniture.spots) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(0.6)
        // a wall, a building, a fence, a prop: the collision layer's own outlines
        for (const s of solids) {
          if (Math.hypot(s.cx - p.x, s.cz - p.z) > s.r + 1) continue
          expect(solidDistance(s, p.x, p.z)).toBeGreaterThan(0.1)
        }
      }
      // the walk graph's ways (a spur out to a field, a door's way): clear by more than a body's width
      const near = (x: number, zz: number, ax: number, az: number, bx: number, bz: number) => {
        const dx = bx - ax
        const dz = bz - az
        const l2 = dx * dx + dz * dz || 1e-12
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (zz - az) * dz) / l2))
        return Math.hypot(ax + dx * t - x, az + dz * t - zz)
      }
      for (const e of walk.edges) {
        const a = walk.nodes[e.a]!
        const b = walk.nodes[e.b]!
        const line: [number, number][] = [[a.x, a.z], ...(e.via ?? []), [b.x, b.z]]
        for (const p of piles) {
          if (Math.hypot(p.x - a.x, p.z - a.z) > Math.hypot(b.x - a.x, b.z - a.z) + 8) continue
          for (let k = 1; k < line.length; k++)
            expect(
              near(p.x, p.z, line[k - 1]![0], line[k - 1]![1], line[k]![0], line[k]![1]),
            ).toBeGreaterThan(0.3)
        }
      }
      // dry level ground: on the tile's height
      const top = new Map(w.tiles.map((t) => [t.i, t.top]))
      for (const p of piles) {
        expect(top.has(p.tile)).toBe(true)
        expect(Math.abs(p.y - (top.get(p.tile) as number))).toBeLessThan(0.9)
      }
    }
  })

  test("leave an island with no farms alone", () => {
    const { h, w } = islands[0]!
    expect(harvestPiles(h, { ...w, tiles: w.tiles.filter((t) => !t.prefab) })).toEqual([])
  })
})
