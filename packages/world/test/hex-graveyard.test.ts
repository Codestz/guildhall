/**
 * The island's graveyard (graveyard.ts): one an island near the town, on open country, its gate on a
 * road, its graves where its headstones are, walked to from the roads and clear of every solid, and the
 * authored file the same prefab as the code's.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { HEX_TILE_SIZE } from "../src/hex/tiles.ts"
import {
  GRAVE_COUNT,
  GRAVES,
  GRAVEYARD_SCENE,
  graveyardPrefab,
  HARD,
  hexAt,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  parseTilePrefabs,
  strikeSpot,
  tileFurniture,
  useOf,
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

const build = (seed: number, files: number) => {
  const h = hexIsland({ seed, files })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  return { h, z, w }
}
const steps = (h: ReturnType<typeof hexIsland>, a: number, b: number) => {
  const g = h.grid
  const dq = g.q[a]! - g.q[b]!
  const dr = g.r[a]! - g.r[b]!
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}
const tileAt = (h: ReturnType<typeof hexIsland>, x: number, z: number) => {
  const { q, r } = hexAt(x / HEX_TILE_SIZE, z / HEX_TILE_SIZE)
  return h.grid.index(q, r)
}

describe("the graveyard", () => {
  test("its file is the code's prefab: graves and headstones agree", () => {
    expect(data[GRAVEYARD_SCENE]).toEqual(JSON.parse(JSON.stringify(graveyardPrefab())))
    expect(GRAVES.length).toBe(GRAVE_COUNT)
    // a headstone behind every grave, a hero's room before it on the path
    const pieces = graveyardPrefab().pieces
    for (const g of GRAVES) {
      const stone = pieces.find(
        (p) =>
          /grave|marker/.test(p.piece) && !/dirt/.test(p.piece) && Math.hypot(p.x - g.x, p.z - g.z) < 0.8,
      )
      expect(stone).toBeDefined()
      const s = strikeSpot(g)
      expect(Math.abs(s.x)).toBeLessThan(0.4)
    }
  })

  const islands = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) =>
    [500, 4000, 12000].map((files) => ({ seed, files, ...build(seed, files) })),
  )

  test("one an island, near the town, on open country on one level, its gate on a road", () => {
    for (const { h, z, seed, files } of islands) {
      const gy = z.graveyard
      expect([seed, files, gy !== null]).toEqual([seed, files, true])
      if (!gy) continue
      const town = z.zones.find((q) => q.kind === "town")!.tile
      expect(steps(h, gy.tile, town)).toBeLessThanOrEqual(14)
      for (const i of [gy.tile, ...gy.cover]) {
        expect(useOf(z, i)).toBe("graveyard")
        expect(z.zoneOf[i]).toBe(0)
        expect(h.level[i]).toBe(h.level[gy.tile]!)
        expect(h.sites.castle).not.toContain(i)
      }
      const road = h.grid.neighbours(gy.tile)[gy.door]!
      expect(useOf(z, road)).toBe("road")
      expect(h.level[road]).toBe(h.level[gy.tile]!)
    }
  })

  test("all of it is built: nothing of it dropped off a road or a neighbour, its graves on its tiles", () => {
    const authored = graveyardPrefab().pieces.length
    const kinds = new Set(graveyardPrefab().pieces.map((p) => p.piece))
    for (const { h, z, w } of islands) {
      const gy = w.graveyard!
      expect(gy).not.toBeNull()
      const mine = new Set([gy.tile, ...gy.cover])
      const own = w.pieces.filter((p) => kinds.has(p.piece) && mine.has(tileAt(h, p.x, p.z)))
      expect(own.length).toBe(authored)
      expect(w.tiles.find((t) => t.i === gy.tile)?.prefab).toBe(GRAVEYARD_SCENE)
      for (const j of gy.cover) expect(w.tiles.find((t) => t.i === j)?.prefab).toBe("scene-part")
      expect(gy.graves.length).toBe(GRAVE_COUNT)
      for (const g of gy.graves) {
        expect(mine.has(tileAt(h, g.x, g.z))).toBe(true)
        expect(mine.has(tileAt(h, g.strike.x, g.strike.z))).toBe(true)
        expect(g.y).toBeCloseTo(w.heightAt(g.x, g.z), 5)
      }
      // the gate first, the crypt's end last
      const d = (k: number) => Math.hypot(gy.graves[k]!.x - gy.gate[0], gy.graves[k]!.z - gy.gate[2])
      expect(d(0)).toBeLessThan(d(GRAVE_COUNT - 1))
      expect(useOf(z, gy.tile)).toBe("graveyard")
    }
  })

  test("walked to: a way from the town's heart to its gate, and from there to every grave clear of every solid", () => {
    for (const { h, z, w, seed, files } of islands.filter((x) => x.files === 4000)) {
      const gy = w.graveyard!
      const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
      const node = walk.at(gy.tile)
      expect([seed, files, node >= 0]).toEqual([seed, files, true])
      const town = z.zones.findIndex((q) => q.kind === "town")
      expect(walk.route(walk.hearts[town]!, node)).not.toBeNull()
      const f = tileFurniture(h.grid, w)
      const n = walk.nodes[node]!
      for (const g of gy.graves) {
        // the skeleton's feet and the striker's are clear, and the path to the striker's spot too
        expect(f.blocked(g.x, g.z, 0.1, HARD)).toBe(false)
        const len = Math.hypot(g.strike.x - n.x, g.strike.z - n.z)
        for (let k = 0; k <= Math.ceil(len / 0.1); k++) {
          const t = k / Math.ceil(len / 0.1)
          const x = n.x + (g.strike.x - n.x) * t
          const zz = n.z + (g.strike.z - n.z) * t
          expect([seed, k, f.blocked(x, zz, 0.12, HARD)]).toEqual([seed, k, false])
        }
      }
    }
  })

  test("the same island always has it in the same place; a little growth mostly keeps it there", () => {
    let kept = 0
    let pairs = 0
    for (let seed = 1; seed <= 12; seed++) {
      const a = hexZones(hexIsland({ seed, files: 4000 })).graveyard
      expect(hexZones(hexIsland({ seed, files: 4000 })).graveyard).toEqual(a)
      const b = hexZones(hexIsland({ seed, files: 4040 })).graveyard
      pairs++
      if (a?.tile === b?.tile) kept++
    }
    // it moves only when the roads or the places round it do, which a few more files often move (the
    // places and roads are not stable under growth): measured 42–59% kept per +1% files over seeds 1–20
    expect(kept / pairs).toBeGreaterThanOrEqual(0.35)
  })
})
