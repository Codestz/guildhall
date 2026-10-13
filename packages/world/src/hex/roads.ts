/**
 * Roads are sacred (decisions.md, user 10-12: a road ran into the camp's buildings and vanished under
 * them). The strips a walker follows (a road's, a street's, a square's or a court's path strip, a flight
 * of stairs, a bridge's deck) and the checks over a built world that keep them clear:
 *
 *   covered  a solid (collide.ts: a building, a wall or a tower, a fence, a prop, a seat, a trunk) reaches
 *            into a strip, except a building's own doorstep where the strip runs to its door (and a
 *            gate's opening, which has no solid);
 *   ends     a road whose end is in a solid: every road end meets a door, a gate, a square, another road
 *            or a place's heart that is open ground;
 *   narrow   somewhere along a strip the clear width across it (the strip and the dry ground beside it,
 *            between the solids) is under MIN_WIDTH;
 *   through  a road routed over a building's tile on its way (zones.ts routes before tiles get jobs).
 *
 * The castle's courts (its paved ways inside the curtain wall) are counted apart (`court*`): the
 * curtain's inner corner at every inward turn of its line reaches the middle of the side a court's way
 * crosses there (curtain.ts), which is the castle's composition to change.
 *
 * A strip here is the walked width (ROAD_HALF either side of its line), the path mesh's middle: a
 * square's paving is drawn wider, its edges are the plaza's. The world keeps its pieces off the strips
 * as it places them (world.ts); the tests and the probes read `roadReport`.
 */
import {
  pieceFootprint,
  pieceSolids,
  type Solid,
  SolidGrid,
  solidDistance,
  walkwaySolids,
} from "./collide.ts"
import { hexAt } from "./grid.ts"
import type { HexIsland } from "./island.ts"
import { HEX_TILE_SIZE, type PlacedPiece } from "./tiles.ts"
import type { HexWalkway, HexWorld, HexWorldTile } from "./world.ts"
import { type HexZones, useOf } from "./zones.ts"

/** The least clear width a road keeps along its whole length, metres. */
export const MIN_WIDTH = 1.6
/** The walked half-width of a road's (a street's, a square's, a court's) path strip, metres. */
export const ROAD_HALF = 0.85
/** How deep a solid may touch a strip's edge before it covers it, metres. */
export const GRAZE = 0.05
/** A gate (a castle's gatehouse, a gate in a wall): its opening is the way through, as wide as it is made. */
const GATE = /gate/
/** How far round a gate's outline its passage reaches (its leaves swing in it), metres. */
const GATEHOUSE = 0.6
/** A doorstep: the last stretch of a strip into a building's door, metres. */
export const DOORSTEP = 0.9

/** One straight strip: from (ax, az) to (bx, bz), `half` either side of its line. */
export interface Strip {
  ax: number
  az: number
  bx: number
  bz: number
  half: number
  /** The tile it is drawn on (−1 for a flight of stairs or a deck). */
  tile: number
  /** The tile it runs into across its far end (−1 for a hub, a flight, a deck). */
  into: number
  kind: "road" | "stairs" | "deck"
}

const SQ3 = Math.sqrt(3)
/** From a tile's centre to the middle of its side, metres. */
const APOTHEM = HEX_TILE_SIZE * (SQ3 / 2)

/** A path tile's strips: one from its centre out through each side it runs on to. */
export function tileStrips(
  i: number,
  at: [number, number],
  sides: readonly number[],
  into: (d: number) => number,
): Strip[] {
  const [x, z] = at
  const out: Strip[] = []
  for (const d of sides) {
    const a = (Math.PI / 180) * (60 * d)
    out.push({
      ax: x,
      az: z,
      bx: x + Math.cos(a) * APOTHEM,
      bz: z - Math.sin(a) * APOTHEM,
      half: ROAD_HALF,
      tile: i,
      into: into(d),
      kind: "road",
    })
  }
  return out
}

/** A walkway's strip (a flight of stairs, a bridge deck's leg). */
export const wayStrip = (s: HexWalkway): Strip => ({
  ax: s.ax,
  az: s.az,
  bx: s.bx,
  bz: s.bz,
  half: Math.min(s.half, ROAD_HALF),
  tile: -1,
  into: -1,
  kind: s.kind,
})

