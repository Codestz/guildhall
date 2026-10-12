/**
 * The town's lights (plan §5, night): where lamps stand and what glows after dark. Pure; it reads the
 * plan the generator made and the compiled recipes dressing uses, and returns
 *
 * - `pieces`: the lamp pieces to draw with the town (append them to `TownDraw.pieces`): street lamps
 *   along the streets at a spacing by class, alternating sides; lamp posts round the market square;
 *   torches either side of each gate and on each wall tower; a standing lantern by the door of every
 *   tavern, shop, forge, chapel and hall; a lamp post at each pier's end;
 * - `points`: one light per lamp, at its flame or glass, with the radius of the pool it throws;
 * - `windows`: one lit pane per window opening of every compiled building, with the house it belongs
 *   to, so a house's windows go dark together late at night.
 *
 * A lamp never stands on a street, in the water, under a wall or inside anything placed.
 */
import type { PrefabMeta, Recipe } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import { closest } from "../geom/line.ts"
import { axes, type Rect } from "../geom/obb.ts"
import { contains } from "../geom/poly.ts"
import { add, dist, len, norm, perp, round3, scale, sub, type Vec2 } from "../geom/vec.ts"
import { type DressKits, PLANT_ROLES, recipeKey } from "./dress.ts"
import { edgeKits, layoutEdge } from "./edges.ts"
import { pointAlong } from "./farms.ts"
import { normalizeSpec } from "./spec.ts"
import type { PieceInstance, Placement, StreetEdge, TownLibrary, TownPlan } from "./types.ts"

export const LIGHT_KINDS = ["street", "market", "torch", "door", "pier"] as const
export type LightKind = (typeof LIGHT_KINDS)[number]

/**
 * The piece each kind of lamp is drawn with, where its light sits in piece space (metres: `up`, and
 * `out` along the piece's +z), and the radius of the pool of light it throws on the ground. Measured
 * from the library GLBs (the glass or flame's bounding box centre).
 */
export const LAMPS: Readonly<Record<LightKind, { piece: string; up: number; out: number; radius: number }>> =
  {
    // A hanging lantern on a timber post, its arm (+z) out over the street.
    street: { piece: "kaykit-halloween/post-lantern", up: 2.03, out: 0.43, radius: 7 },
    // Kenney's tall lamp post, the houses' own kit: round the market square.
    market: { piece: "kenney-town/lantern", up: 4.85, out: 0, radius: 9 },
    // A burning torch in its sconce, hung on a wall or tower face.
    torch: { piece: "kaykit-dungeon/torch-lit", up: 0.95, out: 0, radius: 5 },
    // A lantern standing on the ground by a door.
    door: { piece: "kaykit-halloween/lantern-standing", up: 0.34, out: 0, radius: 3.5 },
    // The post lantern again, at the end of a pier.
    pier: { piece: "kaykit-halloween/post-lantern", up: 2.03, out: 0.43, radius: 7 },
  }

/** Metres between street lamps, by street class; roads (the country) and classes left out get none. */
export const LAMP_SPACING: Readonly<Partial<Record<StreetEdge["cls"], number>>> = {
  main: 18,
  street: 22,
  lane: 30,
}
/** Metres between lamp posts round the market square. */
const MARKET_SPACING = 16
/** A lamp stands this far out from the kerb, metres. */
const KERB_OUT = 0.6
/** Two lamps closer than this (of the same kind) are one, metres. */
const MIN_APART = 8
/** Metres along the street a blocked lamp is moved to try again, in order. */
const NUDGES = [0, 2, -2, 4, -4]
/** A lamp keeps this far from anything placed, metres. */
const CLEAR = 0.45
/** Height of a torch on a wall or tower face, metres. */
const TORCH_UP = 2.4

/**
 * A window piece's opening, in piece space (metres): its height range `y0..y1`, half its width along
 * z, and the depth `x` of the pane (inside the wall's thickness, behind the frame and mullions). The
 * panels are Kenney Fantasy Town's (kits.ts), their dressed face +x; measured from the GLBs.
 */
