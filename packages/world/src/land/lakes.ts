/**
 * Inland lakes (plan-w8 §4.0): 0–2 wobbled superellipses of 1.5–6 k m², well inside the island:
 * every shore point at least 40 m from the coast (the centre 70 m), outside whatever the caller
 * keeps them from (the town and its fields), and 120 m from each other. A lake that fits nowhere at
 * its size is dropped, never forced. The island cuts them out of its land as holes.
 */
import { DMath } from "@guildhall/core"
import { area, orient, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, snap, type Vec2 } from "../geom/vec.ts"
import type { Coast } from "./coast.ts"
import { fits, island } from "./fit.ts"

/** A lake's area, m². */
const AREA = [1500, 6000] as const
/** Metres from the coast: every shore point, and the centre. */
const COAST_GAP = 40
const CENTRE_GAP = 70
/** Metres between lake centres, and between their shores. */
const APART = 120
const SHORE_APART = 40
/** Points round a lake's shore. */
const POINTS = 40

/** Up to `count` lakes (CCW rings), each drawn from `draw("<i>:lake…")`, kept out of `avoid`. */
export function lakes(coast: Coast, avoid: readonly Ring[], count: 0 | 1 | 2, draw: Roll): Ring[] {
  if (count === 0) return []
  const land = island(coast, draw, "lake-site")
  const centres = land.sites.filter((p) => land.shore(p, CENTRE_GAP) >= CENTRE_GAP)
  const out: Ring[] = []
  for (let i = 0; i < count; i++) {
    // The candidates in a seeded order of their own: the second lake never reshuffles the first.
    const order = centres
      .map((p, k) => ({ p, key: draw(`${i}:${k}:lake-pick`) }))
      .sort((a, b) => a.key - b.key)
    const shape = lakeShape(i, draw)
    for (const { p } of order) {
      const ring = shape.map((q) => snap(add(p, q)))
      const clear = { shore: COAST_GAP, avoid, gap: 0, placed: out, apart: SHORE_APART, centres: APART }
      if (fits(ring, land, clear)) {
        out.push(ring)
        break
      }
    }
  }
  return out
}

/**
 * Lake `i`'s outline round the origin (CCW): a superellipse (exponent 2–3, aspect up to 1.7, turned)
 * with two soft harmonics on its radius, scaled to its rolled area.
 */
function lakeShape(i: number, draw: Roll): Vec2[] {
  const d = (salt: string) => draw(`${i}:lake-${salt}`)
  const n = 2 + d("n")
  const aspect = 1 + 0.7 * d("aspect")
  const rot = Math.PI * d("rot")
  const waves = [2, 3].map((k) => ({
    k,
    amp: 0.06 + 0.06 * d(`${k}-amp`),
    phase: 2 * Math.PI * d(`${k}-phase`),
  }))
  const raw = Array.from({ length: POINTS }, (_, j): Vec2 => {
    const t = (2 * Math.PI * j) / POINTS
    const c = DMath.cos(t)
    const s = DMath.sin(t)
    let rr = DMath.pow(DMath.pow(Math.abs(c), n) + DMath.pow(Math.abs(s), n), -1 / n)
    for (const w of waves) rr *= 1 + w.amp * DMath.sin(w.k * t + w.phase)
    const x = aspect * rr * c
    const z = rr * s
    return [x * DMath.cos(rot) - z * DMath.sin(rot), x * DMath.sin(rot) + z * DMath.cos(rot)]
  })
  const target = AREA[0] + (AREA[1] - AREA[0]) * d("area")
  const k = Math.sqrt(target / Math.abs(area(raw)))
  return orient(raw.map(([x, z]): Vec2 => [k * x, k * z]))
}
