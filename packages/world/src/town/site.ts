/**
 * Stage 1 (plan §4): the ground a town is laid out on. Flat land in a 2.6r square, a harbour's water
 * cut out of one side (a wobbled superellipse whose near shore is 0.55r out along the bearing and
 * whose far side runs past the bounds), the plaza near the centre pulled toward the water, and the
 * castle's ground beside the plaza on the side away from it. Every draw is `roll(seed, "<what>:site")`.
 */
import { DMath, roll } from "@guildhall/core"
import { axes, type Rect } from "../geom/obb.ts"
import { clip, type Ring } from "../geom/poly.ts"
import { add, dot, perp, round3, scale, snap, type Vec2 } from "../geom/vec.ts"
import { normalizeSpec, TIER_DEFAULTS } from "./spec.ts"
import type { Site, TownSpecInput } from "./types.ts"

/** Half the bounds' side, in radii. */
const HALF_BOUNDS = 1.3
/** The near shore's distance from the centre, in radii. */
const SHORE = 0.55
/** How far the plaza is pulled toward the water, in radii. */
const PULL = 0.15
/** Points round the lake's outline. */
const LAKE_POINTS = 48
/** The street between the plaza and the castle ground, metres. */
const CASTLE_GAP = 8

export function site(spec: TownSpecInput): Site {
  const s = normalizeSpec(spec)
  const r = s.radius
  const draw = (salt: string) => roll(s.seed, `${salt}:site`)
  const h = HALF_BOUNDS * r
  const bounds: Ring = [snap([-h, -h]), snap([h, -h]), snap([h, h]), snap([-h, h])]

  const toWater: Vec2 | null = s.harbour ? [DMath.cos(s.harbour.bearing), DMath.sin(s.harbour.bearing)] : null
  const lake = toWater ? lakeRing(toWater, r, draw) : null
  const water = lake ? clip(lake, bounds, "intersection").map((poly) => poly[0] as Ring) : []
  const land = lake ? clip(bounds, lake, "difference") : [[bounds]]

  const long = TIER_DEFAULTS[s.tier].plaza
  const plazaRect: Rect = {
    c: snap(toWater ? scale(toWater, PULL * r) : [0, 0]),
    rot: round3(Math.PI * draw("plaza-rot")),
    w: long,
    d: round3(long * (0.6 + 0.2 * draw("plaza-short"))),
  }
  const plaza = roundedRect(plazaRect, 0.25 * plazaRect.d)

  const castleSite = s.landmark === "castle" ? castleRect(plazaRect, toWater, r, draw) : null
  return { radius: r, bounds, land, water, plaza, castleSite }
}

/** The lake outline: a superellipse along the bearing, wobbled everywhere but at its near shore. */
function lakeRing(dir: Vec2, r: number, draw: (salt: string) => number): Ring {
  const a = r * (0.6 + 0.2 * draw("lake-a")) // semi-axis along the bearing
  const b = r * (0.9 + 0.4 * draw("lake-b")) // semi-axis across it
  const n = 2.5 + 1.5 * draw("lake-n")
  const k = draw("lake-k") < 0.5 ? 2 : 3
  const phase = 2 * Math.PI * draw("lake-phase")
  const centre = scale(dir, SHORE * r + a)
  const side = perp(dir)
  const curve = (t: number) => (t === 0 ? 0 : Math.sign(t) * DMath.pow(Math.abs(t), 2 / n))
  return Array.from({ length: LAKE_POINTS }, (_, i) => {
    const theta = (2 * Math.PI * i) / LAKE_POINTS
    const c = DMath.cos(theta)
    // θ = π is the near shore (local −u, toward the town): the wobble fades to nothing there.
    const wobble = 1 + 0.08 * ((1 + c) / 2) * DMath.sin(k * theta + phase)
    const u = a * curve(c) * wobble
    const v = b * curve(DMath.sin(theta)) * wobble
    return snap(add(centre, add(scale(dir, u), scale(side, v))))
  })
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

/** The castle's ground: 40–60 m a side (at most 0.4r), across a street from the plaza, away from the water. */
function castleRect(plaza: Rect, toWater: Vec2 | null, r: number, draw: (salt: string) => number): Rect {
  const turn = 2 * Math.PI * draw("castle-dir")
  const away: Vec2 = toWater ? scale(toWater, -1) : [DMath.cos(turn), DMath.sin(turn)]
  const size = (salt: string) => round3(Math.min(40 + 20 * draw(salt), 0.4 * r))
  const w = size("castle-w")
  const d = size("castle-d")
  const { x, z } = axes(plaza.rot)
  const reach = (Math.abs(dot(away, x)) * plaza.w + Math.abs(dot(away, z)) * plaza.d) / 2
  // Local +z points away from the plaza, so the castle's front (−z) faces it.
  return {
    c: snap(add(plaza.c, scale(away, reach + CASTLE_GAP + d / 2))),
    rot: round3(DMath.atan2(away[0], away[1])),
    w,
    d,
  }
}