/** The strips of a built world: each path tile's hub and legs, its stairs and its bridges' decks. */
export function roadStrips(h: HexIsland, w: Pick<HexWorld, "tiles" | "stairs" | "bridges">): Strip[] {
  const g = h.grid
  const out: Strip[] = []
  for (const t of w.tiles)
    if (t.paths?.length) out.push(...tileStrips(t.i, [t.x, t.z], t.paths, (d) => g.neighbours(t.i)[d]!))
  for (const s of w.stairs) out.push(wayStrip(s))
  for (const b of w.bridges) for (const leg of b.legs) out.push(wayStrip(leg))
  return out
}

/**
 * How deep a solid reaches into a strip, metres in from the strip's nearer edge (0: clear of it), the
 * strip's last `skipEnd` metres left out: the solid's outline clipped to the strip's box.
 */
export function stripIntrusion(s: Strip, solid: Solid, skipEnd = 0): number {
  const len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1e-9
  const ux = (s.bx - s.ax) / len
  const uz = (s.bz - s.az) / len
  // the solid's round against the strip's capsule first
  const t0 = Math.max(0, Math.min(len, (solid.cx - s.ax) * ux + (solid.cz - s.az) * uz))
  if (Math.hypot(solid.cx - (s.ax + ux * t0), solid.cz - (s.az + uz * t0)) > solid.r + s.half) return 0
  // into the strip's frame: u along it, v across
  let poly: number[] = []
  for (let k = 0; k < solid.pts.length; k += 2) {
    const dx = solid.pts[k]! - s.ax
    const dz = solid.pts[k + 1]! - s.az
    poly.push(dx * ux + dz * uz, -dx * uz + dz * ux)
  }
  const end = len - skipEnd
  if (end <= 0) return 0
  // clipped by u ≥ 0, u ≤ end, v ≥ −half, v ≤ half (Sutherland–Hodgman)
  const planes: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, end],
    [0, 1, s.half],
    [0, -1, s.half],
  ]
  for (const [a, b, c] of planes) {
    const next: number[] = []
    const n = poly.length / 2
    for (let k = 0; k < n; k++) {
      const px = poly[k * 2]!
      const pv = poly[k * 2 + 1]!
      const j = (k + 1) % n
      const qx = poly[j * 2]!
      const qv = poly[j * 2 + 1]!
      const dp = a * px + b * pv + c
      const dq = a * qx + b * qv + c
      if (dp >= 0) next.push(px, pv)
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq)
        next.push(px + (qx - px) * t, pv + (qv - pv) * t)
      }
    }
    poly = next
    if (poly.length < 6) return 0
  }
  // (across the strip's line: all of it)
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let k = 1; k < poly.length; k += 2) {
    lo = Math.min(lo, poly[k]!)
    hi = Math.max(hi, poly[k]!)
  }
  return lo <= 0 && hi >= 0 ? s.half : s.half - Math.min(Math.abs(lo), Math.abs(hi))
}

/** Strips in 4 m cells, for the placement's queries. */
export class StripGrid {
  private readonly cells = new Map<number, Strip[]>()
  constructor(readonly strips: readonly Strip[]) {
    for (const s of strips) {
      const x0 = Math.floor((Math.min(s.ax, s.bx) - s.half) / 4)
      const x1 = Math.floor((Math.max(s.ax, s.bx) + s.half) / 4)
      const z0 = Math.floor((Math.min(s.az, s.bz) - s.half) / 4)
      const z1 = Math.floor((Math.max(s.az, s.bz) + s.half) / 4)
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const key = (cx + 4096) * 8192 + cz + 4096
          const list = this.cells.get(key)
          if (list) list.push(s)
          else this.cells.set(key, [s])
        }
    }
  }

  /** The strips whose box comes within `r` of a point. */
  near(x: number, z: number, r: number): Strip[] {
    const out = new Set<Strip>()
    for (let cx = Math.floor((x - r) / 4); cx <= Math.floor((x + r) / 4); cx++)
      for (let cz = Math.floor((z - r) / 4); cz <= Math.floor((z + r) / 4); cz++)
        for (const s of this.cells.get((cx + 4096) * 8192 + cz + 4096) ?? []) out.add(s)
    return [...out]
  }

  /**
   * How deep a solid reaches into any strip (0: clear of all), a building's doorstep aside: the strip
   * that runs into `doorTile` across its door's side leaves its last DOORSTEP metres to it.
   */
  intrusion(solid: Solid, doorTile = -1, doorFrom = -1): number {
    let deep = 0
    for (const s of this.near(solid.cx, solid.cz, solid.r)) {
      const skip = doorTile >= 0 && s.into === doorTile && s.tile === doorFrom ? DOORSTEP : 0
      deep = Math.max(deep, stripIntrusion(s, solid, skip))
    }
    return deep
  }

  /** How deep a placed piece's solids reach into the strips (its doorstep aside, as `intrusion`). */
  pieceIntrusion(p: PlacedPiece, doorTile = -1, doorFrom = -1): number {
    let deep = 0
    for (const s of pieceSolids(p)) deep = Math.max(deep, this.intrusion(s, doorTile, doorFrom))
    return deep
  }

  /** Whether a point is on a strip, or within `margin` of one (a doorstep aside, as `intrusion`). */
  on(x: number, z: number, margin = 0, doorTile = -1, doorFrom = -1): boolean {
    for (const s of this.near(x, z, margin)) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1e-9
      const ux = (s.bx - s.ax) / len
      const uz = (s.bz - s.az) / len
      const u = (x - s.ax) * ux + (z - s.az) * uz
      const v = Math.abs(-(x - s.ax) * uz + (z - s.az) * ux)
      const end = doorTile >= 0 && s.into === doorTile && s.tile === doorFrom ? len - DOORSTEP : len
      if (u >= -margin && u <= end + margin && v <= s.half + margin) return true
    }
    return false
  }
}

