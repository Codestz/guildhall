/**
 * The island's regions (regions.ts) and their nature (nature.ts `dressRegion`), the authored tiles
 * installed: two to four per island and most of it left green, the same every build, kept where they
 * were as the repo grows, never on the town's core or the castle's site, soft at their rims; their
 * nature adds only soft ground cover, nothing on a way.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { solidKind } from "../src/hex/collide.ts"
import {
  HEX_TILE_SIZE,
  hexIsland,
  hexRegions,
  hexWorld,
  hexZones,
  installTilePrefabs,
  kindOf,
  NATURE_CHOSEN,
  parseTilePrefabs,
  REGION_KINDS,
  regionCount,
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

const K = REGION_KINDS.length
const land = (h: ReturnType<typeof hexIsland>, i: number) => {
  const k = kindOf(h, i)
  return k !== "sea" && k !== "shallows"
}

describe("regions", () => {
  test("two to four per island, more on a bigger one, and most of the island stays green", () => {
    for (let seed = 1; seed <= 8; seed++)
      for (const files of [300, 1500, 12000]) {
        const h = hexIsland({ seed, files })
        const r = hexRegions(h, hexZones(h))
        expect(r.list.length).toBeGreaterThanOrEqual(2)
        expect(r.list.length).toBeLessThanOrEqual(4)
        expect(r.list.length).toBe(regionCount(h.stats.land))
        expect(new Set(r.list.map((x) => x.kind)).size).toBe(r.list.length)
        let sum = 0
        let n = 0
        for (let i = 0; i < h.grid.size; i++) {
          if (!land(h, i)) continue
          n++
          for (let k = 0; k < K; k++) sum += r.weight[i * K + k]!
        }
        expect(sum / n).toBeLessThan(0.4)
      }
  })

  test("are the same every build", () => {
    const h = hexIsland({ seed: 3, files: 4000 })
    const z = hexZones(h)
    const a = hexRegions(h, z)
    const b = hexRegions(hexIsland({ seed: 3, files: 4000 }), z)
    expect(b.list).toEqual(a.list)
    expect(b.of).toEqual(a.of)
    expect(b.weight).toEqual(a.weight)
    const w1 = hexWorld(h, z, { nature: NATURE_CHOSEN })
    const w2 = hexWorld(h, z, { nature: NATURE_CHOSEN })
    expect(w2.pieces).toEqual(w1.pieces)
  })

  test("stay where they were as the repo grows a tenth", () => {
    let kept = 0
    let total = 0
    for (let seed = 1; seed <= 8; seed++)
      for (const files of [1500, 4000]) {
        const a = hexIsland({ seed, files })
        const b = hexIsland({ seed, files: Math.round(files * 1.1) })
        const ra = hexRegions(a, hexZones(a))
        const rb = hexRegions(b, hexZones(b))
        // every region the smaller island has, the bigger one has at the same centre
        for (const reg of ra.list)
          expect(rb.list.some((x) => x.kind === reg.kind && x.centre === reg.centre)).toBe(true)
        for (let i = 0; i < a.grid.size; i++) {
          if (!land(a, i) || !ra.of[i]) continue
          total++
          if (rb.of[i] === ra.of[i]) kept++
        }
      }
    expect(kept / total).toBeGreaterThan(0.95)
  })

  test("are never on the town's core or the castle's site, nor on the town's or the castle's tiles", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const h = hexIsland({ seed, files: 4000 })
      const z = hexZones(h)
      const r = hexRegions(h, z)
      const core = [...h.sites.town, ...h.sites.castle]
      for (const i of core) for (let k = 0; k < K; k++) expect(r.weight[i * K + k]).toBe(0)
      for (let i = 0; i < h.grid.size; i++) {
        const zone = z.zoneOf[i] ? z.zones[z.zoneOf[i]! - 1] : undefined
        if (zone?.kind !== "town" && zone?.kind !== "castle") continue
        expect(r.of[i]).toBe(0)
      }
    }
  })

  test("blend at their rims: a region's full weight is two steps or more from where it ends", () => {
    let hard = 0
    let rims = 0
    for (let seed = 1; seed <= 8; seed++) {
      const h = hexIsland({ seed, files: 4000 })
      const r = hexRegions(h)
      const g = h.grid
      for (const reg of r.list) {
        const k = REGION_KINDS.indexOf(reg.kind)
        for (let i = 0; i < g.size; i++) {
          if (!land(h, i) || r.weight[i * K + k]! < 0.95) continue
          for (const j of g.neighbours(i)) {
            if (j < 0 || !land(h, j)) continue
            rims++
            if (r.weight[j * K + k]! === 0) hard++
          }
        }
      }
    }
    // (a cliff's foot is where a highland's weight may end in one step: its height gate)
    expect(hard / rims).toBeLessThan(0.02)
  })
})

describe("the regions' nature", () => {
  test("adds only soft ground cover, never on a way, a building's tile or the castle", () => {
    for (const seed of [1, 4, 7]) {
      const h = hexIsland({ seed, files: 4000 })
      const z = hexZones(h, { wild: NATURE_CHOSEN.wild })
      const off = hexWorld(h, z, { nature: NATURE_CHOSEN, regions: false })
      const on = hexWorld(h, z, { nature: NATURE_CHOSEN })
      expect(on.regions?.list.length).toBeGreaterThanOrEqual(2)
      const key = (p: { piece: string; x: number; z: number }) =>
        `${p.piece}@${p.x.toFixed(3)},${p.z.toFixed(3)}`
      const before = new Set(off.pieces.map(key))
      const at = (x: number, zz: number) => {
        const qf = ((Math.sqrt(3) / 3) * x - zz / 3) / HEX_TILE_SIZE
        const rf = ((2 / 3) * zz) / HEX_TILE_SIZE
        const sf = -qf - rf
        let q = Math.round(qf)
        let r = Math.round(rf)
        const s = Math.round(sf)
        if (Math.abs(q - qf) > Math.abs(r - rf) && Math.abs(q - qf) > Math.abs(s - sf)) q = -r - s
        else if (Math.abs(r - rf) > Math.abs(s - sf)) r = -q - s
        return h.grid.index(q, r)
      }
      let added = 0
      for (const p of on.pieces) {
        if (before.has(key(p))) continue
        const i = at(p.x, p.z)
        const use = useOf(z, i)
        const zone = z.zoneOf[i] ? z.zones[z.zoneOf[i]! - 1] : undefined
        // a swapped tree (pine, bare) is a solid, but stands where a bigger one stood
        if (/tree-(4|bare)/.test(p.piece)) continue
        added++
        expect(solidKind(p.piece)).toBeNull()
        expect(["road", "bridge", "square", "building", "landmark", "dock", "court"]).not.toContain(use)
        expect(zone?.kind).not.toBe("castle")
      }
      expect(added).toBeGreaterThan(0)
    }
  })
})
