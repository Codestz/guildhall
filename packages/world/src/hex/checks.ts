/**
 * Checks on a tile prefab as authored (tile space, before the world places it), run over every file in
 * data/tiles by the tests and open to the composer:
 *
 *   doors    nothing stands in a door's approach: the strip out from the front of every closed
 *            building (a house, a hall, a barracks), DOOR_RUN long and DOOR_HALF either side of its
 *            middle (user: a blank sign right before the town hall's door read as nothing and shut it);
 *   spots    nobody stands inside a piece: a spot is outside every piece's outline (collide.ts), the
 *            seat a sitter sits on and the ground cover underfoot aside (user: a guard stood in a pot).
 */
import { pieceOutline, solidDistance, solidFrom, solidKind, solidToFoot } from "./collide.ts"
import type { TilePiece, TilePrefab } from "./tiles.ts"

/** A door's approach: how far out from the front wall, metres. */
export const DOOR_RUN = 1.2
/** Half its width, metres: a doorway's half and a shoulder. */
export const DOOR_HALF = 0.55
/** Closed buildings whose front has no door to keep clear (a well is walked round, not into). */
const NO_DOOR = /building-(well|windmill|watermill|tower-a|tower-catapult|bridge)/
/** Lower than this (metres, as placed) a piece is ground underfoot: a path, a patch, a plate. */
const FLAT = 0.12
/** Ground cover a foot stands among (grass, flowers, crops): never "inside" anything. */
const COVER = /(grass|flower|plant|mushroom|clover|lily|crop|path|patch|floor|ground)/

/** Where a piece covers the ground in tile space: its outlines, turned and scaled as written. */
function outlinesOf(q: TilePiece): number[][] {
  const o = pieceOutline(q.piece)
  if (!o || o.top * q.scale < FLAT || COVER.test(q.piece)) return []
  const polys = solidToFoot(q.piece) || !o.hulls.length ? [o.foot] : o.hulls
  const c = Math.cos(q.rot)
  const s = Math.sin(q.rot)
  return polys.map((p) => {
    const out: number[] = []
    for (let k = 0; k < p.length; k += 2) {
      const x = p[k]! * q.scale
      const z = p[k + 1]! * q.scale
      out.push(q.x + x * c + z * s, q.z - x * s + z * c)
    }
    return out
  })
}

export interface DoorWay {
  /** The building (index into the prefab's pieces). */
  piece: number
  /** The middle of its front wall, and the unit way out. */
  x: number
  z: number
  ux: number
  uz: number
}

/** The doors of a prefab's closed buildings: the middle of each one's front, facing out (+z of the piece). */
export function doorWays(p: TilePrefab): DoorWay[] {
  const out: DoorWay[] = []
  p.pieces.forEach((q, k) => {
    if (!solidToFoot(q.piece) || NO_DOOR.test(q.piece)) return
    const o = pieceOutline(q.piece)
    if (!o) return
    let front = 0
    for (let j = 1; j < o.foot.length; j += 2) front = Math.max(front, o.foot[j]!)
    const ux = Math.sin(q.rot)
    const uz = Math.cos(q.rot)
    out.push({ piece: k, x: q.x + ux * front * q.scale, z: q.z + uz * front * q.scale, ux, uz })
  })
  return out
}

/** Whether a convex outline (x, z pairs) and the approach out of door `d` overlap (separating axes). */
function inApproach(poly: readonly number[], d: DoorWay): boolean {
  // the outline in the approach's frame: u out of the door, v across it
  const u: number[] = []
  const v: number[] = []
  for (let k = 0; k < poly.length; k += 2) {
    const dx = poly[k]! - d.x
    const dz = poly[k + 1]! - d.z
    u.push(dx * d.ux + dz * d.uz)
    v.push(dx * d.uz - dz * d.ux)
  }
  // the strip's own axes
  if (Math.max(...u) <= 0.02 || Math.min(...u) >= DOOR_RUN) return false
  if (Math.max(...v) <= -DOOR_HALF || Math.min(...v) >= DOOR_HALF) return false
  // the outline's edges' normals
  const box = [
    [0.02, -DOOR_HALF],
    [DOOR_RUN, -DOOR_HALF],
    [DOOR_RUN, DOOR_HALF],
    [0.02, DOOR_HALF],
  ] as const
  const n = u.length
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    const nx = -(v[j]! - v[k]!)
    const ny = u[j]! - u[k]!
    if (!nx && !ny) continue
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (let i = 0; i < n; i++) {
      const p = u[i]! * nx + v[i]! * ny
      lo = Math.min(lo, p)
      hi = Math.max(hi, p)
    }
    let blo = Number.POSITIVE_INFINITY
    let bhi = Number.NEGATIVE_INFINITY
    for (const [a, b] of box) {
      const p = a * nx + b * ny
      blo = Math.min(blo, p)
      bhi = Math.max(bhi, p)
    }
    if (hi <= blo || bhi <= lo) return false
  }
  return true
}

/** The pieces standing in a door's approach, as "door of <building> ← <piece>" lines. */
export function blockedDoors(p: TilePrefab): string[] {
  const out: string[] = []
  for (const d of doorWays(p))
    p.pieces.forEach((q, k) => {
      if (k === d.piece || (q.y ?? 0) > 1.6) return
      if (outlinesOf(q).some((poly) => inApproach(poly, d)))
        out.push(`${p.id}: door of ${p.pieces[d.piece]!.piece} (#${d.piece}) ← ${q.piece} (#${k})`)
    })
  return out
}

/**
 * Pieces people stand on or within as they are made: a pier's platform (its deck), a market stall (its
 * outline is its awning's box; the merchant stands under it behind the counter, a customer at its front).
 */
const STOOD_IN = /(structure-platform|^kenney-town\/stall-(red|green)$)/
/** How deep inside a piece a spot may be and still count as beside it (a hand on a counter), metres. */
const INSIDE = 0.03

/** The spots standing inside a piece, as "spot k (kind) in <piece>" lines. */
export function spotsInPieces(p: TilePrefab): string[] {
  const out: string[] = []
  const solids = p.pieces.map((q) =>
    // overhead (a hanging lantern, a banner on a wall) is not underfoot
    (q.y ?? 0) > 1.2 ? [] : outlinesOf(q).map((poly) => solidFrom("prop", poly, 0, q.piece)),
  )
  // the decks' stone under a quay's walkers is stood on
  const onDeck = (x: number, z: number) =>
    (p.decks ?? []).some((d) => {
      const dx = d.bx - d.ax
      const dz = d.bz - d.az
      const l2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - d.ax) * dx + (z - d.az) * dz) / l2))
      return Math.hypot(d.ax + dx * t - x, d.az + dz * t - z) <= d.half
    })
  ;(p.spots ?? []).forEach((s, k) => {
    if (s.kind === "sleep") return
    p.pieces.forEach((q, j) => {
      // a sitter sits in the seat; a deck's walker stands on its stone
      if (s.kind === "sit" && solidKind(q.piece) === "seat") return
      // a building's or a wall's foot (its plate and eaves too) the world moves a spot out of
      // (spots.ts; hex-collide's test checks it): what is left here are the things nobody moves
      const kind = solidKind(q.piece)
      if (kind === "building" || kind === "wall" || STOOD_IN.test(q.piece)) return
      if (onDeck(s.x, s.z) && (q.y ?? 0) <= 0.05) return
      for (const o of solids[j]!)
        if (solidDistance(o, s.x, s.z) < -INSIDE) {
          out.push(`${p.id}: spot ${k} (${s.kind}) in ${q.piece} (#${j})`)
          return
        }
    })
  })
  return out
}
