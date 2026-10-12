/**
 * Rough ground (plan-w8 §4.0): 0–2 rock fields, irregular blobs of 3–10 k m² on the island's far
 * side from the town (beyond the island's centre), where the quarry and the mine go and M4 raises
 * its hills. A field may run out to within 12 m of the coast, where it reads as a rocky shore, but
 * its centre stays 50 m inland; it keeps 25 m from whatever the caller keeps it from (the town, the
 * lakes) and 60 m from the other field. The farther from the town the likelier, with a seeded lean.
 * A field too big to fit anywhere shrinks (never below 3 k m²) before it is dropped.
 */
import { DMath } from "@guildhall/core"
import { area, orient, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, len, snap, type Vec2 } from "../geom/vec.ts"
import type { Coast } from "./coast.ts"
import { fits, island } from "./fit.ts"

/** A field's area, m². */
const AREA = [3000, 10000] as const
/** Metres from the coast: every point, and the centre. */
const COAST_GAP = 12
const CENTRE_GAP = 50
/** Metres from what it avoids, and from the other field (outline to outline, centre to centre). */
const AVOID_GAP = 25
const APART = 60
const CENTRES = 120
/** Points round a field's outline. */
const POINTS = 28
/** Each smaller try keeps this share of the area. */
const SHRINK = 0.75
/** How much the seeded lean weighs against farness from the town (both 0..1). */
const LEAN = 0.6

/**
 * Up to `count` rock fields (CCW rings) round a town at the origin, each drawn from
 * `draw("<i>:rough…")`, kept out of `avoid`.
 */
export function rough(coast: Coast, avoid: readonly Ring[], count: 0 | 1 | 2, draw: Roll): Ring[] {
  if (count === 0) return []
  const land = island(coast, draw, "rough-site")
  const behind = len(coast.centre)
  const sites = land.sites.filter((p) => len(p) >= behind && land.shore(p, CENTRE_GAP) >= CENTRE_GAP)
  const reach = Math.max(1, ...sites.map((p) => len(p) - behind))
  const out: Ring[] = []
  for (let i = 0; i < count; i++) {
    const order = sites
      .map((p, k) => ({ p, score: (len(p) - behind) / reach + LEAN * draw(`${i}:${k}:rough-pick`) }))
      .sort((a, b) => b.score - a.score)
    const clear = { shore: COAST_GAP, avoid, gap: AVOID_GAP, placed: out, apart: APART, centres: CENTRES }
    const ring = sizes(roughShape(i, draw)).reduce<Ring | null>(
      (found, shape) => found ?? place(shape, order, (ring) => fits(ring, land, clear)),
      null,
    )
    if (ring) out.push(ring)
  }
  return out
}

/** The shape at its rolled size, then a quarter smaller at a time down to the smallest field: a big field that fits nowhere shrinks before it is dropped. */
function sizes(shape: Vec2[]): Vec2[][] {
  const out = [shape]
  for (let a = Math.abs(area(shape)) * SHRINK; a >= AREA[0]; a *= SHRINK) {
    const k = Math.sqrt(a / Math.abs(area(shape)))
    out.push(shape.map(([x, z]): Vec2 => [k * x, k * z]))
  }
  return out
}

/** The shape at the first site where it fits, or null. */
function place(shape: Vec2[], order: { p: Vec2 }[], ok: (ring: Ring) => boolean): Ring | null {
  for (const { p } of order) {
    const ring = shape.map((q) => snap(add(p, q)))
    if (ok(ring)) return ring
  }
  return null
}

/** Field `i`'s outline round the origin (CCW): a lumpy blob (three harmonics and a jitter), scaled to its rolled area. */
function roughShape(i: number, draw: Roll): Vec2[] {
  const d = (salt: string) => draw(`${i}:rough-${salt}`)
  const waves = [2, 3, 5].map((k) => ({
    k,
    amp: (0.24 / k) * (1 + d(`${k}-amp`)),
    phase: 2 * Math.PI * d(`${k}-phase`),
  }))
  const raw = Array.from({ length: POINTS }, (_, j): Vec2 => {
    const t = (2 * Math.PI * j) / POINTS
    let rr = 1 + 0.08 * (2 * d(`${j}-jitter`) - 1)
    for (const w of waves) rr += w.amp * DMath.sin(w.k * t + w.phase)
    return [rr * DMath.cos(t), rr * DMath.sin(t)]
  })
  const target = AREA[0] + (AREA[1] - AREA[0]) * d("area")
  const k = Math.sqrt(target / Math.abs(area(raw)))
  return orient(raw.map(([x, z]): Vec2 => [k * x, k * z]))
}
