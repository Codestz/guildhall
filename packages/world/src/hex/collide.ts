/**
 * The hex world's collision layer (no physics engine): what people cannot walk into and the height their
 * feet stand at, built once with the world and read by everything that moves or places people: the walks
 * (walk.ts `clearWay`), the spots (spots.ts), the crowd's personal space (the Studio's life), the ground's
 * seat under every building (ground.ts) and the tests.
 *
 *   solids   one convex outline per placed piece people bump into: a building, a wall or a tower, a
 *            fence, a prop, a seat; a tree only by its trunk. The outline is the piece's own (outlines.ts,
 *            read off its model in the band people walk in), turned and scaled as placed. The tile
 *            composer's authored blockers are solids too (discs as octagons), and so are the stairs'
 *            stone cheeks and the bridges' rails.
 *   height   the ground, else a flight of stairs' tread or a bridge's deck: the numbers the meshes are
 *            built from (structures.ts), so feet stand on the step that is drawn.
 */
import { OUTLINE_DATA } from "./outlines.ts"
import type { PlacedPiece } from "./tiles.ts"

/**
 * What a solid is: a `building` (a KayKit hex building), a `wall` (a castle wall, a tower, a fence, a
 * stair's cheek, a bridge's rail), a `prop`, a `seat` (a bench or a stool: sitting spots stand in it), a
 * tree's `trunk`, or an authored `blocker`.
 */
export type SolidKind = "building" | "wall" | "prop" | "seat" | "trunk" | "blocker"

export interface Solid {
  kind: SolidKind
  /** Corners x, z after one another, counter-clockwise seen from above (x right, z down the screen). */
  pts: Float64Array
  /** A circle round it all. */
  cx: number
  cz: number
  r: number
  /** The height it stands on, metres. */
  base: number
  /** The piece it is (none for a blocker, a cheek or a rail). */
  piece?: string
  /**
   * A side of a gate (or a doorway, an arch): the opening's middle and the way through it (unit), so a
   * walk goes straight through the middle instead of round the wall.
   */
  gate?: [number, number, number, number]
  /** Only kept clear of where there is room (a place someone stands a while), never a wall. */
  soft?: boolean
  /** The last grid query that listed it (SolidGrid's bookkeeping). */
  seen?: number
}

/** KayKit buildings with open ground among their parts (stalls, targets, a scaffold, a ruin). */
const OPEN_BUILDING = /building-(market|archeryrange|stage|scaffolding|destroyed|grain|dirt)/
/** Whether a piece is solid to its foot's outline (a closed building), not to its parts. */
export const solidToFoot = (piece: string): boolean =>
  solidKind(piece) === "building" && !OPEN_BUILDING.test(piece)
/** Pieces with an opening people walk through (the outline generator leaves it free). */
const OPENING = /(gate|doorway|arch)/

interface Outline {
  top: number
  /** The outline of everything from its foot up to a person's height (a building's plate too). */
  foot: Float64Array
  /** The parts people bump into (a market's stalls apart, a gate's two sides). */
  hulls: Float64Array[]
}

let outlines: Map<string, Outline> | null = null
/** Every piece's outline at scale 1, by id (parsed once). */
function outlineTable(): Map<string, Outline> {
  if (outlines) return outlines
  outlines = new Map()
  for (const line of OUTLINE_DATA.split("\n")) {
    const parts = line.trim().split(" ")
    if (parts.length < 4) continue
    const hulls: Float64Array[] = []
    let foot: Float64Array | null = null
    let pts: number[] = []
    const end = () => {
      if (pts.length >= 6) hulls.push(new Float64Array(pts))
      pts = []
    }
    for (let k = 2; k < parts.length; k++) {
      if (parts[k] === "||") {
        foot = new Float64Array(pts)
        pts = []
        continue
      }
      if (parts[k] === "|") {
        end()
        continue
      }
      const [x, z] = parts[k]!.split(",").map(Number) as [number, number]
      // the same corner twice (rounded together) once
      if (pts.length && pts[pts.length - 2] === x && pts[pts.length - 1] === z) continue
      pts.push(x, z)
    }
    end()
    if (foot && foot.length >= 6) outlines.set(parts[0]!, { top: Number(parts[1]), foot, hulls })
  }
  return outlines
}