export interface WindowOpening {
  y0: number
  y1: number
  half: number
  x: number
}

/** Kenney Fantasy Town's module, metres (kits.ts: one cell, one storey). */
const U = 2.6 / 0.75
/** An opening given in kit units (the kit's openings sit on hundredths of a unit). */
const opening = (y0: number, y1: number, half: number): WindowOpening => ({
  y0: y0 * U,
  y1: y1 * U,
  half: half * U,
  x: 0.44 * U,
})
export const WINDOW_OPENINGS: Readonly<Record<string, WindowOpening>> = {
  "kenney-town/wall-window-glass": opening(0.2, 0.8, 0.2),
  "kenney-town/wall-window-shutters": opening(0.2, 0.8, 0.25),
  "kenney-town/wall-window-stone": opening(0.25, 0.75, 0.11),
  "kenney-town/wall-window-small": opening(0.2, 0.8, 0.16),
  "kenney-town/wall-window-round": opening(0.2, 0.8, 0.16),
  "kenney-town/wall-wood-window-glass": opening(0.2, 0.8, 0.2),
  "kenney-town/wall-wood-window-shutters": opening(0.2, 0.8, 0.25),
  "kenney-town/wall-wood-window-stone": opening(0.25, 0.75, 0.11),
  "kenney-town/wall-wood-window-small": opening(0.2, 0.8, 0.18),
  "kenney-town/wall-wood-window-round": opening(0.15, 0.85, 0.16),
}

/** One light: its kind, where the flame or glass is (`[x, y, z]`, metres) and its pool's radius. */
export interface LightPoint {
  kind: LightKind
  at: [x: number, y: number, z: number]
  radius: number
}

/**
 * One lit window: the pane's centre, its heading (`rot`, the pane faces local +x turned by it), size,
 * the house's rank (0–1: the late-night share of dark houses that leaves it lit is below it) and the
 * room's (a few rooms stay dark in a lit house).
 */
export interface WindowLight {
  at: [x: number, y: number, z: number]
  rot: number
  w: number
  h: number
  house: number
  room: number
}

export interface TownLights {
  pieces: PieceInstance[]
  points: LightPoint[]
  windows: WindowLight[]
}

/** What the lights read: the plan (with the sizes a generated TownLayout carries). */
export type LightsInput = TownPlan & { sizes?: Record<string, [number, number]> }

/** Building roles that hang a lantern by their door. */
const DOOR_ROLES = new Set(["tavern", "shop", "forge", "chapel", "hall"])

/** The heading (three's rotation about +y) that turns a piece's +z toward `dir`. */
const headingTo = (dir: Vec2): number => Math.atan2(dir[0], dir[1])

