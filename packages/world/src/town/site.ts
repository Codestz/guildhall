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
 * it, so the wall street goes round its far side. Every draw is `roll(seed, "<what>:site")`.
 */
import { DMath, roll } from "@guildhall/core"
import { axes, type Rect } from "../geom/obb.ts"
import { bbox, centroid, clip, type Polygon, type Ring, splitByLine } from "../geom/poly.ts"
import { add, at, dist, dot, len, perp, round3, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { normalizeSpec, TIER_DEFAULTS } from "./spec.ts"
import type { Site, TownSpecInput } from "./types.ts"

/** The island's mean radius round its own centre, in town radii. */
export const ISLAND = 2.2
/** How far the island's centre lies from the town's, away from the water (or the lean), in radii. */
const OFFSET = { harbour: 1.3, inland: 0.5 } as const
/** The coast keeps at least this far from the town's centre, in radii (the bay is cut afterwards). */
const COAST_MIN = { harbour: 1, inland: 1.45 } as const
/** The sea round the island on each side, as a share of the island's size: the island is the map's middle half. */
const SEA = 0.5
/** The bay's near shore lies this far from the town's centre along the bearing, in radii. */
const SHORE = 0.55
/** How far the plaza is pulled toward the water, in radii. */
const PULL = 0.15
/** Points round the island's outline, and round the bay's. */
const COAST_POINTS = 128
const BAY_POINTS = 48
/** The coast's noise round the island: [cells round the circle, amplitude as a share of the radius]. */
const COAST_OCTAVES: readonly (readonly [number, number])[] = [
  [7, 0.1],
  [19, 0.04],
  [53, 0.015],
]
/** How far the castle ground reaches past the gate circle, metres: the wall street goes round it. */
const CASTLE_OUT = 5

export function site(spec: TownSpecInput): Site {
  const s = normalizeSpec(spec)
  const r = s.radius
  const draw = (salt: string) => roll(s.seed, `${salt}:site`)
  const toWater: Vec2 | null = s.harbour ? [DMath.cos(s.harbour.bearing), DMath.sin(s.harbour.bearing)] : null
  // The side of the town the island's coast is nearest on: the water's, else a rolled one.
  const lean = 2 * Math.PI * draw("lean")
  const side: Vec2 = toWater ?? [DMath.cos(lean), DMath.sin(lean)]
  const mode = toWater ? "harbour" : "inland"
  const centre = scale(side, -OFFSET[mode] * r)

  const coast = islandRing(centre, side, r, COAST_MIN[mode] * r, toWater !== null, draw)
  const islets = isletRings(centre, side, r, coast, draw)
  const island: Polygon[] = toWater ? clip(coast, bayRing(toWater, r, draw), "difference") : [[coast]]
  const land: Polygon[] = [...island, ...islets.map((ring) => [ring])]

  // The map: a square twice the island's size, round it.
  const [lo, hi] = bbox([...coast, ...islets.flat()])
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1])
  const mid = scale(add(lo, hi), 0.5)
  const h = (size * (1 + 2 * SEA)) / 2
  const bounds: Ring = [
    snap([mid[0] - h, mid[1] - h]),
    snap([mid[0] + h, mid[1] - h]),
    snap([mid[0] + h, mid[1] + h]),
    snap([mid[0] - h, mid[1] + h]),
  ]
  const water = seaRings(clip(bounds, land, "difference"), centre, side)

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

/** A bump of the coast's radius round angle `t0` (radians), `width` wide, as a share of the radius. */
interface Bump {
  t0: number
  width: number
  amp: number
}

/**
 * The island's outline (CCW) round `centre`: a radius wobbling with a few low harmonics, headlands
 * (bumps out) and bays (dips in). With a harbour, two headlands flank the bay's mouth on the `side`
 * the town is on; the other bays and headlands keep to the far side, away from the town. No point
 * comes nearer the town's centre than `min`.
 */
function islandRing(
  centre: Vec2,
  side: Vec2,
  r: number,
  min: number,
  harbour: boolean,
  draw: (salt: string) => number,
): Ring {
  const R = ISLAND * r
  const town = DMath.atan2(side[1], side[0])
  // The coast's wobble: value noise round the circle, a broad octave and two ragged ones.
  const octaves = COAST_OCTAVES.map(([cells, amp], o) => ({
    amp,
    values: Array.from({ length: cells }, (_, i) => 2 * draw(`${o}:${i}:coast`) - 1),
  }))
  const bumps: Bump[] = []
  if (harbour)
    for (const sign of [-1, 1])
      bumps.push({
        t0: town + sign * (0.5 + 0.15 * draw(`${sign}:cape-at`)),
        width: 0.2,
        amp: 0.16 + 0.1 * draw(`${sign}:cape`),
      })
  // The far side: 1–3 bays (harbour or not, at least one in all), maybe one headland.
  const far = (salt: string) => town + Math.PI + (2 * draw(salt) - 1) * (Math.PI - 1.4)
  const bays = (harbour ? 0 : 1) + Math.floor(3 * draw("bays"))
  for (let i = 0; i < Math.min(bays, 2); i++)
    bumps.push({
      t0: far(`${i}:bay-at`),
      width: 0.14 + 0.08 * draw(`${i}:bay-w`),
      amp: -(0.15 + 0.12 * draw(`${i}:bay`)),
    })
  if (draw("cape") < 0.6) bumps.push({ t0: far("cape-at"), width: 0.15, amp: 0.1 + 0.08 * draw("cape-amp") })

  const radius = (t: number) => {
    let k = 1
    for (const o of octaves) {
      const x = ((((t / (2 * Math.PI)) % 1) + 1) % 1) * o.values.length
      const i = Math.floor(x)
      const f = x - i
      const e = f * f * (3 - 2 * f)
      k += o.amp * (at(o.values, i) * (1 - e) + at(o.values, i + 1) * e)
    }
    for (const b of bumps) {
      const d = wrap(t - b.t0) / b.width
      k += b.amp * DMath.exp(-d * d)
    }
    return R * k
  }
  return Array.from({ length: COAST_POINTS }, (_, i) => {
    const t = (2 * Math.PI * i) / COAST_POINTS
    const dir: Vec2 = [DMath.cos(t), DMath.sin(t)]
    let rr = radius(t)
    // Pushed out along its ray where it would come too near the town.
    while (len(add(centre, scale(dir, rr))) < min) rr += 0.02 * r
    return snap(add(centre, scale(dir, rr)))
  })
}