/** A piece's outline at scale 1 in its own frame, or undefined when the library had none. */
export function pieceOutline(piece: string): Outline | undefined {
  return outlineTable().get(piece)
}

/** Ground cover and things on the water or overhead: nobody bumps into them. */
const SOFT =
  /^(kaykit-forest\/(grass|bush|flower|mushroom|clover)|kenney-nature\/(grass|flower|crop|plant|mushroom|lily|path|ground|cliff|bridge|log|canoe|pot)|kenney-pirate\/(boat|ship|structure-platform|platform|patch|grass|flag|mast|hole)|kenney-castle\/(flag|ground|bridge|stairs)|kaykit-dungeon\/(banner|floor|ceiling|candle|coin|bottle)|kenney-survival\/(fish|bucket|bottle|floor|grass|patch)|kaykit-hexagon\/(hex|tiles|building-dirt|building-grain|building-bridge))/
const TRUNK = /^(kaykit-forest\/tree-|kenney-nature\/tree|kenney-castle\/tree-(large|small))/
const SEAT = /(bench|stool|chair|throne)/
const BUILDING = /^(kaykit-hexagon\/building-|kaykit-builder\/)/
const WALL =
  /^(kaykit-hexagon\/(wall|fence)|kenney-castle\/(wall|tower|gate|door|metal-gate)|kenney-nature\/fence|kenney-town\/(fence|hedge|wall)|kenney-pirate\/(castle|tower)|kenney-graveyard\/(fence|iron-fence|stone-wall|brick-wall))/
/** A tree's trunk radius at scale 1 (the crown is over people's heads). */
const TRUNK_R = 0.35
/** Smaller than this round (metres, as placed) nobody needs to step round it. */
const TINY = 0.12

/** The kind of solid a piece is, or null for one nobody bumps into. */
export function solidKind(piece: string): SolidKind | null {
  if (SOFT.test(piece)) return null
  if (TRUNK.test(piece)) return "trunk"
  if (BUILDING.test(piece)) return "building"
  if (WALL.test(piece)) return "wall"
  if (SEAT.test(piece)) return "seat"
  return "prop"
}

/** (x, z) in a frame at (ox, oz) turned by `rot` about y (as the render turns a piece), scaled by `k`. */
const turn = (ox: number, oz: number, rot: number, x: number, z: number, k: number): [number, number] => {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return [ox + (x * c + z * s) * k, oz + (-x * s + z * c) * k]
}

/** A solid from corners (any order of a convex outline: they are made counter-clockwise here). */
export function solidFrom(kind: SolidKind, corners: readonly number[], base: number, piece?: string): Solid {
  const n = corners.length / 2
  // the shoelace sign: flip a clockwise outline
  let area = 0
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    area += corners[k * 2]! * corners[j * 2 + 1]! - corners[j * 2]! * corners[k * 2 + 1]!
  }
  const pts = new Float64Array(corners.length)
  for (let k = 0; k < n; k++) {
    const from = area >= 0 ? k : n - 1 - k
    pts[k * 2] = corners[from * 2]!
    pts[k * 2 + 1] = corners[from * 2 + 1]!
  }
  let cx = 0
  let cz = 0
  for (let k = 0; k < n; k++) {
    cx += pts[k * 2]! / n
    cz += pts[k * 2 + 1]! / n
  }
  let r = 0
  for (let k = 0; k < n; k++) r = Math.max(r, Math.hypot(pts[k * 2]! - cx, pts[k * 2 + 1]! - cz))
  return { kind, pts, cx, cz, r, base, ...(piece ? { piece } : {}) }
}

/** A disc as the octagon round it. */
export function discSolid(kind: SolidKind, x: number, z: number, r: number, base: number): Solid {
  const R = r / Math.cos(Math.PI / 8)
  const c: number[] = []
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8
    c.push(x + Math.cos(a) * R, z + Math.sin(a) * R)
  }
  return solidFrom(kind, c, base)
}

/** An upright box's outline: centre, the unit axis its length runs along, its length and width. */
export function boxSolid(
  kind: SolidKind,
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  len: number,
  wid: number,
  base: number,
): Solid {
  const vx = -uz
  const vz = ux
  const c: number[] = []
  for (const [a, b] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const)
    c.push(cx + ux * a * len + vx * b * wid, cz + uz * a * len + vz * b * wid)
  return solidFrom(kind, c, base)
}

