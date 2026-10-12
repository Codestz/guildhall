/**
 * Stage 1 (plan §4): the ground a town is laid out on. The map is mostly sea with one island in its
 * middle half (room for ships, and the coast is the edge of the world), flat: land at one level,
 * water below it. The island is about 4.4r across, a wobbled outline round its own centre with a
 * bay or three bitten into it and a headland or two pushed out, and now and then a tiny islet
 * offshore. The town (its centre is the origin, the gates stand round it at r) does not sit in the
 * island's middle: with a harbour it sits by the coast on the bearing's side, its sheltered bay's near
 * shore 0.55r out along the bearing between two headlands, and the rest of the island is countryside
 * (fields, woods, W8's points of interest). Without one it still sits off-centre, well back from
 * every shore. The plaza is pulled toward the water; the castle stands on the town's edge away from
 * it, so the wall street goes round its far side. Every draw is `roll(seed, "<what>:site")`. The
 * coast itself is the landform's (land/coast.ts), shared with the island level. Framed (ADR 011), the
 * island has already drawn the coast: the town takes its land and water from the frame, and its
 * bounds are the frame's box.
 */
import { DMath, roll } from "@guildhall/core"
import { axes, type Rect } from "../geom/obb.ts"
import { bbox, type Polygon, type Ring } from "../geom/poly.ts"
import { add, round3, scale, snap, type Vec2 } from "../geom/vec.ts"
import { islandCoast } from "../land/coast.ts"
import { normalizeSpec, TIER_DEFAULTS } from "./spec.ts"
import type { Site, TownFrame, TownSpecInput } from "./types.ts"

/** The island's mean radius round its own centre, in town radii. */
export const ISLAND = 2.2
/** How far the plaza is pulled toward the water, in radii. */
const PULL = 0.15
/** How far the castle ground reaches past the gate circle, metres: the wall street goes round it. */
const CASTLE_OUT = 5

export function site(spec: TownSpecInput, frame?: TownFrame): Site {
  const s = normalizeSpec(spec)
  const r = s.radius
  const draw = (salt: string) => roll(s.seed, `${salt}:site`)
  const toWater: Vec2 | null = s.harbour ? [DMath.cos(s.harbour.bearing), DMath.sin(s.harbour.bearing)] : null
  // The side of the town the island's coast is nearest on: the water's, else a rolled one.
  const lean = 2 * Math.PI * draw("lean")
  const side: Vec2 = toWater ?? [DMath.cos(lean), DMath.sin(lean)]
  const {
    land,
    bounds,
    sea: water,
  } = frame
    ? { land: frame.land, bounds: boxOf(frame.land), sea: frame.water }
    : islandCoast(s.seed, { r, side, harbour: toWater !== null }, ISLAND)

  const long = TIER_DEFAULTS[s.tier].plaza
  const plazaRect: Rect = {
    c: snap(toWater ? scale(toWater, PULL * r) : [0, 0]),
    rot: round3(Math.PI * draw("plaza-rot")),
    w: long,
    d: round3(long * (0.6 + 0.2 * draw("plaza-short"))),
  }
  const plaza = roundedRect(plazaRect, 0.25 * plazaRect.d)

  const castleSite = s.landmark === "castle" ? castleRect(toWater, r, draw) : null
  return { radius: r, bounds, land, water, plaza, castleSite }
}

/** The box round the land's outer rings, counter-clockwise. */
function boxOf(land: readonly Polygon[]): Ring {
  const [lo, hi] = bbox(land.flatMap((poly) => poly[0] ?? []))
  return [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]]
}

/** A rect's outline with its corners rounded by `k` metres, counter-clockwise. */
function roundedRect(rect: Rect, k: number): Ring {
  const { x, z } = axes(rect.rot)
  const hx = rect.w / 2 - k
  const hz = rect.d / 2 - k
  const corners: [number, number, number][] = [
    [hx, -hz, -Math.PI / 2],
    [hx, hz, 0],
    [-hx, hz, Math.PI / 2],
    [-hx, -hz, Math.PI],
  ]
  const ring: Ring = []
  for (const [cx, cz, start] of corners)
    for (let j = 0; j <= 3; j++) {
      const t = start + (j * Math.PI) / 6
      const lx = cx + k * DMath.cos(t)
      const lz = cz + k * DMath.sin(t)
      ring.push(snap(add(rect.c, add(scale(x, lx), scale(z, lz)))))
    }
  return ring
}

/**
 * The castle's ground: 40–60 m a side (at most 0.4r), on the town's edge away from the water (else at
 * a rolled bearing), reaching a few metres past the gate circle so the wall street goes round its far
 * side. Its local +z points out of the town, so its front (−z) faces the market.
 */
function castleRect(toWater: Vec2 | null, r: number, draw: (salt: string) => number): Rect {
  const turn = 2 * Math.PI * draw("castle-dir")
  const away: Vec2 = toWater ? scale(toWater, -1) : [DMath.cos(turn), DMath.sin(turn)]
  const size = (salt: string) => round3(Math.min(40 + 20 * draw(salt), 0.4 * r))
  const w = size("castle-w")
  const d = size("castle-d")
  return { c: snap(scale(away, r - d / 2 + CASTLE_OUT)), rot: round3(DMath.atan2(away[0], away[1])), w, d }
}
