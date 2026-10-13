/**
 * What "every building has floor" means, as checks over a built island (hex-sites.test.ts sweeps them
 * over seeds and knob extremes; `.probe/sites` prints the counts):
 *
 *   water      a building or wall piece whose footprint reaches over a sea, shallows, lake or river tile;
 *   overlap    two building pieces whose bodies cut into each other, or a wall that runs into a
 *              building further than a joint (curtain.ts WALL_INTO: a wall ends in a building's face);
 *   gap        a curtain wall's end that meets nothing: neither another wall nor a building (curtain.ts);
 *   unreached  a place whose heart, or a building whose door, the road network does not reach (walk
 *              graph, from the town's heart);
 *   castle     the Guildhall's keep (and its great hall, tier 3 up) without a door the gate reaches.
 *
 * A footprint is the piece's catalog size (`pieceSize`) as placed (scaled and turned); its body for
 * overlaps is the ellipse inside it, a little shrunk (KayKit hex buildings are hexagons, not boxes).
 */
import { bodyOutline, WALL_INTO } from "../src/hex/curtain.ts"
import { bodyRadius, footprint, pieceSize } from "../src/hex/sites.ts"
import {
  HEX_TILE_SIZE,
  type HexIsland,
  type HexWalk,
  type HexWorld,
  type HexZones,
  hexAt,
  kindOf,
  type PlacedPiece,
  useOf,
} from "../src/index.ts"

const WATER = new Set(["sea", "shallows", "lake", "river"])
export const isBuilding = (p: string) =>
  p.startsWith("kaykit-hexagon/building-") && !p.startsWith("kaykit-hexagon/building-bridge")
export const isWall = (p: string) => p.startsWith("kaykit-hexagon/wall-")
/** A castle wall's corner tower (curtain.ts): it caps the walls' joints, so it may cut them. */
const isWallTower = (p: PlacedPiece) => p.piece.startsWith("kaykit-hexagon/building-tower-base")

export interface SiteReport {
  water: number
  overlap: number
  gap: number
  unreached: number
  castle: number
  /** One line per violation, for the probe. */
  notes: string[]
}

/** Points over a piece's footprint: the world's own (sites.ts `footprint`, the collision layer's outline). */
const samples = (p: PlacedPiece): [number, number][] => footprint(p) ?? [[p.x, p.z]]

/** The body's radius for overlaps (sites.ts `bodyRadius`). */
const bodyR = (p: PlacedPiece) => bodyRadius(p)

/** Distance from a point to a wall's box (its length shrunk a little: walls overlap at their joints). */
function toWall(px: number, pz: number, w: PlacedPiece): number {
  const s = pieceSize(w.piece) ?? [1, 1]
  const hw = (s[0] / 2) * w.scale * (w.stretch ?? 1) * 0.9
  const hd = (s[1] / 2) * w.scale * 0.8
  const c = Math.cos(w.rot)
  const n = Math.sin(w.rot)
  const dx = px - w.x
  const dz = pz - w.z
  // into the wall's frame (inverse of x' = x c + z n, z' = -x n + z c)
  const lx = dx * c - dz * n
  const lz = dx * n + dz * c
  const ox = Math.max(0, Math.abs(lx) - hw)
  const oz = Math.max(0, Math.abs(lz) - hd)
  return Math.hypot(ox, oz)
}

/** A wall piece's centre line: its two ends (metres). */
export function wallLine(w: PlacedPiece): [[number, number], [number, number]] {
  const s = pieceSize(w.piece) ?? [1, 1]
  const h = (s[0] / 2) * w.scale * (w.stretch ?? 1)
  const ux = Math.cos(w.rot)
  const uz = -Math.sin(w.rot)
  return [
    [w.x - ux * h, w.z - uz * h],
    [w.x + ux * h, w.z + uz * h],
  ]
}

/** Distance from a point to a segment. */
const toSegment = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz || 1e-9
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)
}