/** A placed piece's solids (a gate's two sides), none when nobody bumps into it or it has no outline. */
export function pieceSolids(p: PlacedPiece): Solid[] {
  const kind = solidKind(p.piece)
  if (!kind) return []
  if (kind === "trunk") return [discSolid("trunk", p.x, p.z, TRUNK_R * p.scale, p.y)]
  const o = pieceOutline(p.piece)
  if (!o) return []
  // a closed building is solid to its foot's outline (its rooms are not walked in: only the parts of an
  // open one, a market's stalls or a range's targets, leave the ground between them free)
  if (solidToFoot(p.piece)) {
    const c: number[] = []
    for (let k = 0; k < o.foot.length; k += 2)
      c.push(...turn(p.x, p.z, p.rot, o.foot[k]!, o.foot[k + 1]!, p.scale))
    return [solidFrom(kind, c, p.y, p.piece)]
  }
  const out: Solid[] = []
  // a gate's opening runs across its long axis: the way through is along the short one
  let gate: [number, number, number, number] | undefined
  if (o.hulls.length >= 2 && OPENING.test(p.piece)) {
    let w = 0
    let d = 0
    for (let k = 0; k < o.foot.length; k += 2) {
      w = Math.max(w, Math.abs(o.foot[k]!))
      d = Math.max(d, Math.abs(o.foot[k + 1]!))
    }
    const [ax, az] = w >= d ? [0, 1] : [1, 0]
    const c = Math.cos(p.rot)
    const sn = Math.sin(p.rot)
    gate = [p.x, p.z, ax * c + az * sn, -ax * sn + az * c]
  }
  for (const hull of o.hulls) {
    const c: number[] = []
    for (let k = 0; k < hull.length; k += 2) c.push(...turn(p.x, p.z, p.rot, hull[k]!, hull[k + 1]!, p.scale))
    const s = solidFrom(kind, c, p.y, p.piece)
    if (gate) s.gate = gate
    if (s.r >= TINY) out.push(s)
  }
  return out
}

/** A placed piece's whole outline (a gate's sides together): what it covers of the ground. */
export function pieceFootprint(p: PlacedPiece): Solid | null {
  const kind = solidKind(p.piece)
  const o = pieceOutline(p.piece)
  if (!kind || !o) return null
  const c: number[] = []
  for (let k = 0; k < o.foot.length; k += 2)
    c.push(...turn(p.x, p.z, p.rot, o.foot[k]!, o.foot[k + 1]!, p.scale))
  return solidFrom(kind, c, p.y, p.piece)
}

/** The convex hull of x, z pairs (monotone chain). */
export function convexHull(xz: readonly number[]): number[] {
  const p: [number, number][] = []
  for (let k = 0; k < xz.length; k += 2) p.push([xz[k]!, xz[k + 1]!])
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p.flat()
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: [number, number][] = []
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)].flat()
}

/**
 * The signed distance from (x, z) to a solid's outline: negative inside. `out` (if given) takes the unit
 * direction that leads out of it the shortest way.
 */
export function solidDistance(s: Solid, x: number, z: number, out?: [number, number]): number {
  const p = s.pts
  const n = p.length / 2
  // far outside its round: the round's distance is a fine lower bound when nobody asks the way out
  if (!out) {
    const c = Math.hypot(x - s.cx, z - s.cz) - s.r
    if (c > 1) return c
  }
  let inside = true
  let best = Number.POSITIVE_INFINITY
  let bx = 0
  let bz = 0
  // inside: the nearest edge (by its line); outside: the nearest point of the outline
  let edgeBest = Number.NEGATIVE_INFINITY
  let ek = 0
  for (let k = 0; k < n; k++) {
    const ax = p[k * 2]!
    const az = p[k * 2 + 1]!
    const j = k + 1 === n ? 0 : k + 1
    const dx = p[j * 2]! - ax
    const dz = p[j * 2 + 1]! - az
    const l2 = dx * dx + dz * dz || 1e-18
    // outward of a counter-clockwise outline (x right, z "up" in the shoelace's frame): (dz, −dx)
    const side = ((x - ax) * dz - (z - az) * dx) / Math.sqrt(l2)
    if (side > 0) inside = false
    if (side > edgeBest) {
      edgeBest = side
      ek = k
    }
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
    const qx = ax + dx * t - x
    const qz = az + dz * t - z
    const d2 = qx * qx + qz * qz
    if (d2 < best) {
      best = d2
      bx = qx + x
      bz = qz + z
    }
  }
  if (inside) {
    if (out) {
      const j = ek + 1 === n ? 0 : ek + 1
      const dx = p[j * 2]! - p[ek * 2]!
      const dz = p[j * 2 + 1]! - p[ek * 2 + 1]!
      const l = Math.hypot(dx, dz) || 1e-9
      out[0] = dz / l
      out[1] = -dx / l
    }
    return edgeBest
  }
  const d = Math.sqrt(best)
  if (out) {
    out[0] = (x - bx) / (d || 1e-9)
    out[1] = (z - bz) / (d || 1e-9)
  }
  return d
}

