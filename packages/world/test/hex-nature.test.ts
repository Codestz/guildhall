/**
 * The nature knobs (plan-hex "Nature pass", nature.ts) on the island with the authored tiles installed:
 * the defaults change nothing, bigger trees never reach into a road, a square or a building further than
 * they do today, `woods` thins the wooded tiles' trees and `wild` moves only the open country.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  BUILDING_REACH,
  HEX_TILE_SIZE,
  hexIsland,
  hexWorld,
  hexZones,
  installTilePrefabs,
  isBuildingPiece,
  natureFamily,
  natureReach,
  parseTilePrefabs,
  useOf,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

const SEEDS = [1, 4]
const islands = SEEDS.map((seed) => {
  const h = hexIsland({ seed, files: 4000 })
  return { h, z: hexZones(h) }
})

/** The corners of a tile's hex (pointy top, corners at 30° + 60°·k). */
const corners = (cx: number, cz: number): [number, number][] =>
  [0, 1, 2, 3, 4, 5].map((k) => {
    const a = Math.PI / 6 + (Math.PI / 3) * k
    return [cx + Math.cos(a) * HEX_TILE_SIZE, cz + Math.sin(a) * HEX_TILE_SIZE]
  })
/** Point-to-segment distance. */
const toSegment = (x: number, z: number, [ax, az]: [number, number], [bx, bz]: [number, number]) => {
  const lx = bx - ax
  const lz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * lx + (z - az) * lz) / (lx * lx + lz * lz)))
  return Math.hypot(x - ax - lx * t, z - az - lz * t)
}
/** Whether (x, z) is inside the hex at (cx, cz). */
const inside = (x: number, z: number, cx: number, cz: number) => {
  const a = (HEX_TILE_SIZE * Math.sqrt(3)) / 2
  return [0, 1, 2, 3, 4, 5].every((k) => {
    const t = (Math.PI / 3) * k
    return (x - cx) * Math.cos(t) + (z - cz) * Math.sin(t) <= a + 1e-9
  })
}

describe("nature knobs", () => {
  test("the defaults (every knob 1) build today's island exactly", () => {
    for (const { h, z } of islands) {
      const today = hexWorld(h, z)
      const ones = hexWorld(h, hexZones(h, { wild: 1 }), {
        nature: { tree: 1, pine: 1, bush: 1, rock: 1, grass: 1, flower: 1, woods: 1, wild: 1 },
      })
      expect(ones.pieces).toEqual(today.pieces)
      expect(ones.tiles).toEqual(today.tiles)
      expect(ones.stats.nature).toBeUndefined()
    }
  })

  test("grown trees, pines, bushes and rocks never reach into a road, a square or a building further than today", () => {
    for (const { h, z } of islands) {
      const today = hexWorld(h, z)
      const big = hexWorld(h, z, { nature: { tree: 1.6, pine: 1.6, bush: 1.3, rock: 1.5 } })
      expect(big.pieces.length).toBe(today.pieces.length)
      // what nature must keep clear: hard tiles (by the world's own tiles) and building discs
      const hard = big.tiles.filter((t) => {
        const u = useOf(z, t.i)
        return (
          ["road", "bridge", "square", "building", "landmark", "dock"].includes(u) ||
          t.prefab === "scene-part" ||
          (z.zoneOf[t.i]! > 0 && z.zones[z.zoneOf[t.i]! - 1]!.kind === "castle")
        )
      })
      const buildings = today.pieces
        .filter((p) => isBuildingPiece(p.piece))
        .map((p) => [p.x, p.z, BUILDING_REACH * p.scale] as const)
      let grown = 0
      let checked = 0
      big.pieces.forEach((p, k) => {
        const was = today.pieces[k]!
        expect(p.piece).toBe(was.piece)
        if (!natureFamily(p.piece) || p.scale <= was.scale) return
        grown++
        const r0 = natureReach(p.piece) * was.scale
        const r1 = natureReach(p.piece) * p.scale
        let free = Number.POSITIVE_INFINITY
        for (const t of hard) {
          if (Math.abs(t.x - p.x) > 12 || Math.abs(t.z - p.z) > 12) continue
          if (inside(p.x, p.z, t.x, t.z)) free = 0
          const c = corners(t.x, t.z)
          for (let e = 0; e < 6; e++) free = Math.min(free, toSegment(p.x, p.z, c[e]!, c[(e + 1) % 6]!))
        }
        for (const [bx, bz, br] of buildings)
          free = Math.min(free, Math.max(0, Math.hypot(p.x - bx, p.z - bz) - br))
        checked++
        expect(r1).toBeLessThanOrEqual(Math.max(r0, free) + 1e-6)
      })
      // the wood behind the street does grow: most nature away from the towns gets bigger
      expect(checked).toBe(grown)
      expect(grown).toBeGreaterThan(1000)
      expect(big.stats.nature!.grown).toBe(grown)
    }
  })

  test("woods thins the wooded tiles' trees and leaves everything else", () => {
    const { h, z } = islands[0]!
    const count = (w: ReturnType<typeof hexWorld>) => {
      let trees = 0
      let other = 0
      for (const p of w.pieces) {
        const f = natureFamily(p.piece)
        if (f === "tree" || f === "pine") trees++
        else other++
      }
      return { trees, other }
    }
    const today = count(hexWorld(h, z))
    const thin = count(hexWorld(h, z, { nature: { woods: 0.6 } }))
    const full = count(hexWorld(h, z, { nature: { woods: 1.5 } }))
    expect(thin.other).toBe(today.other)
    expect(full.other).toBe(today.other)
    expect(thin.trees).toBeLessThan(today.trees * 0.9)
    expect(full.trees).toBeGreaterThan(today.trees)
  })

  test("wild moves the open country's woods line, never a place or a road", () => {
    const { h, z } = islands[0]!
    const woods = (zz: typeof z) => {
      let n = 0
      for (let i = 0; i < h.grid.size; i++) if (useOf(zz, i) === "woods") n++
      return n
    }
    const more = hexZones(h, { wild: 1.3 })
    const less = hexZones(h, { wild: 0.7 })
    expect(woods(more)).toBeGreaterThan(woods(z))
    expect(woods(less)).toBeLessThan(woods(z))
    for (const zz of [more, less]) {
      expect(zz.zones).toEqual(z.zones)
      expect(zz.roads).toEqual(z.roads)
      expect(Array.from(zz.zoneOf)).toEqual(Array.from(z.zoneOf))
    }
  })
})
