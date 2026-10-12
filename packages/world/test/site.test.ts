import { describe, expect, test } from "bun:test"
import { DMath } from "@guildhall/core"
import {
  area,
  bbox,
  centroid,
  clip,
  contains,
  distTo,
  dot,
  lerp,
  type Ring,
  rectCorners,
  scale,
  shapeArea,
  sub,
  type Vec2,
} from "../src/index.ts"
import { site } from "../src/town/site.ts"
import { normalizeSpec, TIER_DEFAULTS, validateTownSpec } from "../src/town/spec.ts"
import { TIERS, type TownSpecInput } from "../src/town/types.ts"

/** world town: tier defaults, preset validation, and the site (an island in the sea, its bay, the plaza, the castle ground). */

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const dirOf = (bearing: number): Vec2 => [DMath.cos(bearing), DMath.sin(bearing)]
const inWater = (rings: Ring[], p: Vec2) => rings.some((ring) => contains(ring, p, 0))
const waterArea = (rings: Ring[]) => rings.reduce((sum, ring) => sum + area(ring), 0)

describe("TIER_DEFAULTS", () => {
  const rows = TIERS.map((tier) => TIER_DEFAULTS[tier])
  const pairs = rows.slice(1).map((row, i) => [rows[i]!, row] as const)

  test("each tier reaches further and has at least as many districts and gates", () => {
    for (const [small, big] of pairs) {
      expect(big.radius).toBeGreaterThan(small.radius)
      expect(big.districts.length).toBeGreaterThanOrEqual(small.districts.length)
      expect(big.gates).toBeGreaterThanOrEqual(small.gates)
      expect(big.plaza).toBeGreaterThan(small.plaza)
      expect(big.farms).toBeGreaterThan(small.farms)
    }
  })

  test("streets get denser up the tiers (smaller blocks), and town tier keeps the 2400 m² block", () => {
    for (const [small, big] of pairs) expect(big.amax).toBeLessThan(small.amax)
    expect(TIER_DEFAULTS.town.amax).toBe(2400)
  })

  test("radii follow the plan: hamlet 45, village 70, town 110, city 150, capital 190", () => {
    expect(rows.map((d) => d.radius)).toEqual([45, 70, 110, 150, 190])
  })

  test("walls from town tier up; harbour odds rise with the tier", () => {
    expect(rows.map((d) => d.walls)).toEqual([false, false, true, true, true])
    for (const [small, big] of pairs) expect(big.harbourOdds).toBeGreaterThan(small.harbourOdds)
  })

  test("landmark kind per tier", () => {
    expect(rows.map((d) => d.landmark)).toEqual([null, "chapel", "guildhall", "castle", "guildhall"])
  })

  test("plazas stay within 18–40 m", () => {
    for (const d of rows) {
      expect(d.plaza).toBeGreaterThanOrEqual(18)
      expect(d.plaza).toBeLessThanOrEqual(40)
    }
  })
})

describe("normalizeSpec", () => {
  test("fills every field the spec leaves out from its tier", () => {
    const s = normalizeSpec({ seed: 3, tier: "city", harbour: null })
    const d = TIER_DEFAULTS.city
    expect(s).toEqual({
      seed: 3,
      tier: "city",
      districts: [...d.districts, "castle"],
      landmark: "castle",
      harbour: null,
      walls: true,
      farms: d.farms,
      radius: d.radius,
    })
  })

  test("keeps what the spec says, explicit nulls and false included", () => {
    const spec: TownSpecInput = {
      seed: 9,
      tier: "capital",
      districts: ["market"],
      landmark: null,
      harbour: null,
      walls: false,
      farms: 0,
      radius: 60,
    }
    expect(normalizeSpec(spec)).toEqual(spec as ReturnType<typeof normalizeSpec>)
  })

  test("a rolled harbour adds the harbour district; a castle adds the castle district", () => {
    const s = normalizeSpec({ seed: 1, tier: "town", harbour: { bearing: 1 }, landmark: "castle" })
    expect(s.districts).toEqual([...TIER_DEFAULTS.town.districts, "harbour", "castle"])
  })

  test("a harbour left out is rolled from the tier's odds, the same way every time", () => {
    for (const tier of ["hamlet", "capital"] as const) {
      const specs = Array.from({ length: 400 }, (_, i) => normalizeSpec({ seed: i, tier }))
      const share = specs.filter((s) => s.harbour !== null).length / specs.length
      expect(Math.abs(share - TIER_DEFAULTS[tier].harbourOdds)).toBeLessThan(0.08)
      expect(specs).toEqual(Array.from({ length: 400 }, (_, i) => normalizeSpec({ seed: i, tier })))
    }
  })

  test("is idempotent", () => {
    for (const seed of SEEDS)
      for (const tier of TIERS) {
        const once = normalizeSpec({ seed, tier })
        expect(normalizeSpec(once)).toEqual(once)
      }
  })
})