/** Every query's own number: a solid it has seen carries it (`seen`), so it is listed once. */
let queries = 0
/** Solids in 4 m cells, for the queries. */
export class SolidGrid {
  private readonly cells = new Map<number, Solid[]>()
  private readonly none: Solid[] = []

  constructor(readonly solids: readonly Solid[]) {
    for (const s of solids)
      for (let cx = Math.floor((s.cx - s.r) / CELL); cx <= Math.floor((s.cx + s.r) / CELL); cx++)
        for (let cz = Math.floor((s.cz - s.r) / CELL); cz <= Math.floor((s.cz + s.r) / CELL); cz++) {
          const key = cellKey(cx, cz)
          const list = this.cells.get(key)
          if (list) list.push(s)
          else this.cells.set(key, [s])
        }
  }

  /** The solids whose round reaches within `r` of a point (a superset of those the point's circle touches). */
  near(x: number, z: number, r: number): Solid[] {
    let out = this.none
    const stamp = ++queries
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++)
        for (const s of this.cells.get(cellKey(cx, cz)) ?? this.none) {
          if (s.seen === stamp) continue
          s.seen = stamp
          const dx = s.cx - x
          const dz = s.cz - z
          const reach = s.r + r
          if (dx * dx + dz * dz >= reach * reach) continue
          if (out === this.none) out = []
          out.push(s)
        }
    return out
  }
}

const CELL = 4
const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096

/** The world's walkways as world.ts lays them (structures.ts builds the meshes from the same numbers). */
export interface Walkway {
  kind: "stairs" | "deck"
  ax: number
  az: number
  ay: number
  bx: number
  bz: number
  by: number
  half: number
  steps?: number
}

/** A stair's cheek stands this far out of its treads' edge, this wide (structures.ts `stairsInto`). */
export const CHEEK_OUT = 0.08
export const CHEEK_W = 0.16
/** How many steps a flight has (structures.ts builds the same). */
export const flightSteps = (st: Walkway): number =>
  st.steps ?? Math.max(2, Math.round((st.ay - st.by) / 0.17))

/**
 * Where a point stands on a walkway: its height (a stair's tread top, a deck's planks), or null off it.
 * A flight's treads: step k (from the top) runs along [k, k + 1] treads at ay − k·rise; the first is
 * flush with the upper road and the last one rise over the lower one, as the mesh is built.
 */
export function walkwayAt(st: Walkway, px: number, pz: number): number | null {
  const lx = st.bx - st.ax
  const lz = st.bz - st.az
  const len = Math.hypot(lx, lz)
  const dx = px - st.ax
  const dz = pz - st.az
  const along = (dx * lx + dz * lz) / len
  if (along < -0.05 || along > len + 0.05) return null
  if (Math.abs((dx * -lz + dz * lx) / len) > st.half + (st.kind === "stairs" ? 0.02 : 0.05)) return null
  if (st.kind === "deck") {
    const f = Math.min(1, Math.max(0, along / len))
    return st.ay + (st.by - st.ay) * f
  }
  const n = flightSteps(st)
  const k = Math.min(n - 1, Math.max(0, Math.floor((along / len) * n)))
  return st.ay - (k * (st.ay - st.by)) / n
}

