import { describe, expect, test } from "bun:test"
import { DMath } from "@guildhall/core"
import {
  area,
  centroid,
  clip,
  contains,
  dot,
  type Ring,
  rectCorners,
  scale,
  shapeArea,
  type Vec2,
} from "../src/index.ts"
import { site } from "../src/town/site.ts"
import { normalizeSpec, TIER_DEFAULTS, validateTownSpec } from "../src/town/spec.ts"
import { TIERS, type TownSpecInput } from "../src/town/types.ts"

/** world town: tier defaults, preset validation, and the site (flat land, water, plaza, castle ground). */

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

  test("is deterministic: the same spec gives the same site, bit for bit", () => {
    for (const seed of SEEDS)
      expect(JSON.stringify(site(harboured(seed)))).toBe(JSON.stringify(site(harboured(seed))))
  })

  test("different seeds give different sites", () => {
    const outlines = new Set(SEEDS.map((seed) => JSON.stringify(site(harboured(seed, "town")).plaza)))
    expect(outlines.size).toBe(SEEDS.length)
  })

  test("the bounds are a 2.6r square round the origin", () => {
    for (const tier of TIERS) {
      const s = site({ seed: 1, tier, harbour: null })
      const r = TIER_DEFAULTS[tier].radius
      expect(s.radius).toBe(r)
      expect(area(s.bounds)).toBeCloseTo((2.6 * r) ** 2, 0)
    }
  })

  test("without a harbour the land is the whole bounds and there is no water", () => {
    const s = site({ seed: 4, tier: "town", harbour: null })
    expect(s.water).toEqual([])
    expect(shapeArea(s.land)).toBeCloseTo(area(s.bounds), 3)
  })

  test("land and water split the bounds exactly; water is a real bite, not the whole map", () => {
    for (const seed of SEEDS) {
      const s = site(harboured(seed))
      const bounds = area(s.bounds)
      const water = waterArea(s.water)
      expect(shapeArea(s.land) + water).toBeCloseTo(bounds, -1)
      expect(water / bounds).toBeGreaterThan(0.1)
      expect(water / bounds).toBeLessThan(0.4)
      expect(clip(s.land, s.water, "intersection").length).toBe(0)
    }
  })

  test("the near shore lies 0.55r out along the bearing and the water runs past the bounds", () => {
    for (const seed of SEEDS) {
      const spec = harboured(seed)
      const s = site(spec)
      const dir = dirOf(spec.harbour.bearing)
      expect(inWater(s.water, scale(dir, 0.53 * s.radius))).toBe(false)
      expect(inWater(s.water, scale(dir, 0.57 * s.radius))).toBe(true)
      const h = 1.3 * s.radius
      const onBounds = s.water
        .flat()
        .filter((p) => Math.abs(Math.abs(p[0]) - h) < 1e-2 || Math.abs(Math.abs(p[1]) - h) < 1e-2)
      expect(onBounds.length).toBeGreaterThanOrEqual(2)
    }
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

  test("the castle ground exists only for a castle, on land, clear of the plaza, away from the water", () => {
    expect(site({ seed: 1, tier: "town", harbour: null, landmark: "guildhall" }).castleSite).toBeNull()
    for (const seed of SEEDS) {
      const spec = harboured(seed)
      const s = site(spec)
      const castle = s.castleSite!
      const ring = rectCorners(castle)
      // The lake may cut a far corner off; the castle stands on the town's own land.
      const home = s.land.find((poly) => contains(poly, [0, 0]))!
      for (const p of ring) expect(contains(home, p)).toBe(true)
      expect(clip(ring, s.plaza, "intersection").length).toBe(0)
      expect(dot(castle.c, dirOf(spec.harbour.bearing))).toBeLessThan(
        dot(centroid(s.plaza), dirOf(spec.harbour.bearing)),
      )
    }
  })
})