describe("validateTownSpec", () => {
  test("accepts a minimal preset and a full one", () => {
    expect(validateTownSpec({ seed: 0, tier: "hamlet" })).toEqual([])
    expect(
      validateTownSpec({
        seed: 42,
        tier: "city",
        districts: ["market", "residential", "residential", "harbour"],
        landmark: "castle",
        harbour: { bearing: 1.2 },
        walls: true,
        farms: 10,
        radius: 150,
      }),
    ).toEqual([])
    expect(validateTownSpec({ seed: 1, tier: "town", landmark: null, harbour: null })).toEqual([])
  })

  test("rejects anything that is not an object", () => {
    for (const bad of [null, 3, "town", []])
      expect(validateTownSpec(bad)).toEqual(["town: expected an object"])
  })

  test("names each bad field", () => {
    const problems = validateTownSpec({
      seed: -1.5,
      tier: "metropolis",
      districts: ["market", "docks"],
      landmark: "tower",
      harbour: { side: "north" },
      walls: "yes",
      farms: 2.5,
      radius: 5,
    })
    const fields = problems.map((p) => p.split(":")[0])
    expect(fields).toEqual([
      "seed",
      "tier",
      "districts[1]",
      "landmark",
      "harbour",
      "walls",
      "farms",
      "radius",
    ])
  })

  test("an empty district list is a problem, not 'use the defaults'", () => {
    expect(validateTownSpec({ seed: 1, tier: "town", districts: [] })).toHaveLength(1)
  })
})