/** A flight's two cheeks and a deck leg's two rails as solids (wall). */
export function walkwaySolids(st: Walkway): Solid[] {
  const len = Math.hypot(st.bx - st.ax, st.bz - st.az)
  const ux = (st.bx - st.ax) / len
  const uz = (st.bz - st.az) / len
  const out: Solid[] = []
  const off = st.kind === "stairs" ? st.half + CHEEK_OUT : st.half + 0.12
  const wid = st.kind === "stairs" ? CHEEK_W : 0.14
  // a deck's rails run its whole leg but its bank end (the road comes on there): stop short of it
  const from = 0
  const to = st.kind === "stairs" ? len : len - 0.5
  if (to <= from) return out
  const mx = st.ax + ux * ((from + to) / 2)
  const mz = st.az + uz * ((from + to) / 2)
  for (const side of [-1, 1])
    out.push(
      boxSolid(
        "wall",
        mx - uz * side * off,
        mz + ux * side * off,
        ux,
        uz,
        to - from,
        wid,
        Math.min(st.ay, st.by),
      ),
    )
  return out
}

export interface HexCollide {
  solids: readonly Solid[]
  /** The solids near a point (their round within `r`). */
  solidsNear(x: number, z: number, r: number): Solid[]
  /** Where feet stand at a point: a stair's tread, a bridge's deck, else the ground. */
  heightAt(x: number, z: number): number
  /** A stair's tread or a deck's planks at a point, or null off every walkway. */
  walkwayAt(x: number, z: number): number | null
  /** Whether a body of radius `r` can stand at (x, z): out of every solid, on dry ground or a walkway. */
  isWalkable(x: number, z: number, r: number, kinds?: (k: SolidKind) => boolean): boolean
  /**
   * Moves a body of radius `r` at (x, z) out of the solids it stands in (the shortest way, a few rounds);
   * writes the place to `out` and returns how far it moved.
   */
  pushOut(x: number, z: number, r: number, out: [number, number], kinds?: (k: SolidKind) => boolean): number
}

export interface CollideInputs {
  /** The solids, built (a TileFurniture's: pieces, authored blockers, cheeks and rails) … */
  solids?: readonly Solid[]
  /** … or the pieces to build them from (then the walkways' cheeks and rails are added). */
  pieces?: readonly PlacedPiece[]
  walkways: readonly Walkway[]
  /** The ground's height at a point (the fine ground the mesh is). */
  ground(x: number, z: number): number
  /** Whether a point is over water no walkway crosses (lake, river, sea). */
  wet?(x: number, z: number): boolean
}

/** The collision layer of a world's pieces, walkways and ground. */
export function hexCollide(inp: CollideInputs): HexCollide {
  const solids: Solid[] = [...(inp.solids ?? [])]
  if (inp.pieces) {
    for (const p of inp.pieces) solids.push(...pieceSolids(p))
    for (const st of inp.walkways) solids.push(...walkwaySolids(st))
  }
  const grid = new SolidGrid(solids)
  // walkways in 4 m cells as well
  const ways = new Map<number, Walkway[]>()
  for (const st of inp.walkways) {
    const x0 = Math.min(st.ax, st.bx) - st.half - 0.3
    const x1 = Math.max(st.ax, st.bx) + st.half + 0.3
    const z0 = Math.min(st.az, st.bz) - st.half - 0.3
    const z1 = Math.max(st.az, st.bz) + st.half + 0.3
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const key = cellKey(cx, cz)
        const list = ways.get(key)
        if (list) list.push(st)
        else ways.set(key, [st])
      }
  }
  const onWay = (x: number, z: number): number | null => {
    for (const st of ways.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const y = walkwayAt(st, x, z)
      if (y !== null) return y
    }
    return null
  }
  const dir: [number, number] = [0, 0]
  const all = () => true
  return {
    solids,
    solidsNear: (x, z, r) => grid.near(x, z, r),
    heightAt: (x, z) => onWay(x, z) ?? inp.ground(x, z),
    walkwayAt: onWay,
    isWalkable(x, z, r, kinds = all) {
      if (onWay(x, z) === null && inp.wet?.(x, z)) return false
      for (const s of grid.near(x, z, r)) if (kinds(s.kind) && solidDistance(s, x, z) < r) return false
      return true
    },
    pushOut(x, z, r, out, kinds = all) {
      let px = x
      let pz = z
      for (let round = 0; round < 3; round++) {
        let moved = false
        for (const s of grid.near(px, pz, r)) {
          if (!kinds(s.kind)) continue
          const d = solidDistance(s, px, pz, dir)
          if (d >= r) continue
          px += dir[0] * (r - d + 1e-3)
          pz += dir[1] * (r - d + 1e-3)
          moved = true
        }
        if (!moved) break
      }
      out[0] = px
      out[1] = pz
      return Math.hypot(px - x, pz - z)
    },
  }
}

