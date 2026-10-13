/**
 * What "every building has floor" means, as checks over a built island (hex-sites.test.ts sweeps them
 * over seeds and knob extremes; `.probe/sites` prints the counts):
 *
 *   water      a building or wall piece whose footprint reaches over a sea, shallows, lake or river tile;
 *   overlap    two building pieces whose bodies cut into each other, or a building and a wall;
 *   unreached  a place whose heart, or a building whose door, the road network does not reach (walk
 *              graph, from the town's heart);
 *   castle     the Guildhall's keep (and its great hall, tier 3 up) without a door the gate reaches.
 *
 * A footprint is the piece's catalog size (`pieceSize`) as placed (scaled and turned); its body for
 * overlaps is the ellipse inside it, a little shrunk (KayKit hex buildings are hexagons, not boxes).
 */
import { pieceSize } from "../src/hex/sites.ts"
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
/** A castle wall's corner tower (tiles.ts castleWalls): it caps the walls' joints, so it may cut them. */
const isWallTower = (p: PlacedPiece) => p.piece.startsWith("kaykit-hexagon/building-tower-base")

export interface SiteReport {
  water: number
  overlap: number
  unreached: number
  castle: number
  /** One line per violation, for the probe. */
  notes: string[]
}

/**
 * Points over a piece's footprint: its centre and its outline, shrunk a little. A KayKit hex building
 * stands on a hexagon its width across the corners (corners on its own ±x, as a tile's are; a porch may
 * reach past it); a wall is its box.
 */
function samples(p: PlacedPiece): [number, number][] {
  const s = pieceSize(p.piece)
  if (!s) return [[p.x, p.z]]
  const c = Math.cos(p.rot)
  const n = Math.sin(p.rot)
  const local: [number, number][] = []
  if (isWall(p.piece)) {
    const hw = (s[0] / 2) * p.scale * 0.9
    const hd = (s[1] / 2) * p.scale * 0.8
    for (const [a, b] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
      [0, 1],
      [0, -1],
    ] as const)
      local.push([a * hw, b * hd])
  } else {
    const r = (s[0] / 2) * p.scale * 0.92
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6
      // the hexagon's corners (even k) and its sides' middles (odd k)
      const m = k % 2 ? r * (Math.sqrt(3) / 2) : r
      local.push([Math.cos(a) * m, Math.sin(a) * m])
    }
  }
  return [
    [p.x, p.z],
    ...local.map(([lx, lz]): [number, number] => [p.x + lx * c + lz * n, p.z - lx * n + lz * c]),
  ]
}

/** The body's radius for overlaps: the circle inside its hexagon, shrunk. */
const bodyR = (p: PlacedPiece) => {
  const s = pieceSize(p.piece)
  return s ? (s[0] / 2) * p.scale * (Math.sqrt(3) / 2) * 0.9 : 0
}

/** Distance from a point to a wall's box (its length shrunk a little: walls overlap at their joints). */
function toWall(px: number, pz: number, w: PlacedPiece): number {
  const s = pieceSize(w.piece) ?? [1, 1]
  const hw = (s[0] / 2) * w.scale * 0.9
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
  for (const wl of walls)
    for (const b of near(wl.x, wl.z))
      if (toWall(b.x, b.z, wl) < bodyR(b) - 0.05) {
        overlap++
        notes.push(`overlap: wall / ${b.piece} at ${b.x.toFixed(1)},${b.z.toFixed(1)}`)
      }
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
  return { water, overlap, unreached, castle, notes }
}
