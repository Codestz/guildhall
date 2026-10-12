/**
 * The island's coast (plan-w8 §4.0, moved from town/site.ts byte for byte): the map is mostly sea
 * with one island in its middle half, a wobbled outline round its own centre with a bay or three
 * bitten into it and a headland or two pushed out, and now and then a tiny islet offshore. The town
 * it is drawn for stands at the origin: with a harbour the island's centre lies 1.3r behind it,
 * away from the water, and the harbour's bay is cut in front of it; without one it lies 0.5r off a
 * rolled side. Bays and headlands are recorded as data for the island's later stages. Every draw is
 * `roll(seed, "<what>:site")`, the salts the town has always used, so a town's coast is unchanged.
 */
import { DMath, roll } from "@guildhall/core"
import { intersect } from "../geom/line.ts"
import { bbox, centroid, clip, type Polygon, type Ring, splitByLine } from "../geom/poly.ts"
import { add, at, dist, dot, len, norm, perp, scale, snap, sub, type Vec2 } from "../geom/vec.ts"

/** How far the island's centre lies from the town's, away from the water (or the lean), in radii. */
const OFFSET = { harbour: 1.3, inland: 0.5 } as const
/** The coast keeps at least this far from the town's centre, in radii (the bay is cut afterwards). */
const COAST_MIN = { harbour: 1, inland: 1.45 } as const
/** The sea round the island on each side, as a share of the island's size: the island is the map's middle half. */
const SEA = 0.5
/** The bay's near shore lies this far from the town's centre along the bearing, in radii. */
const SHORE = 0.55
/** Points round the island's outline, and round the bay's. */
const COAST_POINTS = 128
const BAY_POINTS = 48
/** The coast's noise round the island: [cells round the circle, amplitude as a share of the radius]. */
const COAST_OCTAVES: readonly (readonly [number, number])[] = [
  [7, 0.1],
  [19, 0.04],
  [53, 0.015],
]
/** A far bay's mouth: the coast this many bump widths either side of its innermost point. */
const MOUTH = 1.4

/** The town the coast is drawn for: its radius, the unit side the coast is nearest on, and whether it has a harbour there. */
export interface CoastTown {
  r: number
  side: Vec2
  harbour: boolean
}

/** A bay of the coast: the harbour's (`main`) or a far-side dip. Same shape as the island's `Bay`. */
export interface CoastBay {
  id: string
  /** The innermost shore point. */
  shore: Vec2
  mouth: [Vec2, Vec2]
  /** Unit direction out to sea. */
  out: Vec2
  main: boolean
}

export interface Coast {
  /** The island's own centre (the town is at the origin). */
  centre: Vec2
  /** The island's outline before the harbour's bay is cut (CCW). */
  ring: Ring
  /** The harbour's water, null without a harbour. */
  bay: Ring | null
  islets: Ring[]
  /** The island minus its bay, then the islets. */
  land: Polygon[]
  /** The map: a square twice the island's size round it. */
  bounds: Ring
  /** The sea as plain rings, the town's side first. */
  sea: Ring[]
  bays: CoastBay[]
  /** The capes' tips. */
  headlands: Vec2[]
}

/** A bump of the coast's radius round angle `t0` (radians), `width` wide, as a share of the radius. */
interface Bump {
  t0: number
  width: number
  amp: number
}

/**
 * The island round a town at the origin, `scaleR` town radii in mean radius. `farBays` is the fewest
 * far-side bays it gets (the island level asks for one: a second bay is a reason for a road); left
 * at 0 the coast is exactly the one a town has always had.
 */
export function islandCoast(seed: number, town: CoastTown, scaleR: number, farBays: 0 | 1 | 2 = 0): Coast {
  const { r, side, harbour } = town
  const draw = (salt: string) => roll(seed, `${salt}:site`)
  const mode = harbour ? "harbour" : "inland"
  const centre = scale(side, -OFFSET[mode] * r)

  const { ring, bumps } = islandRing(centre, side, r, scaleR, COAST_MIN[mode] * r, harbour, farBays, draw)
  const islets = isletRings(centre, side, r, ring, draw)
  const bay = harbour ? bayRing(side, r, draw) : null
  const island: Polygon[] = bay ? clip(ring, bay, "difference") : [[ring]]
  const land: Polygon[] = [...island, ...islets.map((ring) => [ring])]

  const [lo, hi] = bbox([...ring, ...islets.flat()])
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1])
  const mid = scale(add(lo, hi), 0.5)
  const h = (size * (1 + 2 * SEA)) / 2
  const bounds: Ring = [
    snap([mid[0] - h, mid[1] - h]),
    snap([mid[0] + h, mid[1] - h]),
    snap([mid[0] + h, mid[1] + h]),
    snap([mid[0] - h, mid[1] + h]),
  ]
  const sea = seaRings(clip(bounds, land, "difference"), centre, side)

  // Ring point i lies at angle 2πi/N round the centre: a bump's tip is the point nearest its angle.
  const tip = (t: number) => at(ring, Math.round((t / (2 * Math.PI)) * COAST_POINTS))
  const bays: CoastBay[] = []
  if (bay) bays.push(mainBay(bay, ring, side, r))
  bumps
    .filter((b) => b.amp < 0)
    .forEach((b, i) => {
      const shore = tip(b.t0)
      bays.push({
        id: `bay-${i + 1}`,
        shore,
        mouth: [tip(b.t0 - MOUTH * b.width), tip(b.t0 + MOUTH * b.width)],
        out: snap(norm(sub(shore, centre))),
        main: false,
      })
    })
  const headlands = bumps.filter((b) => b.amp > 0).map((b) => tip(b.t0))
  return { centre, ring, bay, islets, land, bounds, sea, bays, headlands }
}

/** The harbour's bay as data: its near shore, where its outline leaves the coast, and the bearing out. */
function mainBay(bay: Ring, coast: Ring, dir: Vec2, r: number): CoastBay {
  const across = perp(dir)
  const hits: Vec2[] = []
  for (let i = 0; i < bay.length; i++)
    for (let j = 0; j < coast.length; j++) {
      const x = intersect(at(bay, i), at(bay, i + 1), at(coast, j), at(coast, j + 1))
      if (x) hits.push(snap(x.at))
    }
  const ends = hits.length >= 2 ? hits : bay
  const by = (p: Vec2) => dot(p, across)
  const lo = ends.reduce((a, b) => (by(b) < by(a) ? b : a))
  const hi = ends.reduce((a, b) => (by(b) > by(a) ? b : a))
  return { id: "bay-main", shore: snap(scale(dir, SHORE * r)), mouth: [lo, hi], out: snap(dir), main: true }
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
  scaleR: number,
  min: number,
  harbour: boolean,
  farBays: number,
  draw: (salt: string) => number,
): { ring: Ring; bumps: Bump[] } {
  const R = scaleR * r
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
  const bays = Math.max(farBays, (harbour ? 0 : 1) + Math.floor(3 * draw("bays")))
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
  const ring = Array.from({ length: COAST_POINTS }, (_, i): Vec2 => {
    const t = (2 * Math.PI * i) / COAST_POINTS
    const dir: Vec2 = [DMath.cos(t), DMath.sin(t)]
    let rr = radius(t)
    // Pushed out along its ray where it would come too near the town.
    while (len(add(centre, scale(dir, rr))) < min) rr += 0.02 * r
    return snap(add(centre, scale(dir, rr)))
  })
  return { ring, bumps }
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

const wrap = (t: number): number => {
  let x = t
  while (x > Math.PI) x -= 2 * Math.PI
  while (x < -Math.PI) x += 2 * Math.PI
  return x
}