/** The harbour's bay: a superellipse whose near shore is 0.55r out along the bearing, opening to the sea. */
function bayRing(dir: Vec2, r: number, draw: (salt: string) => number): Ring {
  const a = r * (0.55 + 0.2 * draw("bay-a")) // semi-axis along the bearing: out past the coast
  const b = r * (0.9 + 0.3 * draw("bay-b")) // semi-axis across it
  const n = 2.5 + 1.5 * draw("bay-n")
  const k = draw("bay-k") < 0.5 ? 2 : 3
  const phase = 2 * Math.PI * draw("bay-phase")
  const centre = scale(dir, SHORE * r + a)
  const across = perp(dir)
  const curve = (t: number) => (t === 0 ? 0 : Math.sign(t) * DMath.pow(Math.abs(t), 2 / n))
  return Array.from({ length: BAY_POINTS }, (_, i) => {
    const theta = (2 * Math.PI * i) / BAY_POINTS
    const c = DMath.cos(theta)
    // θ = π is the near shore (local −u, toward the town): the wobble fades to nothing there.
    const wobble = 1 + 0.08 * ((1 + c) / 2) * DMath.sin(k * theta + phase)
    const u = a * curve(c) * wobble
    const v = b * curve(DMath.sin(theta)) * wobble
    return snap(add(centre, add(scale(dir, u), scale(across, v))))
  })
}

/** 0–2 tiny islets off the island's far side, clear of its coast and of each other. */
function isletRings(
  centre: Vec2,
  side: Vec2,
  r: number,
  coast: Ring,
  draw: (salt: string) => number,
): Ring[] {
  const out: Ring[] = []
  const town = DMath.atan2(side[1], side[0])
  const count = Math.floor(3 * draw("islets"))
  for (let i = 0; i < count; i++) {
    const t = town + Math.PI + (2 * draw(`${i}:islet-at`) - 1) * (Math.PI - 1.2)
    const dir: Vec2 = [DMath.cos(t), DMath.sin(t)]
    const size = r * (0.06 + 0.06 * draw(`${i}:islet-size`))
    // How far the coast reaches that way, over the stretch facing it.
    const facing = coast.filter((p) => Math.abs(dot(sub(p, centre), perp(dir))) < 0.6 * r)
    const shore = Math.max(...facing.map((p) => dot(sub(p, centre), dir)))
    const c = add(centre, scale(dir, shore + size + r * (0.25 + 0.3 * draw(`${i}:islet-out`))))
    if (out.some((o) => dist(centroid(o), c) < 4 * size)) continue
    out.push(
      Array.from({ length: 10 }, (_, j) => {
        const a = (2 * Math.PI * j) / 10
        const k = 1 + 0.2 * (2 * draw(`${i}:${j}:islet`) - 1)
        return snap(add(c, [size * k * DMath.cos(a), size * k * DMath.sin(a)]))
      }),
    )
  }
  return out
}

/**
 * The sea as outer rings (CCW, no holes): cut in two across the island's centre (square to the town's
 * side), and any piece still holding an islet cut through it. The piece on the town's side comes first.
 */
function seaRings(sea: Polygon[], centre: Vec2, side: Vec2): Ring[] {
  const cut = splitByLine(sea, centre, perp(side))
  const free = (poly: Polygon): Ring[] => {
    const hole = poly[1]
    if (!hole) return [at(poly, 0)]
    const { left, right } = splitByLine([poly], centroid(hole), side)
    return [...left, ...right].flatMap(free)
  }
  const rings = [...cut.left, ...cut.right].flatMap(free)
  const lead = (ring: Ring) => dot(sub(centroid(ring), centre), side)
  return rings.sort((p, q) => lead(q) - lead(p))
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

const wrap = (t: number): number => {
  let x = t
  while (x > Math.PI) x -= 2 * Math.PI
  while (x < -Math.PI) x += 2 * Math.PI
  return x
}
