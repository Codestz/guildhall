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
  mirrorPrefab,
  mirrorSide,
  parseTilePrefabs,
  tileFurniture,
  tilePrefab,
  useOf,
  worldSide,
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
/**
 * The scenes that may turn to another street and be mirrored to fit: the harbour's quay (its footprint
 * out over the shallows), the monastery's compound (it takes in its place's other buildings), the
 * farmstead (its fields stay fields) and the town hall's plaza.
 */
const TURNING = ["harbour-quay", "monastery-compound", "farmstead-yard", "town-hall-plaza"]
/** The tiles scene tile `t` covers: its footprint's sides, mirrored when it is, turned to its door. */
const coverOf = (
  h: ReturnType<typeof hexIsland>,
  t: { i: number; prefab: string | null; door?: number; mirror?: boolean },
) => {
  const nb = h.grid.neighbours(t.i)
  return tilePrefab(t.prefab!)!.footprint!.map((k) => nb[worldSide(t.mirror ? mirrorSide(k) : k, t.door!)]!)
}
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
        const turning = TURNING.includes(t.prefab ?? "")
        if (!SCENES.includes(t.prefab ?? "") && !turning) continue
        scenes++
        for (const j of coverOf(h, t)) {
          expect(owner.has(j)).toBe(false)
          owner.set(j, t.i)
          expect(tileOf.get(j)?.prefab).toBe("scene-part")
          expect(["road", "bridge", "square", "landmark"]).not.toContain(useOf(z, j))
          if (t.prefab === "harbour-quay") {
            // out over the shallows, from a tile at sea level
            expect(kindOf(h, j)).toBe("shallows")
            expect(h.level[t.i]).toBe(0)
            continue
          }
          expect(h.level[j]).toBe(h.level[t.i]!)
          expect(["sea", "shallows", "lake", "river", "rock", "cliff"]).not.toContain(kindOf(h, j))
          expect(useOf(z, j)).not.toBe("dock")
          // only the monastery and the town's market square take in their own place's buildings; a
          // farm's fields stay fields
          if (useOf(z, j) === "building") {
            expect(["monastery-compound", "market-square"]).toContain(t.prefab!)
            expect(z.zoneOf[j]).toBe(z.zoneOf[t.i]!)
          }
          if (t.prefab === "farmstead-yard") expect(useOf(z, j)).not.toBe("field")
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
        if (!SCENES.includes(t.prefab ?? "") && !TURNING.includes(t.prefab ?? "")) continue
        const mine = new Set([t.i, ...coverOf(h, t)])
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

  test("it grows its tiles with the tier: a keep and its forecourt, then walled, then wards and the great hall, then a citadel", () => {
    const sizes: number[] = []
    const keeps = new Set<number>()
    for (const files of [500, 2000, 4000, 12000]) {
      const { h, z, w } = build(1, files)
      const castle = z.zones.find((zz) => zz.kind === "castle")!
      sizes.push(castle.tiles.length)
      const prefab = new Map(w.tiles.map((t) => [t.i, t.prefab]))
      // the keep stays on the castle's first tile, the same tile at every size (sites.ts: a reserved site)
      expect(prefab.get(castle.tiles[0]!)).toBe("castle")
      keeps.add(castle.tiles[0]!)
      const near = (p: { x: number; z: number }) =>
        castle.tiles.some((i) => {
          const t = w.tiles.find((u) => u.i === i)!
          return Math.hypot(t.x - p.x, t.z - p.z) < HEX_TILE_SIZE
        })
      const walls = w.pieces.filter((p) => p.piece.startsWith("kaykit-hexagon/wall-") && near(p)).length
      if (z.tier === 1) expect(walls).toBe(0)
      else expect(walls).toBeGreaterThan(0)
      // the castle's heart, where agents gather, is the paved court before the great hall (tier 3 up),
      // else before the keep: both doors open onto it
      const plan = z.castle!
      const front = plan.hall >= 0 ? plan.hall : plan.keep
      if (z.tier >= 3) expect(prefab.get(plan.hall)).toBe("great-hall")
      expect(h.grid.neighbours(front)[plan.door.get(front)!]).toBe(castle.tile)
      expect(useOf(z, castle.tile)).toBe("court")
      if (z.tier === 4) expect(castle.tiles.some((i) => prefab.get(i) === "castle-tower")).toBe(true)
    }
    for (let k = 1; k < sizes.length; k++) expect(sizes[k]!).toBeGreaterThan(sizes[k - 1]!)
    expect(keeps.size).toBe(1)
  })

  test("agents passed to the world change what its castle builds", () => {
    const h = hexIsland({ seed: 1, files: 4000 })
    const z = hexZones(h, { agents: 8 })
    expect(z.tier).toBe(4)
    const w = hexWorld(h, z, { agents: 8 })
    expect(w.stats.prefabs["castle-tower"] ?? 0).toBeGreaterThan(0)
  })
})

