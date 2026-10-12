import { describe, expect, test } from "bun:test"
import { DMath } from "@guildhall/core"
import { distTo } from "../src/geom/line.ts"
import { area, centroid, contains, shapeArea } from "../src/geom/poly.ts"
import { dist, dot, len, type Vec2 } from "../src/geom/vec.ts"
import { islandSite, TOWN_CLEAR } from "../src/island/site.ts"
import { normalizeIslandSpec } from "../src/island/spec.ts"
import type { IslandSite, NormalIslandSpec } from "../src/island/types.ts"
import { groundAt } from "../src/land/ground.ts"

/** world island: growth step 0, the island's landform (coast, bays, headlands, islets, lakes, rough, ground). */

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const specOf = (seed: number, tier: "town" | "city") =>
  normalizeIslandSpec({ seed, town: { seed: seed * 7 + 1, tier } })
const sites: { spec: NormalIslandSpec; site: IslandSite }[] = SEEDS.flatMap((seed) =>
  (["town", "city"] as const).map((tier) => {
    const spec = specOf(seed, tier)
    return { spec, site: islandSite(spec, spec.town.radius) }
  }),
)
/** Every water edge a lake must keep back from: the island's coast (the bay included). */
const coastDist = (s: IslandSite, p: Vec2) => distTo(p, s.coast, true)

describe("islandSite", () => {
  test("is deterministic, its ground raster included", () => {
    for (const { spec } of sites.slice(0, 6)) {
      const a = islandSite(spec, spec.town.radius)
      const b = islandSite(spec, spec.town.radius)
      expect(a).toEqual(b)
      expect(Array.from(a.ground.kind)).toEqual(Array.from(b.ground.kind))
    }
  })

  test("the town stands on the island at the origin, on its harbour bay", () => {
    for (const { spec, site } of sites) {
      expect(site.land.some((poly) => contains(poly, [0, 0]))).toBe(true)
      const main = site.bays.filter((b) => b.main)
      expect(main).toHaveLength(1)
      const bearing: Vec2 = [DMath.cos(spec.town.harbour.bearing), DMath.sin(spec.town.harbour.bearing)]
      expect(dot(main[0]!.out, bearing)).toBeGreaterThan(0.99)
    }
  })

  test("bays and headlands are recorded: the harbour's and at least one more bay, two capes or more", () => {
    for (const { site } of sites) {
      expect(site.bays.length).toBeGreaterThanOrEqual(2)
      expect(new Set(site.bays.map((b) => b.id)).size).toBe(site.bays.length)
      expect(site.headlands.length).toBeGreaterThanOrEqual(2)
    }
  })

  test("lakes as many as asked, holes in the land, 40 m from the coast and 1.3r from the town", () => {
    for (const { spec, site } of sites) {
      const r = spec.town.radius
      expect(site.lakes).toHaveLength(spec.lakes)
      // Cut out: the land lost exactly the lakes' area, and a lake's middle is not land.
      const lakeArea = site.lakes.reduce((sum, l) => sum + area(l), 0)
      const holes = site.land.flatMap((poly) => poly.slice(1))
      expect(holes).toHaveLength(site.lakes.length)
      expect(holes.reduce((sum, h) => sum + Math.abs(area(h)), 0)).toBeCloseTo(lakeArea, -1)
      expect(shapeArea(site.land)).toBeGreaterThan(0)
      for (const lake of site.lakes) {
        expect(site.land.some((poly) => contains(poly, centroid(lake), 0))).toBe(false)
        for (const p of lake) {
          expect(coastDist(site, p)).toBeGreaterThanOrEqual(40)
          expect(len(p)).toBeGreaterThanOrEqual(1.3 * r)
          expect(len(p)).toBeGreaterThanOrEqual(TOWN_CLEAR * r)
        }
      }
    }
  })

  test("rough ground lies inland on the far side from the town, clear of the lakes", () => {
    for (const { spec, site } of sites) {
      expect(site.rough).toHaveLength(spec.rough)
      for (const field of site.rough) {
        const mid = centroid(field)
        // Beyond the island's centre, seen from the town.
        expect(len(mid)).toBeGreaterThan(dist(site.centre, [0, 0]))
        expect(coastDist(site, mid)).toBeGreaterThanOrEqual(45)
        for (const p of field) {
          expect(site.land.some((poly) => contains(poly, p, 0))).toBe(true)
          for (const lake of site.lakes) expect(distTo(p, lake, true)).toBeGreaterThanOrEqual(25)
        }
      }
    }
  })

  test("the ground raster agrees with the shapes: lakes, rock, the town, the sea beyond", () => {
    for (const { site } of sites) {
      for (const lake of site.lakes) expect(groundAt(site.ground, centroid(lake))).toBe("lake")
      for (const field of site.rough) expect(groundAt(site.ground, centroid(field))).toBe("rough")
      expect(groundAt(site.ground, [0, 0])).toBe("land")
      expect(groundAt(site.ground, site.bounds[0]!)).toBe("sea")
    }
  })

  test("islets and the sea come from the coast unchanged", () => {
    for (const { site } of sites) {
      for (const islet of site.islets)
        expect(
          site.land.some(
            (poly) => contains(poly, centroid(islet)) && area(poly[0]!) < 0.1 * area(site.coast),
          ),
        ).toBe(true)
      expect(site.sea.length).toBeGreaterThanOrEqual(2)
    }
  })
})
