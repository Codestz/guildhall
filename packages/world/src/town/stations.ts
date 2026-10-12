/**
 * Stations (plan §4 step 10): where townsfolk and agents work. A building's authored station anchors
 * become stations of its trade (tavern bench, smithy anvil, shop counter, farmhouse yard); a tavern,
 * forge, chapel, guildhall or keep without one gets one at its door. Each market stall is a trader's
 * place behind its counter, the square's well or fountain a gathering place, each town gate a guard's
 * post. Farms (fields, paddocks, orchards) and the harbour (harbourmaster, pier ends) bring their own.
 * `facing` is a heading (obb.ts): the way the worker looks.
 */
import type { PrefabMeta } from "@guildhall/assets"
import { axes } from "../geom/obb.ts"
import { add, dist, round3, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { pointAlong } from "./farms.ts"
import type { Placement, Station, TownLibrary, TownPlan } from "./types.ts"

/** Building roles that work at a station, and the station's kind. */
const TRADE: Readonly<Record<string, Station["kind"]>> = {
  tavern: "tavern",
  forge: "forge",
  shop: "market",
  farmhouse: "field",
  chapel: "hall",
  hall: "hall",
  keep: "hall",
}
/** Roles that get a door station when their prefab has no anchor of its own. */
const AT_THE_DOOR = new Set(["tavern", "forge", "chapel", "hall", "keep"])
/** A door station stands this far out in front of the door, metres. */
const STEP_OUT = 1.2

export type StationInput = Pick<TownPlan, "placements" | "edges"> & {
  sizes?: Record<string, [number, number]>
}

export function stations(
  plan: StationInput,
  lib: Pick<TownLibrary, "prefabs">,
  extra: readonly Station[] = [],
): Station[] {
  const metas = new Map(lib.prefabs.map((m) => [m.id, m]))
  const out: Station[] = []
  // Ids the farms and the harbour chose (`field:3`, `dock:harbourmaster`) stay theirs; the rest count on.
  const used = new Set(extra.map((s) => s.id))
  const count = new Map<string, number>()
  const push = (kind: Station["kind"], at: Vec2, facing: number) => {
    let n = count.get(kind) ?? 0
    while (used.has(`${kind}:${n}`)) n++
    count.set(kind, n + 1)
    used.add(`${kind}:${n}`)
    out.push({ id: `${kind}:${n}`, kind, at: snap(at), facing: round3(facing) })
  }

  for (const p of plan.placements) {
    const role = p.role ?? ""
    const meta = metas.get(p.prefab)
    const kind = TRADE[role]
    if (kind && meta && meta.stations.length > 0) {
      for (const a of meta.stations) {
        // An anchor authored inside the walls (the smithy's anvil) is worked from the street in front.
        const inside = Math.abs(a.at[0]) < meta.frontage / 2 && Math.abs(a.at[2]) < meta.depth / 2
        const v = inside ? meta.depth / 2 + STEP_OUT : a.at[2]
        push(kind, toWorld(p, [a.at[0], v]), p.rot + a.facing)
      }
    } else if (kind && AT_THE_DOOR.has(role)) {
      push(kind, door(p, meta, plan.sizes?.[p.prefab]), p.rot + Math.PI)
    } else if (role === "stall") {
      // The trader stands behind the counter, looking out over it.
      const d = plan.sizes?.[p.prefab]?.[1] ?? 2
      push("market", add(p.at, scale(axes(p.rot).z, -(d / 2 + 0.6))), p.rot)
    } else if (role === "well" || role === "fountain") {
      const d = plan.sizes?.[p.prefab]?.[1] ?? 2
      push("well", add(p.at, scale(axes(p.rot).z, d / 2 + 0.8)), p.rot + Math.PI)
    }
  }
  for (const e of plan.edges) {
    if (e.kind !== "wall") continue
    const line = e.closed ? [...e.points, e.points[0] as Vec2] : e.points
    for (const g of e.gaps) {
      if (g.kind !== "gate") continue
      const a = pointAlong(line, g.s)
      const b = pointAlong(line, g.s + g.width)
      const mid = scale(add(a, b), 0.5)
      const along = sub(b, a)
      // The guard looks along the street through the gate (square to the wall).
      push("gate", mid, Math.atan2(-along[1], along[0]))
    }
  }
  for (const s of extra) out.push({ ...s, at: snap(s.at), facing: round3(s.facing) })
  return dedupe(out)
}

/** A point in the placement's frame (recipe space: +z its front) in world space. */
function toWorld(p: Placement, [u, v]: Vec2): Vec2 {
  const { x, z } = axes(p.rot)
  return add(p.at, add(scale(x, u), scale(z, v)))
}

/** In front of the door: the prefab's door when known, else the middle of its front. */
function door(p: Placement, meta: PrefabMeta | undefined, size: [number, number] | undefined): Vec2 {
  const front = meta ? meta.door : ([0, (size?.[1] ?? 6) / 2] as Vec2)
  return toWorld(p, [front[0], front[1] + STEP_OUT])
}

/** Two stations of the same kind on the same spot are one. */
function dedupe(list: Station[]): Station[] {
  const out: Station[] = []
  for (const s of list) if (!out.some((o) => o.kind === s.kind && dist(o.at, s.at) < 0.5)) out.push(s)
  return out
}