describe("the harbour's quay, the monastery's compound, the farmsteads and the town hall's plaza", () => {
  const worlds = [1, 2, 3, 4, 5].map((seed) => build(seed, 4000))
  const count = (id: string) => worlds.map(({ w }) => w.tiles.filter((t) => t.prefab === id).length)

  test("they land on most islands: the quay where a harbour has two shallows behind a building, one compound and one plaza each, a farmstead per farm", () => {
    expect(count("harbour-quay").filter((n) => n === 1).length).toBeGreaterThanOrEqual(3)
    expect(count("monastery-compound").filter((n) => n >= 1).length).toBeGreaterThanOrEqual(3)
    expect(count("town-hall-plaza")).toEqual([1, 1, 1, 1, 1])
    for (const [k, { z }] of worlds.entries()) {
      const farms = z.zones.filter((zone) => zone.kind === "farm" && zone.tiles.length).length
      const n = count("farmstead-yard")[k]!
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(farms)
    }
  })

  test("each stands in its own kind of place: the quay in the harbour, the compound at the monastery, the hall by the town's ring street", () => {
    for (const { z, w } of worlds)
      for (const t of w.tiles) {
        const kind = z.zones[z.zoneOf[t.i]! - 1]?.kind
        if (t.prefab === "harbour-quay") expect(kind).toBe("harbour")
        if (t.prefab === "monastery-compound") expect(kind).toBe("monastery")
        if (t.prefab === "farmstead-yard") expect(kind).toBe("farm")
        if (t.prefab === "town-hall-plaza") expect(kind).toBe("town")
      }
  })

  test("a monastery with its compound builds no second chapel, and a quay's place's docks give way to it", () => {
    for (const { h, z, w } of worlds) {
      const prefab = new Map(w.tiles.map((t) => [t.i, t.prefab]))
      for (const t of w.tiles) {
        if (t.prefab === "monastery-compound") {
          const zone = z.zones[z.zoneOf[t.i]! - 1]!
          const chapels = zone.tiles.filter(
            (i) => prefab.get(i) === "chapel" || prefab.get(i) === "monastery",
          )
          expect(chapels).toEqual([])
        }
        if (t.prefab === "harbour-quay")
          for (const j of [...coverOf(h, t), ...z.zones[z.zoneOf[t.i]! - 1]!.tiles])
            for (const k of h.grid.neighbours(j)) if (k >= 0) expect(prefab.get(k)).not.toBe("dock")
      }
    }
  })

  test("a quay's deck is walked at its tile's top over the water, and nowhere else is", () => {
    for (const { h, w } of worlds) {
      const quay = w.tiles.find((t) => t.prefab === "harbour-quay")
      if (!quay) {
        expect(w.decks).toEqual([])
        continue
      }
      expect(w.decks.length).toBeGreaterThan(0)
      for (const d of w.decks) {
        expect(d.ay).toBe(quay.top)
        const mx = (d.ax + d.bx) / 2
        const mz = (d.az + d.bz) / 2
        expect(w.stairAt(mx, mz)).toBe(quay.top)
        const { q, r } = hexAt(mx / HEX_TILE_SIZE, mz / HEX_TILE_SIZE)
        expect(coverOf(h, quay)).toContain(h.grid.index(q, r))
      }
    }
  })
})

describe("a mirrored scene", () => {
  test("mirrors its sides (front and back stay), its pieces, spots, blockers and decks", () => {
    expect([0, 1, 2, 3, 4, 5].map(mirrorSide)).toEqual([2, 1, 0, 5, 4, 3])
    const p = tilePrefab("harbour-quay")!
    const m = mirrorPrefab(p)
    expect(m.footprint).toEqual([1, 0])
    expect(m.pieces.map((q) => [q.x, q.z, q.rot])).toEqual(p.pieces.map((q) => [-q.x, q.z, -q.rot]))
    expect(m.spots!.map((s) => [s.x, s.z, s.facing])).toEqual(p.spots!.map((s) => [-s.x, s.z, -s.facing]))
    expect(m.blockers!.map((b) => [b.x, b.z, b.r])).toEqual(p.blockers!.map((b) => [-b.x, b.z, b.r]))
    expect(m.decks!.map((d) => [d.ax, d.bx])).toEqual(p.decks!.map((d) => [-d.ax, -d.bx]))
    expect(mirrorPrefab(p)).toBe(m)
  })
})
