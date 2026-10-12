import { describe, expect, test } from "bun:test"
import { DMath, fnv1a, roll } from "@guildhall/core"
import { distTo } from "../src/geom/line.ts"
import { area, centroid, contains, type Ring } from "../src/geom/poly.ts"
import { dist, dot, len, perp, scale, type Vec2 } from "../src/geom/vec.ts"
import { GROUND_KINDS as ISLAND_GROUND_KINDS } from "../src/island/types.ts"
import { islandCoast } from "../src/land/coast.ts"
import { GROUND_KINDS, groundAt, groundGrid, SHORE_BAND } from "../src/land/ground.ts"
import { lakes } from "../src/land/lakes.ts"
import { rough } from "../src/land/rough.ts"
import { site } from "../src/town/site.ts"
import { TIERS } from "../src/town/types.ts"

/** world land: the coast moved out of the town (same output), lakes, rough ground and the ground raster. */

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const dirOf = (t: number): Vec2 => [DMath.cos(t), DMath.sin(t)]
const draw = (seed: number) => (salt: string) => roll(seed, `${salt}:land`)
/** A city-sized harbour town's coast (r 150), its bay on a seeded bearing, at least one far bay. */
const cityCoast = (seed: number) =>
  islandCoast(seed, { r: 150, side: dirOf(seed * 0.9), harbour: true }, 2.2, 1)
const disc = (radius: number): Ring =>
  Array.from({ length: 48 }, (_, i) => [
    radius * DMath.cos((i * Math.PI) / 24),
    radius * DMath.sin((i * Math.PI) / 24),
  ])

describe("the coast move", () => {
  test("town site() is byte-identical to before the move (600 specs, pinned hash)", () => {
    const out: string[] = []
    for (let seed = 0; seed < 60; seed++)
      for (const tier of TIERS)
        for (const harbour of [null, { bearing: seed * 0.37 }])
          out.push(JSON.stringify(site({ seed, tier, harbour, landmark: "castle" })))
    // fnv1a of the same 600 sites on v2 d146329, with the coast still in town/site.ts.
    expect(fnv1a(out.join("|"))).toBe(868309095)
  })

  test("the town's land, bounds and sea are islandCoast's", () => {
    for (const seed of SEEDS) {
      const s = site({ seed, tier: "town", harbour: { bearing: seed }, landmark: "castle" })
      const c = islandCoast(seed, { r: s.radius, side: dirOf(seed), harbour: true }, 2.2)
      expect(c.land).toEqual(s.land)
      expect(c.bounds).toEqual(s.bounds)
      expect(c.sea).toEqual(s.water)
    }
  })
})

describe("islandCoast", () => {
  test("records the harbour's bay: its near shore 0.55r out, its mouth on the coast, pointing out to sea", () => {
    for (const seed of SEEDS) {
      const side = dirOf(seed * 0.9)
      const c = cityCoast(seed)
      const main = c.bays.filter((b) => b.main)
      expect(main).toHaveLength(1)
      const bay = main[0]!
      expect(dist(bay.shore, scale(side, 0.55 * 150))).toBeLessThan(0.01)
      expect(dot(bay.out, side)).toBeCloseTo(1, 2)
      for (const p of bay.mouth) expect(distTo(p, c.ring, true)).toBeLessThan(0.01)
      // Across the bearing, the mouth's ends lie either side of the town.
      expect(Math.sign(dot(bay.mouth[0], perp(side)))).toBe(-Math.sign(dot(bay.mouth[1], perp(side))))
    }
  })

  test("far bays dip in: the innermost shore nearer the island's centre than the mouth's ends", () => {
    let far = 0
    for (const seed of SEEDS)
      for (const bay of cityCoast(seed).bays.filter((b) => !b.main)) {
        far++
        const c = cityCoast(seed).centre
        expect(dist(bay.shore, c)).toBeLessThan(Math.min(dist(bay.mouth[0], c), dist(bay.mouth[1], c)))
        expect(len(bay.out)).toBeCloseTo(1, 2)
      }
    expect(far).toBeGreaterThanOrEqual(SEEDS.length)
  })

  test("headlands are coast points; the harbour's two capes flank its bay", () => {
    for (const seed of SEEDS) {
      const side = dirOf(seed * 0.9)
      const c = cityCoast(seed)
      expect(c.headlands.length).toBeGreaterThanOrEqual(2)
      for (const h of c.headlands) expect(c.ring.some((p) => p[0] === h[0] && p[1] === h[1])).toBe(true)
      const [a, b] = c.headlands as [Vec2, Vec2]
      expect(Math.sign(dot(a, perp(side)))).toBe(-Math.sign(dot(b, perp(side))))
    }
  })

  test("asking for a far bay only adds one where the town's coast had none", () => {
    for (const seed of SEEDS) {
      const town = { r: 110, side: dirOf(seed), harbour: true }
      const plain = islandCoast(seed, town, 2.2)
      const asked = islandCoast(seed, town, 2.2, 1)
      expect(asked.bays.length).toBe(Math.max(2, plain.bays.length))
      if (plain.bays.length >= 2) expect(asked).toEqual(plain)
    }
  })
})

