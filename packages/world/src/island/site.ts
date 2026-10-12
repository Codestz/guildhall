/**
 * Growth step 0 (plan-w8 §4.0): the island's landform, before anything grows on it. The coast is
 * the one a harbour town would get (land/coast.ts), drawn round the main town at the origin with the
 * island's own seed and scale and at least one far bay besides the harbour's, so island coordinates
 * are the main town's local ones. Then the inland lakes, kept clear of the town and its fields (1.6r
 * from its centre: outside its frame), cut out of the land as holes; then the rock fields on the far
 * side, clear of the town and the lakes; then the ground raster.
 * Land draws are `roll(spec.seed, "<what>:land")`, keyed by each feature's index (ADR 014).
 */
import { DMath, roll } from "@guildhall/core"
import { area, clip, type Polygon, type Ring } from "../geom/poly.ts"
import { snap, type Vec2 } from "../geom/vec.ts"
import { islandCoast } from "../land/coast.ts"
import { groundGrid } from "../land/ground.ts"
import { lakes } from "../land/lakes.ts"
import { rough } from "../land/rough.ts"
import type { IslandSite, NormalIslandSpec } from "./types.ts"

/** Lakes and rock fields keep out of this disc round the main town, in its radii: the town and its farms belt. */
export const TOWN_CLEAR = 1.6
const DISC_POINTS = 48

export function islandSite(spec: NormalIslandSpec, mainR: number): IslandSite {
  const bearing = spec.town.harbour.bearing
  const side: Vec2 = [DMath.cos(bearing), DMath.sin(bearing)]
  const coast = islandCoast(spec.seed, { r: mainR, side, harbour: true }, spec.scale, 1)
  const draw = (salt: string) => roll(spec.seed, `${salt}:land`)
  const town = disc(TOWN_CLEAR * mainR)
  const lakeRings = lakes(coast, [town], spec.lakes, draw)
  const roughRings = rough(coast, [town, ...lakeRings], spec.rough, draw)
  const land: Polygon[] =
    lakeRings.length > 0
      ? clip(
          coast.land,
          lakeRings.map((ring) => [ring]),
          "difference",
        )
      : coast.land
  const main = land.reduce((a, b) => (Math.abs(area(b[0] ?? [])) > Math.abs(area(a[0] ?? [])) ? b : a))
  return {
    centre: snap(coast.centre),
    bounds: coast.bounds,
    coast: main[0] ?? [],
    land,
    sea: coast.sea,
    lakes: lakeRings,
    rough: roughRings,
    bays: coast.bays,
    headlands: coast.headlands,
    islets: coast.islets,
    ground: groundGrid({ land, lakes: lakeRings, rough: roughRings }),
  }
}

/** A circle round the origin (CCW). */
function disc(radius: number): Ring {
  return Array.from({ length: DISC_POINTS }, (_, i) => {
    const t = (2 * Math.PI * i) / DISC_POINTS
    return snap([radius * DMath.cos(t), radius * DMath.sin(t)])
  })
}