export function townLights(
  plan: LightsInput,
  compiled: ReadonlyMap<string, Recipe>,
  lib: Pick<TownLibrary, "prefabs">,
  kits: DressKits = edgeKits(normalizeSpec(plan.spec).tier),
): TownLights {
  const out: TownLights = { pieces: [], points: [], windows: [] }
  const solids = solidRects(plan)
  const walls = plan.edges.filter((e) => e.kind !== "fence")
  const blocked = (p: Vec2, own?: StreetEdge): boolean => {
    if (plan.water.some((ring) => contains(ring, p))) return true
    for (const e of plan.streets.edges) {
      const room = e === own ? e.width / 2 + KERB_OUT * 0.5 : e.width / 2 + 0.3
      if (nearLine(p, e.points, room)) return true
    }
    for (const e of walls)
      if (
        nearLine(
          p,
          e.closed ? [...e.points, e.points[0] as Vec2] : e.points,
          kits[e.kind].thickness / 2 + 0.6,
        )
      )
        return true
    return solids.some((r) => inRect(p, r, CLEAR))
  }
  const lamp = (kind: LightKind, at: Vec2, rot: number, y = 0): void => {
    const spec = LAMPS[kind]
    if (out.points.some((q) => q.kind === kind && dist([q.at[0], q.at[2]], at) < MIN_APART)) return
    out.pieces.push({
      piece: spec.piece,
      x: round3(at[0]),
      y: round3(y),
      z: round3(at[1]),
      rot: round3(rot),
      scale: 1,
    })
    const flame = add(at, scale(axes(rot).z, spec.out))
    out.points.push({
      kind,
      at: [round3(flame[0]), round3(y + spec.up), round3(flame[1])],
      radius: spec.radius,
    })
  }

  // Street lamps: about every `spacing` along each street (one on any edge half that long), on
  // alternating sides, arm out over the street. A spot taken by a house front is tried a few metres
  // either way, then across the street.
  for (const e of plan.streets.edges) {
    const spacing = LAMP_SPACING[e.cls]
    if (!spacing) continue
    const total = polyLength(e.points)
    if (total < spacing * 0.5) continue
    const n = Math.max(1, Math.round(total / spacing))
    for (let k = 0; k < n; k++) {
      const s0 = (k + 0.5) * (total / n)
      const first = (k + e.id) % 2 === 0 ? 1 : -1
      search: for (const side of [first, -first])
        for (const shift of NUDGES) {
          const s = Math.min(total - 0.5, Math.max(0.5, s0 + shift))
          const p = pointAlong(e.points, s)
          const t = norm(sub(pointAlong(e.points, s + 0.5), pointAlong(e.points, s - 0.5)))
          const out = scale(perp(t), side)
          const at = add(p, scale(out, e.width / 2 + KERB_OUT))
          if (blocked(at, e)) continue
          lamp("street", at, headingTo(scale(out, -1)))
          break search
        }
    }
  }

  // The market square: lamp posts just inside its edge.
  const square = plan.plazas[0]
  if (square && square.length >= 3) {
    const ring = [...square, square[0] as Vec2]
    const c = centroidOf(square)
    const total = polyLength(ring)
    const n = Math.max(3, Math.round(total / MARKET_SPACING))
    for (let k = 0; k < n; k++) {
      const p = pointAlong(ring, (k + 0.5) * (total / n))
      const inward = norm(sub(c, p))
      const at = add(p, scale(inward, 1.2))
      if (!blocked(at)) lamp("market", at, headingTo(inward))
    }
  }

  // Torches at the gates (both faces, either side of the gateway) and on the towers (the town side).
  const town = square && square.length >= 3 ? centroidOf(square) : ([0, 0] as Vec2)
  for (const e of plan.edges) {
    if (e.kind === "fence") continue
    const kit = kits[e.kind]
    const line = e.closed ? [...e.points, e.points[0] as Vec2] : e.points
    for (const g of e.gaps) {
      if (g.kind !== "gate") continue
      const a = pointAlong(line, g.s - g.width / 2)
      const b = pointAlong(line, g.s + g.width / 2)
      const along = norm(sub(b, a))
      const across = perp(along)
      const half = Math.max(g.width, kit.gateLength ?? 0) / 2 + 0.4
      const mid = scale(add(a, b), 0.5)
      for (const face of [1, -1]) {
        const off = scale(across, face * (kit.thickness / 2 + 0.25))
        const end = scale(along, face * half)
        if (e.kind === "wall")
          lamp("torch", add(add(mid, end), off), headingTo(scale(across, face)), TORCH_UP)
        else {
          const at = add(add(mid, end), off)
          if (!blocked(at)) lamp("street", at, headingTo(scale(along, -face)))
        }
      }
    }
    if (e.kind !== "wall") continue
    for (const t of layoutEdge(e, kit).towers) {
      const c: Vec2 = [t.x, t.z]
      const toTown = sub(town, c)
      const dir = len(toTown) > 0 ? norm(toTown) : ([1, 0] as Vec2)
      lamp("torch", add(c, scale(dir, (kit.towerSize ?? 3) / 2 + 0.25)), headingTo(dir), TORCH_UP + 0.6)
    }
  }

  // A lantern by the door of each trade building, and the windows of every compiled building.
  const metas = new Map<string, PrefabMeta>(lib.prefabs.map((m) => [m.id, m]))
  plan.placements.forEach((p, index) => {
    const meta = metas.get(p.prefab)
    if (meta && DOOR_ROLES.has(p.role ?? "")) {
      const { x, z } = axes(p.rot)
      const at = add(p.at, add(scale(x, meta.door[0] + 1.3), scale(z, meta.door[1] + 0.55)))
      if (!blocked(at)) lamp("door", at, p.rot)
    }
    const recipe = compiled.get(recipeKey(p.prefab, p.seed)) ?? compiled.get(p.prefab)
    if (recipe) out.windows.push(...windowsOf(p, recipe, plan.spec.seed, index))
  })

  // A lamp post at the end of each pier, on its side, arm over the deck.
  for (const s of plan.stations) {
    if (s.kind !== "dock" || s.id === "dock:harbourmaster") continue
    const { x } = axes(s.facing)
    lamp("pier", add(s.at, scale(x, 1.3)), headingTo(scale(x, -1)))
  }
  return out
}

