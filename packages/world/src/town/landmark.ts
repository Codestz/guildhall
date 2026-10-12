/**
 * Stage 7b (plan §4, Q1): the castle. The town code only lays its curtain wall: a closed wall just
 * inside the castle ground, towers on its corners and along it, and one gate on the side facing the
 * plaza. The keep is an authored dressing-only recipe (`landmarks/castle-keep`) placed in the middle,
 * its front to the gate; until that recipe exists in the library, a catalog castle stands in.
 * Other landmarks (chapel, guildhall) are lot specials (place.ts): nothing here.
 */
import { DMath } from "@guildhall/core"
import { intersect } from "../geom/line.ts"
import { centroid, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, dist, norm, round3, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { edgeKits, offsetRing, outline } from "./edges.ts"
import { normalizeSpec } from "./spec.ts"
import { STREET_WIDTH } from "./streets.ts"
import type { Edge, Placement, TownLibrary, TownPlan, TownSpecInput } from "./types.ts"

/** The keep's authored recipe id (data/recipes/landmarks/castle-keep.json). */
export const KEEP_RECIPE = "castle-keep"
/** The catalog castle that stands in for the keep until its recipe is authored: id and footprint (m). */
export const KEEP_FALLBACK = { piece: "kaykit-hexagon/building-castle-blue", w: 15.8, d: 18.05 } as const
/** The castle's towers stand closer than the town's, metres. */
const CASTLE_TOWERS = 22

export function landmark(
  plan: TownPlan,
  spec: TownSpecInput,
  lib: TownLibrary,
  roll: Roll,
): { placements: Placement[]; edges: Edge[] } {
  const s = normalizeSpec(spec)
  const ground = plan.blocks.find((b) => b.use === "castle")
  if (s.landmark !== "castle" || !ground) return { placements: [], edges: [] }

  const kit = edgeKits(s.tier).wall
  const inner = centroid(ground.poly)
  // The curtain stands inside the castle ground, its towers' reach clear of the castle street.
  const reach = Math.max(kit.thickness, kit.towerSize ?? 0) / 2
  const points = outline(offsetRing(ground.poly, -(reach + 0.5), inner))
  const plazaC = centroid(at(plan.plazas, 0))
  const gateS = rayArc(points, inner, plazaC)
  const width = round3(Math.max(kit.gateLength ?? 0, STREET_WIDTH.lane + (kit.towerSize ?? 0) / 2 + 1))
  const id = plan.edges.reduce((m, e) => Math.max(m, e.id + 1), 0)
  const curtain: Edge = {
    id,
    kind: "wall",
    points,
    closed: true,
    gaps: gateS === null ? [] : [{ s: round3(gateS), width, kind: "gate" }],
    towers: { spacing: CASTLE_TOWERS },
  }

  // The keep faces the gate (+z toward it), from the middle of the ward.
  const keepC = centroid(points)
  const toGate = norm(sub(plazaC, keepC))
  const recipe = lib.prefabs.some((p) => p.id === KEEP_RECIPE)
  const keep: Placement = {
    prefab: recipe ? KEEP_RECIPE : KEEP_FALLBACK.piece,
    seed: Math.floor(roll("seed:keep") * 2 ** 31),
    at: snap(keepC),
    rot: round3(DMath.atan2(toGate[0], toGate[1])),
    role: "keep",
  }
  return { placements: [keep], edges: [curtain] }
}

/** The arc length round the closed line where the ray from `from` toward `to` leaves it. */
function rayArc(line: Ring, from: Vec2, to: Vec2): number | null {
  const far = add(from, scale(norm(sub(to, from)), 1e4))
  let s = 0
  let best: { s: number; d: number } | null = null
  for (let i = 0; i < line.length; i++) {
    const a = at(line, i)
    const b = at(line, (i + 1) % line.length)
    const hit = intersect(from, far, a, b)
    if (hit && (!best || dist(from, hit.at) < best.d))
      best = { s: s + hit.u * dist(a, b), d: dist(from, hit.at) }
    s += dist(a, b)
  }
  return best ? best.s : null
}
