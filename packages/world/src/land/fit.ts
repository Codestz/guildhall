/**
 * What the landform's inland features (lakes, rough ground) share: the main island they sit in,
 * candidate centres scattered over it, and the test that a feature's outline fits: inside the island,
 * back from its shore, clear of what it must avoid and of the features already placed.
 */
import { distTo, lineIndex } from "../geom/line.ts"
import { area, bbox, centroid, contains, insideIndex, type Polygon, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { dist, snap, type Vec2 } from "../geom/vec.ts"
import type { Coast } from "./coast.ts"

export interface Island {
  /** The main island (the bay cut, islets left out). */
  poly: Polygon
  /** Metres from p to the nearest shore, or `max` when the shore is further. */
  shore: (p: Vec2, max: number) => number
  /** Whether p is on the main island. */
  inside: (p: Vec2) => boolean
  /** Candidate centres over the island: one jittered point per 20 m cell, row by row. */
  sites: Vec2[]
}

/** The candidates' grid cell, metres. */
const SPACING = 20

export function island(coast: Coast, draw: Roll, salt: string): Island {
  const poly = coast.land.reduce((a, b) => (Math.abs(area(b[0] ?? [])) > Math.abs(area(a[0] ?? [])) ? b : a))
  const index = lineIndex(poly, true)
  const inside = insideIndex(poly)
  const [lo, hi] = bbox(poly[0] ?? [])
  const sites: Vec2[] = []
  for (let z = Math.floor(lo[1] / SPACING); z * SPACING < hi[1]; z++)
    for (let x = Math.floor(lo[0] / SPACING); x * SPACING < hi[0]; x++) {
      const p = snap([
        (x + 0.2 + 0.6 * draw(`${x}:${z}:${salt}-x`)) * SPACING,
        (z + 0.2 + 0.6 * draw(`${x}:${z}:${salt}-z`)) * SPACING,
      ])
      if (inside(p)) sites.push(p)
    }
  return { poly, shore: (p, max) => index.near(p, max), inside, sites }
}

export interface Clearance {
  /** Every point at least this far from the shore, metres. */
  shore: number
  /** Rings the outline must keep out of, and how far from them, metres. */
  avoid: readonly Ring[]
  gap: number
  /** Features already placed, and how far apart outline to outline and centre to centre, metres. */
  placed: readonly Ring[]
  apart: number
  centres: number
}

/** Whether `ring` fits on the island with the clearances kept. */
export function fits(ring: Ring, land: Island, c: Clearance): boolean {
  for (const p of ring) {
    if (!land.inside(p)) return false
    if (land.shore(p, c.shore) < c.shore) return false
  }
  const apart = (others: readonly Ring[], gap: number) =>
    others.every(
      (o) =>
        !o.some((q) => contains(ring, q, 0)) &&
        ring.every((p) => !contains(o, p, 0) && (gap <= 0 || distTo(p, o, true) >= gap)),
    )
  if (!apart(c.avoid, c.gap)) return false
  if (!apart(c.placed, c.apart)) return false
  const mid = centroid(ring)
  return c.placed.every((o) => dist(centroid(o), mid) >= c.centres)
}