export interface RoadReport {
  covered: number
  ends: number
  narrow: number
  /** Roads run over a building's (a landmark's) tile on their way. */
  through: number
  /** The castle's courts, apart (its curtain wall's inner corners over its ways): pieces, strips. */
  courtCovered: number
  courtNarrow: number
  notes: string[]
}

/** The tile under a world point, −1 off the grid. */
const tileOf = (h: HexIsland, x: number, z: number): number => {
  const { q, r } = hexAt(x / HEX_TILE_SIZE, z / HEX_TILE_SIZE)
  return h.grid.index(q, r)
}

/** The solids of a world's pieces (and its walkways' cheeks and rails), with the tile each stands on. */
export function worldSolids(
  h: HexIsland,
  w: Pick<HexWorld, "pieces" | "stairs" | "bridges">,
): { solid: Solid; tile: number; piece?: PlacedPiece }[] {
  const out: { solid: Solid; tile: number; piece?: PlacedPiece }[] = []
  for (const p of w.pieces) {
    const tile = tileOf(h, p.x, p.z)
    for (const s of pieceSolids(p)) out.push({ solid: s, tile, piece: p })
  }
  for (const st of [...w.stairs, ...w.bridges.flatMap((b) => b.legs)])
    for (const s of walkwaySolids(st)) out.push({ solid: s, tile: -1 })
  return out
}

