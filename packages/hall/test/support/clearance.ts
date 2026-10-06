import { PILES } from "../../src/scene/life/places.ts"
import { ROUNDS } from "../../src/scene/life/rounds.ts"
import {
  type Behaviour,
  FORGE_BUCKETS,
  legOf,
  type Place,
  type Step,
  spotsOf,
  WORK_TREES,
} from "../../src/world/behaviours.ts"
import { FURNITURE } from "../../src/world/furniture.ts"
import KIT from "../../src/world/kit.json"
import LANDS from "../../src/world/lands.json"
import { HEX_SCALE, island, SITES } from "../../src/world/lands.ts"
import { HEARTH, type Spot } from "../../src/world/layout.ts"
import { LIGHTS } from "../../src/world/lights.ts"
import { wilds } from "../../src/world/wilds.ts"

/** A body's radius: a spot must keep this far off everything. */
export const BODY = 0.35

export interface Obstacle {
  name: string
  /** Distance from (x, z) to the obstacle's footprint (0 inside). */
  distance(x: number, z: number): number
}

type Bounds = { min: number[]; max: number[] }

/** An oriented footprint: a piece's bounding box at its placement. */
function box(name: string, bounds: Bounds, x: number, z: number, rot: number, scale: number): Obstacle {
  const [x0 = 0, , z0 = 0] = bounds.min
  const [x1 = 0, , z1 = 0] = bounds.max
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return {
    name,
    distance(px, pz) {
      const dx = px - x
      const dz = pz - z
      // World → the piece's own frame (inverse of x' = x c + z s, z' = −x s + z c).
      const lx = (dx * c - dz * s) / scale
      const lz = (dx * s + dz * c) / scale
      const ox = Math.max(x0 - lx, 0, lx - x1)
      const oz = Math.max(z0 - lz, 0, lz - z1)
      return Math.hypot(ox, oz) * scale
    },
  }
}

function circle(name: string, x: number, z: number, radius: number): Obstacle {
  return { name, distance: (px, pz) => Math.max(0, Math.hypot(px - x, pz - z) - radius) }
}

/** Flat or underfoot pieces nobody walks round. */
const FLAT = /^(hex_|building_dirt|waterlily|waterplant|floor_wood|rug_|fence_|trees_[AB]_cut)/
/** Hex-scale tree clusters: their footprint box is the whole canopy; the trunks stand well inside it. */
const CANOPY = /^trees_/

export const ISLAND_OBSTACLES: Obstacle[] = (() => {
  const out: Obstacle[] = []
  for (const piece of island().decor) {
    if (FLAT.test(piece.piece)) continue
    const bounds = (LANDS as Record<string, Bounds>)[piece.piece]
    if (!bounds) continue
    const scale = HEX_SCALE * (piece.scale ?? 1) * (CANOPY.test(piece.piece) ? 0.6 : 1)
    out.push(box(piece.piece, bounds, piece.x, piece.z, piece.rot ?? 0, scale))
  }
  const keep = {
    paths: ROUNDS.map((round) => [round.door, ...round.stops, round.door].map((s): Spot => [s.x, s.z])),
    spots: Object.values(PILES).map((pile): Spot => [pile.x, pile.z]),
  }
  for (const wild of wilds(keep))
    if (wild.kind !== "grass") out.push(circle(`wild ${wild.kind}`, wild.x, wild.z, wild.radius * 0.7))
  // The yard's building at its widest stage (scene/Island.tsx draws it unturned at the yard).
  out.push(box("yard building", LANDS.building_scaffolding, SITES.yard.at[0], SITES.yard.at[1], 0, HEX_SCALE))
  out.push(circle("log pile", PILES.logs.x, PILES.logs.z, 1.9))
  out.push(circle("stone heap", PILES.stones.x, PILES.stones.z, 1.55))
  out.push(circle("fish rack", PILES.fish.x, PILES.fish.z, 1.2))
  out.push(circle("book stacks", PILES.books.x, PILES.books.z, 1.7))
  for (const tree of WORK_TREES) out.push(circle("work tree", tree[0], tree[1], 0.45))
  // Lanterns and torches (world/lights.ts), each on whatever it stands on.
  for (const { placement: p } of LIGHTS) {
    const bounds = (KIT as Record<string, Bounds>)[p.piece]
    if (bounds) out.push(box(`light ${p.piece}`, bounds, p.x, p.z, p.rot ?? 0, p.scale ?? 1))
  }
  return out
})()

export const KEEP_OBSTACLES: Obstacle[] = (() => {
  const out: Obstacle[] = []
  for (const piece of FURNITURE) {
    if (FLAT.test(piece.piece) || (piece.y ?? 0) > 0.5) continue
    out.push(
      box(
        piece.piece,
        (KIT as Record<string, Bounds>)[piece.piece] as Bounds,
        piece.x,
        piece.z,
        piece.rot ?? 0,
        piece.scale ?? 1,
      ),
    )
  }
  out.push(circle("hearth", HEARTH[0], HEARTH[1], 1.8))
  for (const [x, z] of FORGE_BUCKETS) out.push(box("forge bucket", KIT.bucket_metal, x, z, -0.4, 1))
  return out
})()

/** The first obstacle `spot` stands too close to, if any. */
export function blocker(spot: Spot, obstacles: readonly Obstacle[], clearance = BODY): Obstacle | undefined {
  return obstacles.find((o) => o.distance(spot[0], spot[1]) < clearance)
}

/** Every walk one worker makes running `steps` from `from`, as router paths. */
export function walks(place: Place, steps: readonly Step[], from: Spot): { to: string; path: Spot[] }[] {
  const out: { to: string; path: Spot[] }[] = []
  let at = from
  for (const step of steps) {
    if (!("walk" in step)) continue
    const to = place.spots[step.walk]
    if (!to) throw new Error(`no spot ${step.walk}`)
    out.push({ to: step.walk, path: [at, ...legOf(at, to)] })
    at = to
  }
  return out
}

/** Points every `every` along a path, ends included. */
export function along(path: readonly Spot[], every = 0.25): Spot[] {
  const out: Spot[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Spot
    const b = path[i] as Spot
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / every))
    for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

export function placeFor(
  key: string,
  behaviour: Behaviour,
  post: readonly [number, number, number],
  berth: number,
): Place {
  return { key, behaviour, berth, post, spots: spotsOf(behaviour, post, berth) }
}