describe("site", () => {
  const harboured = (seed: number, tier = TIERS[seed % TIERS.length]!) =>
    ({ seed, tier, harbour: { bearing: (seed * 0.7) % (2 * Math.PI) }, landmark: "castle" }) as const
  const inland = (seed: number, tier = TIERS[seed % TIERS.length]!) =>
    ({ seed, tier, harbour: null, landmark: "castle" }) as const
  const both = SEEDS.flatMap((seed) => [harboured(seed), inland(seed)])
  /** The island: the land polygon holding the town's centre. */
  const islandOf = (s: ReturnType<typeof site>) => s.land.find((poly) => contains(poly, [0, 0]))!

  test("is deterministic: the same spec gives the same site, bit for bit", () => {
    for (const spec of both) expect(JSON.stringify(site(spec))).toBe(JSON.stringify(site(spec)))
  })

  test("different seeds give different islands", () => {
    const outlines = new Set(SEEDS.map((seed) => JSON.stringify(site(harboured(seed, "town")).land)))
    expect(outlines.size).toBe(SEEDS.length)
  })

  test("the map is mostly sea: a square about twice the island's size, water on every side", () => {
    for (const spec of both) {
      const s = site(spec)
      const r = s.radius
      expect(s.radius).toBe(TIER_DEFAULTS[spec.tier].radius)
      const [lo, hi] = bbox(islandOf(s)[0]!)
      const across = Math.max(hi[0] - lo[0], hi[1] - lo[1])
      // The island is 4–5 town radii across ...
      expect(across / r).toBeGreaterThan(3.8)
      expect(across / r).toBeLessThan(5.6)
      // ... in the middle half of a square map: the sea is the rest.
      const [blo, bhi] = bbox(s.bounds)
      expect(bhi[0] - blo[0]).toBeCloseTo(bhi[1] - blo[1], 2)
      expect((bhi[0] - blo[0]) / across).toBeGreaterThan(1.9)
      const land = shapeArea(s.land) / area(s.bounds)
      expect(land).toBeGreaterThan(0.1)
      expect(land).toBeLessThan(0.3)
      // The map's edge is water all round.
      for (let i = 0; i < 4; i++)
        for (const t of [0.1, 0.5, 0.9]) {
          const edge = lerp(s.bounds[i]!, s.bounds[(i + 1) % 4]!, t)
          const p = lerp(edge, centroid(s.bounds), 0.01)
          expect(inWater(s.water, p), `${spec.tier}#${spec.seed} ${p}`).toBe(true)
        }
    }
  })

  test("land and water split the bounds exactly; the sea comes as plain rings, the town's side first", () => {
    for (const spec of both) {
      const s = site(spec)
      expect(shapeArea(s.land) + waterArea(s.water)).toBeCloseTo(area(s.bounds), -2)
      expect(clip(s.land, s.water, "intersection").length).toBe(0)
      for (const ring of s.water) expect(area(ring)).toBeGreaterThan(0)
      if (spec.harbour) {
        const dir = dirOf(spec.harbour.bearing)
        expect(dot(sub(centroid(s.water[0]!), centroid(s.plaza)), dir)).toBeGreaterThan(0)
      }
    }
  })

  test("with a harbour the town sits on its bay: the near shore 0.55r out, the island behind it", () => {
    for (const seed of SEEDS) {
      const spec = harboured(seed)
      const s = site(spec)
      const r = s.radius
      const dir = dirOf(spec.harbour.bearing)
      expect(inWater(s.water, scale(dir, 0.53 * r))).toBe(false)
      expect(inWater(s.water, scale(dir, 0.57 * r))).toBe(true)
      // The island's bulk lies inland of the town: countryside for fields, woods and points of interest.
      expect(dot(centroid(islandOf(s)[0]!), dir)).toBeLessThan(-0.8 * r)
      expect(contains(islandOf(s), scale(dir, -2.5 * r))).toBe(true)
    }
  })

  test("without a harbour the town keeps well back from every shore", () => {
    for (const seed of SEEDS) {
      const s = site(inland(seed))
      for (const ring of s.water) expect(distTo([0, 0], ring, true)).toBeGreaterThan(1.4 * s.radius)
    }
  })

  test("now and then a tiny islet lies offshore, on the island's far side from the town", () => {
    let islets = 0
    for (const spec of both) {
      const s = site(spec)
      for (const poly of s.land.filter((p) => !contains(p, [0, 0]) && area(p[0]!) < 0.1 * s.radius ** 2)) {
        islets++
        expect(distTo([0, 0], poly[0]!, true)).toBeGreaterThan(1.5 * s.radius)
      }
    }
    expect(islets).toBeGreaterThan(0)
  })

  test("the plaza sits on land, pulled 0.15r toward the water", () => {
    for (const seed of SEEDS) {
      const spec = harboured(seed)
      const s = site(spec)
      expect(area(s.plaza)).toBeGreaterThan(0)
      expect(clip(s.plaza, s.water, "intersection").length).toBe(0)
      expect(dot(centroid(s.plaza), dirOf(spec.harbour.bearing))).toBeCloseTo(0.15 * s.radius, 1)
    }
  })

  test("the castle stands on the town's edge, reaching past the gate circle, its front to the town", () => {
    for (const spec of both) {
      const s = site(spec)
      const castle = s.castleSite!
      const out = Math.hypot(...castle.c)
      expect(out).toBeLessThan(s.radius)
      expect(out + castle.d / 2).toBeGreaterThan(s.radius)
      // Local −z (its front) points back at the town's centre.
      const z: Vec2 = [DMath.sin(castle.rot), DMath.cos(castle.rot)]
      expect(dot(z, scale(castle.c, 1 / out))).toBeCloseTo(1, 3)
    }
  })

  test("the castle ground exists only for a castle, on land, clear of the plaza, away from the water", () => {
    expect(site({ seed: 1, tier: "town", harbour: null, landmark: "guildhall" }).castleSite).toBeNull()
    for (const seed of SEEDS) {
      const spec = harboured(seed)
      const s = site(spec)
      const castle = s.castleSite!
      const ring = rectCorners(castle)
      for (const p of ring) expect(contains(islandOf(s), p)).toBe(true)
      expect(clip(ring, s.plaza, "intersection").length).toBe(0)
      expect(dot(castle.c, dirOf(spec.harbour.bearing))).toBeLessThan(
        dot(centroid(s.plaza), dirOf(spec.harbour.bearing)),
      )
    }
  })
})