/** Whether a point is inside a convex outline (or within `tol` of it). */
function inOutline(p: [number, number], poly: readonly [number, number][], tol: number): boolean {
  let inside = true
  let near = Number.POSITIVE_INFINITY
  let area = 0
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!
    const b = poly[(k + 1) % poly.length]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!
    const b = poly[(k + 1) % poly.length]!
    const side = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * Math.sign(area)
    if (side < 0) inside = false
    near = Math.min(near, toSegment(p, a, b))
  }
  return inside || near <= tol
}

/** How far a wall's centre line runs into a building's outline, metres (Infinity: through it). */
function intoBody(w: PlacedPiece, b: PlacedPiece): number {
  const poly = bodyOutline(b)
  if (!poly) return 0
  const [a, c] = wallLine(w)
  const steps = 40
  let first = -1
  let last = -1
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const p: [number, number] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]
    if (!inOutline(p, poly, -0)) continue
    if (first < 0) first = k
    last = k
  }
  if (first < 0) return 0
  const len = Math.hypot(c[0] - a[0], c[1] - a[1])
  // in at neither end: the wall runs through it
  if (first > 0 && last < steps) return Number.POSITIVE_INFINITY
  return ((last - first) / steps) * len
}

/** Whether a point is in a wall piece's box (its whole length and depth), or within `tol` of it. */
function inWall(p: [number, number], w: PlacedPiece, tol: number): boolean {
  const s = pieceSize(w.piece) ?? [1, 1]
  const c = Math.cos(w.rot)
  const n = Math.sin(w.rot)
  const dx = p[0] - w.x
  const dz = p[1] - w.z
  const lx = dx * c - dz * n
  const lz = dx * n + dz * c
  return (
    Math.abs(lx) <= (s[0] / 2) * w.scale * (w.stretch ?? 1) + tol &&
    Math.abs(lz) <= (s[1] / 2) * w.scale + tol
  )
}

/** How far a stub against a building may reach past its face at the outline's corner (curtain.ts mitre). */
const STUB = 0.5

/** How near a wall's end must come to what it meets, metres. */
export const WALL_TOUCH = 0.12