/** The checks over a built world (see the top of this file). */
export function roadReport(h: HexIsland, z: HexZones, w: HexWorld): RoadReport {
  const g = h.grid
  const notes: string[] = []
  // the castle's courts (its paved ways inside the curtain wall) apart: the wall is the castle's
  // composition (curtain.ts), counted on its own
  // (a flight up through the gate is the court's too)
  const inCastle = (s: Strip) => {
    const i = s.tile >= 0 ? s.tile : tileOf(h, s.bx, s.bz)
    return i >= 0 && z.zones[z.zoneOf[i]! - 1]?.kind === "castle"
  }
  const all = roadStrips(h, w)
  const strips = all.filter((s) => !inCastle(s))
  const courts = all.filter(inCastle)
  const ways = new StripGrid(strips)
  const yard = new StripGrid(courts)
  const solids = worldSolids(h, w)
  const grid = new SolidGrid(solids.map((s) => s.solid))
  const byTile = new Map<number, HexWorldTile>(w.tiles.map((t) => [t.i, t]))
  /** The tile a building's door opens onto, by its own tile. */
  const doorOnto = (i: number): number => {
    const t = byTile.get(i)
    return t?.door === undefined ? -1 : g.neighbours(i)[t.door]!
  }
  // ---- covered: each piece (each walkway's cheek or rail) against every strip near it; a gate is the
  // way's own opening ----
  let covered = 0
  let courtCovered = 0
  const deepest = new Map<PlacedPiece | Solid, { deep: number; tile: number; solid: Solid }>()
  const courtHit = new Set<PlacedPiece | Solid>()
  for (const { solid, tile, piece } of solids) {
    if (piece && GATE.test(piece.piece)) continue
    const own = solid.kind === "building" ? tile : -1
    const from = own >= 0 ? doorOnto(own) : -1
    if (yard.intrusion(solid, own, from) > GRAZE) courtHit.add(piece ?? solid)
    const deep = ways.intrusion(solid, own, from)
    if (deep <= GRAZE) continue
    const key = piece ?? solid
    if ((deepest.get(key)?.deep ?? 0) < deep) deepest.set(key, { deep, tile, solid })
  }
  courtCovered = courtHit.size
  for (const [key, { deep, tile, solid }] of deepest) {
    covered++
    notes.push(
      `covered: ${"piece" in key ? key.piece : solid.kind} (tile ${tile}) ${deep.toFixed(2)} m into a strip at ${solid.cx.toFixed(1)},${solid.cz.toFixed(1)}`,
    )
  }
  const gates = w.pieces.filter((p) => GATE.test(p.piece)).flatMap((p) => pieceFootprint(p) ?? [])
  // ---- ends: each road's two ends ----
  let ends = 0
  for (const road of z.roads) {
    const n = road.tiles.length
    if (n < 2) continue
    for (const [e, prev] of [
      [road.tiles[0]!, road.tiles[1]!],
      [road.tiles[n - 1]!, road.tiles[n - 2]!],
    ] as const) {
      const t = byTile.get(e)
      if (!t) continue
      const d = [...g.neighbours(e)].indexOf(prev)
      if (t.paths?.includes(d)) {
        // it runs on into the tile's hub: open ground there (a square, a crossing, another road)
        const inside = grid
          .near(t.x, t.z, ROAD_HALF)
          .find((s) => solidDistance(s, t.x, t.z) < ROAD_HALF - GRAZE)
        if (inside) {
          ends++
          notes.push(`ends: road ${road.a}–${road.b} ends on ${e} in ${inside.piece ?? inside.kind}`)
        }
        continue
      }
      // else at a door: a building's (a landmark's) whose door faces the road
      if (t.door !== undefined && g.neighbours(e)[t.door] === prev) continue
      ends++
      notes.push(`ends: road ${road.a}–${road.b} ends on ${e} (${t.prefab}), neither a way on nor a door`)
    }
  }
  // ---- through: a road routed over a building's tile on its way (its end may be a door) ----
  let through = 0
  for (const road of z.roads)
    for (const i of road.tiles.slice(1, -1)) {
      const u = useOf(z, i)
      if (u !== "building" && u !== "landmark") continue
      through++
      notes.push(`through: road ${road.a}–${road.b} over ${u} ${i} (${byTile.get(i)?.prefab})`)
    }
  // ---- narrow: the clear width across each strip, every half metre along it ----
  let narrow = 0
  let courtNarrow = 0
  const open = (x: number, zz: number, y: number) => {
    if (w.stairAt(x, zz) !== null) return true
    const i = tileOf(h, x, zz)
    const t = i >= 0 ? byTile.get(i) : undefined
    return !!t && t.ground !== "water" && Math.abs(t.top - y) <= 0.3
  }
  const free = (x: number, zz: number) => grid.near(x, zz, 0).every((s) => solidDistance(s, x, zz) > 0)
  for (const s of all) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
    const ux = (s.bx - s.ax) / len
    const uz = (s.bz - s.az) / len
    const y = s.tile >= 0 ? (byTile.get(s.tile)?.top ?? 0) : 0
    // a strip into a door leaves its doorstep to the door
    const t = s.into >= 0 ? byTile.get(s.into) : undefined
    const end = t?.door !== undefined && doorOnto(s.into) === s.tile ? len - DOORSTEP : len
    for (let a = 0.25; a <= end; a += 0.5) {
      const cx = s.ax + ux * a
      const cz = s.az + uz * a
      // the gatehouse is the way's own opening: as wide as the gate is made, its leaves in the passage
      if (gates.some((f) => solidDistance(f, cx, cz) < GATEHOUSE)) continue
      let width = 0
      for (const side of [-1, 1]) {
        let v = 0
        while (v < 1.2) {
          const x = cx - uz * side * (v + 0.05)
          const zz = cz + ux * side * (v + 0.05)
          // beyond the strip, the ground beside it counts where it is dry and level with it
          if (!free(x, zz) || (s.tile >= 0 && v + 0.05 > s.half && !open(x, zz, y))) break
          v += 0.05
        }
        width += v
      }
      if (width < MIN_WIDTH - 1e-6) {
        if (inCastle(s)) {
          courtNarrow++
          break
        }
        narrow++
        notes.push(
          `narrow: ${width.toFixed(2)} m on ${s.tile} (${s.kind}) at ${cx.toFixed(1)},${cz.toFixed(1)}`,
        )
        break
      }
    }
  }
  return { covered, ends, narrow, through, courtCovered, courtNarrow, notes }
}
