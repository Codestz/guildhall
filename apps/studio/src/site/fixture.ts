/**
 * The site screen's pure side: a hand-made `TownDraw` ground and water over a real `site()` (plan §6
 * R3: a lake, a cobble ribbon, a field, footprints), and where the few library pieces stand.
 */
import { roll } from "@guildhall/core"
import {
  add,
  axes,
  clip,
  contains,
  type MultiPolygon,
  norm,
  offset,
  type Ring,
  ribbon,
  type Site,
  scale,
  shapeArea,
  type Tier,
  type TownDraw,
  type Vec2,
} from "@guildhall/world"

/** How far the sea runs past the site's bounds, in radii. */
const SEA = 3.5

export interface SiteQuery {
  seed: number
  tier: Tier
  /** Radians toward the lake; null for a town without one. */
  harbour: number | null
  hour: number
}

/** The lake lower-left of the concept camera (azimuth 40°). */
const DEFAULT_HARBOUR = 1.66

export function parseSiteQuery(q: URLSearchParams, tiers: readonly Tier[]): SiteQuery {
  const num = (key: string, fallback: number) => {
    const v = Number(q.get(key))
    return q.has(key) && Number.isFinite(v) ? v : fallback
  }
  const tier = q.get("tier") as Tier | null
  const harbour = q.get("harbour")
  return {
    seed: Math.max(0, Math.floor(num("seed", 3))),
    tier: tier && tiers.includes(tier) ? tier : "village",
    harbour: harbour === "none" ? null : num("harbour", DEFAULT_HARBOUR),
    hour: num("hour", 17.5),
  }
}

/** One piece to stand: a catalog id (or a stand-in box size), where, and its turn in radians. */
export interface Stand {
  role: "house" | "tree" | "hero"
  at: Vec2
  rot: number
}

const square = (h: number): Ring => [
  [-h, -h],
  [h, -h],
  [h, h],
  [-h, h],
]

/** The biggest polygon of the land: the ground takes one outline with holes. */
function mainLand(site: Site): Ring[] {
  return [...site.land].sort((a, b) => shapeArea(b) - shapeArea(a))[0] ?? [square(site.radius)]
}

/** The houses round the plaza, the trees beyond them and the hero at the plaza's edge. */
export function stands(site: Site, seed: number): Stand[] {
  const c = centre(site.plaza)
  const land = mainLand(site)
  const { x, z } = axes(0.35)
  const out: Stand[] = [{ role: "hero", at: add(c, [3, 9]), rot: 0.6 }]
  const ring = [
    [-1, -1],
    [0, -1.15],
    [1, -1],
    [1.2, 0.2],
    [-1.2, 0.2],
  ] as const
  for (const [u, v] of ring) {
    const at = add(c, add(scale(x, u * 22), scale(z, v * 20)))
    if (contains(land, at)) out.push({ role: "house", at, rot: Math.atan2(c[0] - at[0], c[1] - at[1]) })
  }
  for (let i = 0; i < 24; i++) {
    const a = 2 * Math.PI * roll(seed, `${i}:site-tree-a`)
    const r = 32 + 30 * roll(seed, `${i}:site-tree-r`)
    const at = add(c, [r * Math.cos(a), r * Math.sin(a)])
    if (contains(land, at) && !site.water.some((w) => contains(w, at)))
      out.push({ role: "tree", at, rot: 2 * Math.PI * roll(seed, `${i}:site-tree-turn`) })
  }
  return out
}

function centre(ring: readonly Vec2[]): Vec2 {
  const sum = ring.reduce((s, p) => add(s, p), [0, 0] as Vec2)
  return scale(sum, 1 / ring.length)
}

/**
 * The ground and water a town of this site would draw: the plaza paved, a cobble street from it to the
 * shore (or across the town), a dirt lane, a field, a garden and a sand beach by the street's end; the
 * lake plus a sea all round the bounds, with the whole coast as the shore. `footprints` darken the ground.
 */
export function siteDraw(site: Site, footprints: Vec2[][]): Pick<TownDraw, "ground" | "water"> {
  const [outer, ...holes] = mainLand(site)
  const c = centre(site.plaza)
  const r = site.radius
  const lake = site.water[0]
  const toShore: Vec2 = lake ? norm(add(centre(lake), scale(c, -1))) : [1, 0]
  const street = ribbon([add(c, scale(toShore, -0.9 * r)), c, add(c, scale(toShore, 0.75 * r))], 6)
  const side: Vec2 = [-toShore[1], toShore[0]]
  const lane = ribbon(
    [c, add(c, add(scale(side, 0.45 * r), scale(toShore, -0.2 * r))), add(c, scale(side, 1.1 * r))],
    3.5,
  )
  const fieldAt = add(c, add(scale(side, -0.6 * r), scale(toShore, -0.45 * r)))
  const field = rotRect(fieldAt, 34, 22, 0.3)
  const garden = rotRect(add(c, add(scale(side, 0.3 * r), scale(toShore, -0.45 * r))), 14, 10, 0.35)
  const beach: MultiPolygon = lake
    ? clip(offset(lake, 7), [[rotRect(add(c, scale(toShore, 0.6 * r)), 0.6 * r, 0.6 * r, 0)]], "intersection")
    : []
  const overlays: TownDraw["ground"]["overlays"] = [
    { kind: "field", poly: field },
    { kind: "garden", poly: garden },
    ...beach.map((poly) => ({ kind: "sand" as const, poly: poly[0] as Ring })),
    { kind: "dirt", poly: lane },
    { kind: "cobble", poly: street },
    { kind: "plaza", poly: site.plaza },
  ]

  const h = site.bounds[2]?.[0] ?? r
  const s = h + SEA * r
  // The sea as four strips round the bounds (the water takes outlines without holes), plus the lake.
  const sea: Ring[] = [rect(-s, -s, s, -h), rect(-s, h, s, s), rect(-s, -h, -h, h), rect(h, -h, s, h)]
  const coast = [outer ?? [], ...holes].map((ring) => [...ring, ring[0] as Vec2])
  return {
    ground: { land: outer ?? [], holes, overlays, footprints },
    water: { polys: [...site.water, ...sea], level: -0.6, shore: coast },
  }
}

const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

function rotRect(c: Vec2, w: number, d: number, rot: number): Ring {
  const { x, z } = axes(rot)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => add(c, add(scale(x, ((u as number) * w) / 2), scale(z, ((v as number) * d) / 2))))
}