export function siteReport(h: HexIsland, z: HexZones, w: HexWorld, walk: HexWalk): SiteReport {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const notes: string[] = []
  const tileAt = (x: number, zz: number) => {
    const { q, r } = hexAt(x / R, zz / R)
    return g.index(q, r)
  }
  const solid = w.pieces.filter((p) => isBuilding(p.piece) || isWall(p.piece))
  // ---- water under a footprint ----
  let water = 0
  for (const p of solid) {
    const wet = samples(p).find(([x, zz]) => {
      const i = tileAt(x, zz)
      return i < 0 || WATER.has(kindOf(h, i))
    })
    if (wet) {
      water++
      const i = tileAt(wet[0], wet[1])
      notes.push(
        `water: ${p.piece} at ${p.x.toFixed(1)},${p.z.toFixed(1)} over ${i < 0 ? "off" : kindOf(h, i)}`,
      )
    }
  }
  // ---- overlaps: building bodies, and a building's body against a wall ----
  let overlap = 0
  const builds = solid.filter((p) => isBuilding(p.piece) && !isWallTower(p))
  const walls = solid.filter((p) => isWall(p.piece))
  const cell = new Map<string, PlacedPiece[]>()
  const key = (x: number, zz: number) => `${Math.floor(x / 8)},${Math.floor(zz / 8)}`
  for (const p of builds) {
    const k = key(p.x, p.z)
    if (!cell.has(k)) cell.set(k, [])
    cell.get(k)!.push(p)
  }
  const near = (x: number, zz: number) => {
    const cx = Math.floor(x / 8)
    const cz = Math.floor(zz / 8)
    const out: PlacedPiece[] = []
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) out.push(...(cell.get(`${cx + a},${cz + b}`) ?? []))
    return out
  }
  for (const [k, a] of builds.entries())
    for (const b of near(a.x, a.z)) {
      if (builds.indexOf(b) <= k) continue
      const d = Math.hypot(a.x - b.x, a.z - b.z)
      if (d < bodyR(a) + bodyR(b) - 0.05) {
        overlap++
        notes.push(
          `overlap: ${a.piece} / ${b.piece} at ${a.x.toFixed(1)},${a.z.toFixed(1)} (${d.toFixed(2)} m apart)`,
        )
      }
    }
  // a wall may end in a building's face (a joint), never run on into it, nor stand round its middle
  for (const wl of walls)
    for (const b of near(wl.x, wl.z)) {
      const depth = intoBody(wl, b)
      if (depth > WALL_INTO + 0.1 || toWall(b.x, b.z, wl) < 0.05) {
        overlap++
        notes.push(
          `overlap: wall / ${b.piece} at ${b.x.toFixed(1)},${b.z.toFixed(1)} (${depth.toFixed(2)} m in)`,
        )
      }
    }
  // ---- gaps: every wall's two ends meet another wall or a building (a corner tower counts) ----
  let gap = 0
  const lines = walls.map(wallLine)
  const solids = solid.filter((p) => isBuilding(p.piece))
  walls.forEach((wl, k) => {
    for (const end of lines[k]!) {
      const touches =
        walls.some((o, j) => j !== k && inWall(end, o, WALL_TOUCH)) ||
        solids.some((b) => {
          const poly = bodyOutline(b)
          if (poly === null || Math.hypot(b.x - end[0], b.z - end[1]) > 12) return false
          // a stub from the outline's corner into a building may stick out of it a hand's width
          return inOutline(end, poly, WALL_TOUCH) || (intoBody(wl, b) > 0 && inOutline(end, poly, STUB))
        })
      if (!touches) {
        gap++
        notes.push(`gap: ${wl.piece} end at ${end[0].toFixed(2)},${end[1].toFixed(2)} meets nothing`)
      }
    }
  })
  // ---- reach: the walk graph's piece the town's heart is on ----
  const comp = new Int32Array(walk.nodes.length).fill(-1)
  let nc = 0
  for (let s = 0; s < walk.nodes.length; s++) {
    if (comp[s]! >= 0) continue
    comp[s] = nc
    const stack = [s]
    while (stack.length) {
      const i = stack.pop()!
      for (const e of walk.out[i]!) {
        const ed = walk.edges[e]!
        const j = ed.a === i ? ed.b : ed.a
        if (comp[j]! < 0) {
          comp[j] = nc
          stack.push(j)
        }
      }
    }
    nc++
  }
  const town = z.zones.findIndex((zz) => zz.kind === "town")
  const main = town >= 0 && walk.hearts[town]! >= 0 ? comp[walk.hearts[town]!]! : -1
  const reached = (n: number) => n >= 0 && comp[n] === main
  let unreached = 0
  // a place whose heart another grew over first has no tiles of its own: nothing there to reach
  for (const [zi, zone] of z.zones.entries())
    if (zone.tiles.length && !reached(walk.hearts[zi]!)) {
      unreached++
      notes.push(`unreached: ${zone.kind} heart ${zone.tile}`)
    }
  for (const t of w.tiles) {
    const u = useOf(z, t.i)
    if (u !== "building" && u !== "landmark") continue
    const d = walk.door(t.i)
    if (d >= 0 && !reached(d)) {
      unreached++
      notes.push(`unreached: door of ${t.prefab} on ${t.i}`)
    }
  }
  // ---- the castle: its keep's door (and its hall's) reached from the gate / the roads ----
  let castle = 0
  const ci = z.zones.findIndex((zz) => zz.kind === "castle")
  if (ci >= 0) {
    const prefab = new Map(w.tiles.map((t) => [t.i, t.prefab]))
    for (const i of z.zones[ci]!.tiles) {
      const p = prefab.get(i)
      if (p !== "castle" && p !== "great-hall") continue
      const d = walk.door(i)
      if (!reached(d)) {
        castle++
        notes.push(`castle: ${p} on ${i} has ${d < 0 ? "no door" : "a door off the roads"}`)
      }
    }
  }
  return { water, overlap, gap, unreached, castle, notes }
}