describe("lakes", () => {
  test("none asked, none given", () => {
    expect(lakes(cityCoast(1), [], 0, draw(1))).toEqual([])
  })

  test("1.5–6 k m², 40 m from the coast, out of what they avoid, 120 m apart, deterministic", () => {
    for (const seed of SEEDS) {
      const coast = cityCoast(seed)
      const town = disc(240)
      const out = lakes(coast, [town], 2, draw(seed))
      expect(out).toEqual(lakes(coast, [town], 2, draw(seed)))
      expect(out).toHaveLength(2)
      const shore = coast.land[0]![0]!
      for (const lake of out) {
        expect(area(lake)).toBeGreaterThan(1450)
        expect(area(lake)).toBeLessThan(6100)
        for (const p of lake) {
          expect(contains(shore, p, 0)).toBe(true)
          expect(distTo(p, shore, true)).toBeGreaterThanOrEqual(40)
          expect(len(p)).toBeGreaterThan(240)
        }
      }
      expect(dist(centroid(out[0]!), centroid(out[1]!))).toBeGreaterThanOrEqual(120)
    }
  })

  test("a lake that fits nowhere is dropped, not forced", () => {
    // A hamlet's island is too small to hold a lake 40 m from every shore past a 1.6r town.
    const coast = islandCoast(3, { r: 45, side: [1, 0], harbour: true }, 2.2, 1)
    expect(lakes(coast, [disc(72)], 2, draw(3)).length).toBeLessThan(2)
  })
})

describe("rough", () => {
  test("rock fields lie on the far side, inland, clear of the lakes, 3–10 k m²", () => {
    for (const seed of SEEDS) {
      const coast = cityCoast(seed)
      const lakeRings = lakes(coast, [disc(240)], 2, draw(seed))
      const out = rough(coast, [disc(240), ...lakeRings], 1, draw(seed))
      expect(out).toHaveLength(1)
      const field = out[0]!
      const shore = coast.land[0]![0]!
      expect(area(field)).toBeGreaterThan(2900)
      expect(area(field)).toBeLessThan(10100)
      expect(len(centroid(field))).toBeGreaterThan(len(coast.centre))
      expect(distTo(centroid(field), shore, true)).toBeGreaterThanOrEqual(45)
      for (const p of field) {
        expect(distTo(p, shore, true)).toBeGreaterThanOrEqual(12)
        for (const lake of lakeRings) expect(distTo(p, lake, true)).toBeGreaterThanOrEqual(25)
      }
    }
  })
})

describe("groundGrid", () => {
  const coast = cityCoast(4)
  const lakeRings = lakes(coast, [disc(240)], 1, draw(4))
  const fields = rough(coast, [disc(240), ...lakeRings], 1, draw(4))
  const g = groundGrid({ land: coast.land, lakes: lakeRings, rough: fields })

  test("pins the same kinds, in the same order, as the island's contracts", () => {
    expect([...GROUND_KINDS]).toEqual([...ISLAND_GROUND_KINDS])
  })

  test("covers the island in 4 m cells with sea all round", () => {
    expect(g.cell).toBe(4)
    expect(g.kind.length).toBe(g.w * g.h)
    for (let x = 0; x < g.w; x++) {
      expect(g.kind[x]).toBe(0)
      expect(g.kind[(g.h - 1) * g.w + x]).toBe(0)
    }
  })

  test("groundAt reads the landform: town ground, a lake, rock, the bay, beyond the raster", () => {
    expect(groundAt(g, [0, 0])).toBe("land")
    expect(groundAt(g, centroid(lakeRings[0]!))).toBe("lake")
    expect(groundAt(g, centroid(fields[0]!))).toBe("rough")
    // 20 m out from the harbour bay's near shore (city #4's bearing is 3.6).
    expect(groundAt(g, scale(dirOf(3.6), 102.5))).toBe("sea")
    expect(groundAt(g, [1e5, 1e5])).toBe("sea")
  })

  test("distances: 0 on the water, the shore band within 8 m of the sea", () => {
    let shore = 0
    for (let i = 0; i < g.kind.length; i++) {
      const kind = GROUND_KINDS[g.kind[i]!]
      if (kind === "sea") expect(g.coastDist[i]).toBe(0)
      if (kind === "lake") expect(g.lakeDist[i]).toBe(0)
      if (kind === "shore") {
        shore++
        expect(g.coastDist[i]).toBeLessThanOrEqual(SHORE_BAND)
      }
      if (kind === "land") expect(g.coastDist[i]).toBeGreaterThan(SHORE_BAND)
    }
    expect(shore).toBeGreaterThan(0)
  })

  test("no lakes: every lake distance is infinite", () => {
    const dry = groundGrid({ land: coast.land, lakes: [], rough: [] })
    expect(dry.lakeDist.every((d) => d === Number.POSITIVE_INFINITY)).toBe(true)
  })
})