/** What `fitToTiles` needs of the world's tiles. */
export interface TileSeats {
  /** The tile under a point, −1 off the grid. */
  tileAt(x: number, z: number): number
  /** A tile's centre. */
  centre(i: number): [number, number]
  /** Its neighbour across side d (0–5, the edge whose outward normal is (cos 60°·d, −sin 60°·d)), −1 for none. */
  neighbour(i: number, d: number): number
  /** Whether a piece standing at height y on tile i may reach over onto tile j (same ground height, dry). */
  shares(i: number, j: number, y: number): boolean
  /** The tiles' hex radius. */
  R: number
}

/** The least a piece is made to fit its seat, of its size. */
const MIN_FIT_SCALE = 0.7
/** A tile side's outward normal (tilePath's sides: d at 60°·d from +x, toward −z). */
const SIDE_NORMALS: [number, number][] = [0, 1, 2, 3, 4, 5].map((d) => [
  Math.cos((Math.PI / 3) * d),
  -Math.sin((Math.PI / 3) * d),
])

/**
 * Keeps every building, wall and tower on its own tile's seat (the user: "buildings must always have a
 * terrain block below them"): where its outline reaches over an edge onto a tile it may not share (lower,
 * higher, water, off the island), it moves inward by as much, and if it still does not fit it is made a
 * little smaller (at most to 0.8 of its size). Moves the pieces in place; returns how many moved.
 */
export function fitToTiles(
  pieces: PlacedPiece[],
  seats: TileSeats,
  only?: (p: PlacedPiece) => boolean,
  /** Whether a piece, where it now stands, keeps clear of the buildings round it (a move that would not is not made). */
  clear?: (p: PlacedPiece) => boolean,
): number {
  const e = (seats.R * Math.sqrt(3)) / 2
  let moved = 0
  for (const p of pieces) {
    const kind = solidKind(p.piece)
    if ((kind !== "building" && kind !== "wall") || (only && !only(p))) continue
    const own = seats.tileAt(p.x, p.z)
    if (own < 0) continue
    const [cx, cz] = seats.centre(own)
    const sides = [0, 1, 2, 3, 4, 5].filter((d) => {
      const j = seats.neighbour(own, d)
      return j < 0 || !seats.shares(own, j, p.y)
    })
    if (!sides.length) continue
    /** How far the outline reaches past each closed side's edge (≤ 0: inside). */
    const over = (): number[] => {
      const s = pieceFootprint(p)
      if (!s) return []
      return sides.map((d) => {
        const [nx, nz] = SIDE_NORMALS[d]!
        let m = Number.NEGATIVE_INFINITY
        for (let k = 0; k < s.pts.length; k += 2)
          m = Math.max(m, (s.pts[k]! - cx) * nx + (s.pts[k + 1]! - cz) * nz)
        return m - e
      })
    }
    const scale0 = p.scale
    for (let round = 0; round < 12; round++) {
      const o = over()
      if (!o.length || o.every((v) => v <= 0.01)) break
      if (round % 2 === 0) {
        // inward, off every side it reaches over
        let dx = 0
        let dz = 0
        for (const [k, v] of o.entries()) {
          if (v <= 0.01) continue
          const [nx, nz] = SIDE_NORMALS[sides[k]!]!
          dx -= nx * (v + 0.02)
          dz -= nz * (v + 0.02)
        }
        p.x += dx
        p.z += dz
        // into a neighbour: back, and smaller where it stands instead
        if (clear && !clear(p)) {
          p.x -= dx
          p.z -= dz
          p.scale = Math.max(scale0 * MIN_FIT_SCALE, p.scale * 0.94)
        }
      } else p.scale = Math.max(scale0 * MIN_FIT_SCALE, p.scale * 0.94)
      if (round === 0) moved++
    }
  }
  return moved
}