/** The lit panes of one placed building, every window instance of its recipe. */
function windowsOf(p: Placement, recipe: Recipe, seed: number, index: number): WindowLight[] {
  const { x, z } = axes(p.rot)
  const house = roll(seed, `${index}:${p.prefab}:house-light`)
  const out: WindowLight[] = []
  recipe.instances.forEach((i, k) => {
    const o = WINDOW_OPENINGS[i.piece]
    if (!o) return
    const rot = p.rot + i.rot
    const s = i.scale
    const base = add(p.at, add(scale(x, i.x), scale(z, i.z)))
    const centre = add(base, scale(axes(rot).x, o.x * s))
    out.push({
      at: [round3(centre[0]), round3(i.y + ((o.y0 + o.y1) / 2) * s), round3(centre[1])],
      rot: round3(rot),
      w: round3(2 * o.half * s),
      h: round3((o.y1 - o.y0) * s),
      house: round3(house),
      room: round3(roll(seed, `${k}:${index}:room-light`)),
    })
  })
  return out
}

/** Footprints of everything placed that is not a plant: what a lamp keeps out of. */
function solidRects(plan: LightsInput): Rect[] {
  return plan.placements.flatMap((p) => {
    const size = plan.sizes?.[p.prefab]
    if (!size || PLANT_ROLES.has(p.role ?? "")) return []
    return [{ c: p.at, rot: p.rot, w: size[0], d: size[1] }]
  })
}

/** Whether `p` lies in `r` grown by `margin`. */
function inRect(p: Vec2, r: Rect, margin: number): boolean {
  if (dist(p, r.c) > Math.hypot(r.w, r.d) / 2 + margin) return false
  const { x, z } = axes(r.rot)
  const d = sub(p, r.c)
  return (
    Math.abs(d[0] * x[0] + d[1] * x[1]) <= r.w / 2 + margin &&
    Math.abs(d[0] * z[0] + d[1] * z[1]) <= r.d / 2 + margin
  )
}

function nearLine(p: Vec2, line: readonly Vec2[], d: number): boolean {
  for (let i = 0; i + 1 < line.length; i++)
    if (closest(p, line[i] as Vec2, line[i + 1] as Vec2).d < d) return true
  return false
}

function polyLength(line: readonly Vec2[]): number {
  let l = 0
  for (let i = 0; i + 1 < line.length; i++) l += dist(line[i] as Vec2, line[i + 1] as Vec2)
  return l
}

function centroidOf(ring: readonly Vec2[]): Vec2 {
  const sum = ring.reduce<Vec2>((a, p) => add(a, p), [0, 0])
  return scale(sum, 1 / ring.length)
}
