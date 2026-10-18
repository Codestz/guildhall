/**
 * A tile's blockers (what people walk round on it, the tile composer's) as real shapes: an oriented box
 * for a crate, a cart, a stall, a bench; a circle for what really is round (a barrel, a well, a tree's
 * trunk, a bush). Most are written as the piece they cover (`{ of: k }`, its index among the prefab's
 * pieces): the shape is worked out from that piece's own outline as placed (outlines.ts, read off its
 * model in the band people walk in; turned, scaled and stretched as it stands), so it matches what is
 * drawn and follows the piece when it moves. A box or a circle may still be written out by hand where no
 * piece says it (the ground between an archery range's targets, a crop row), and an old disc (`{x,z,r}`)
 * loads as the circle it always was.
 *
 *   { of: 3 }                       the shape of piece 3, as placed
 *   { of: 3, pad: 0.1 }             … grown by 10 cm all round
 *   { x, z, w, d, rot }             a box: `w` along its own x, `d` along its own z, turned like a piece
 *   { x, z, r }                     a circle
 */
import {
  boxSolid,
  discSolid,
  OVERHEAD,
  pieceOutline,
  type Solid,
  solidKind,
  solidToFoot,
  TRUNK_R,
} from "./collide.ts"

/** A circle, tile space (an old disc reads as one). */
export interface BlockerCircle {
  x: number
  z: number
  r: number
}
/** An upright box: its middle, `w` along its own x and `d` along its own z, turned by `rot` (as a piece is). */
export interface BlockerBox {
  x: number
  z: number
  w: number
  d: number
  rot?: number
}
/** The shape of one of the prefab's pieces, as placed (grown by `pad` metres). */
export interface BlockerOf {
  of: number
  pad?: number
}
export type TileBlocker = BlockerCircle | BlockerBox | BlockerOf

/** A blocker's shape once worked out: a circle or a box, in the frame its piece (or the tile) is written in. */
export type BlockerShape = ({ kind: "circle" } & BlockerCircle) | ({ kind: "box"; rot: number } & BlockerBox)

export const isBlockerOf = (b: TileBlocker): b is BlockerOf => "of" in b
export const isBlockerBox = (b: TileBlocker): b is BlockerBox => "w" in b

/** What a piece is to its blocker: where it stands and how it is turned, scaled and stretched. */
export interface BlockerPiece {
  piece: string
  x: number
  z: number
  rot: number
  scale: number
  stretch?: number
}

/**
 * A part this round is a circle (its isoperimetric quotient, 4πA/P²: a circle's 1, an octagon's 0.95, a
 * square's 0.79), if it is about as wide as long.
 */
const ROUND = 0.89
const ROUND_ASPECT = 1.25

/** The parts of a piece people walk round, at scale 1 in its own frame: a closed building's foot, else its parts. */
function partsOf(piece: string, scale: number): Float64Array[] {
  const o = pieceOutline(piece)
  if (!o) return []
  if (solidToFoot(piece) || !o.hulls.length) return [o.foot]
  // (a roof's frame over a body's head is walked under)
  return o.hulls.filter((_, k) => (o.bottoms[k] ?? 0) * scale < OVERHEAD)
}

/**
 * A placed piece's blocker shapes (in the frame it is placed in): a tree by its trunk; else each part a
 * box, or a circle where the part is round. None when the library has no outline of it.
 */
export function pieceBlockerShapes(p: BlockerPiece, pad = 0): BlockerShape[] {
  if (solidKind(p.piece) === "trunk") return [{ kind: "circle", x: p.x, z: p.z, r: TRUNK_R * p.scale + pad }]
  const k = p.scale
  const sx = p.stretch ?? 1
  const c = Math.cos(p.rot)
  const s = Math.sin(p.rot)
  const out: BlockerShape[] = []
  for (const part of partsOf(p.piece, p.scale)) {
    const n = part.length / 2
    const xs: number[] = []
    const zs: number[] = []
    let area = 0
    for (let j = 0; j < n; j++) {
      xs.push(part[j * 2]! * sx)
      zs.push(part[j * 2 + 1]!)
    }
    let perimeter = 0
    for (let j = 0; j < n; j++) {
      area += xs[j]! * zs[(j + 1) % n]! - xs[(j + 1) % n]! * zs[j]!
      perimeter += Math.hypot(xs[(j + 1) % n]! - xs[j]!, zs[(j + 1) % n]! - zs[j]!)
    }
    area = Math.abs(area) / 2
    const box = fitBox(xs, zs)
    if (!box) continue
    const { a, mu, mv, w, d } = box
    // the box's middle in the piece's frame (its own x turned by `a`, as `turn` turns), then placed
    const mx = mu * Math.cos(a) + mv * Math.sin(a)
    const mz = -mu * Math.sin(a) + mv * Math.cos(a)
    const cx = p.x + (mx * c + mz * s) * k
    const cz = p.z + (-mx * s + mz * c) * k
    const round = (4 * Math.PI * area) / (perimeter * perimeter)
    if (round > ROUND && Math.max(w, d) / Math.min(w, d) < ROUND_ASPECT) {
      // round: between its half-width and its corners' reach
      let reach = 0
      for (let j = 0; j < n; j++) reach = Math.max(reach, Math.hypot(xs[j]! - mx, zs[j]! - mz))
      out.push({ kind: "circle", x: cx, z: cz, r: ((Math.max(w, d) / 2 + reach) / 2) * k + pad })
    } else out.push({ kind: "box", x: cx, z: cz, w: w * k + 2 * pad, d: d * k + 2 * pad, rot: p.rot + a })
  }
  return out
}

/** A box turned off the piece's own axes is only taken when it is this much smaller (a wall standing diagonally). */
const TURNED_GAIN = 0.85

/**
 * The least box round a convex outline (its sides along one of the outline's edges, or the piece's own
 * axes when that is about as small): its turn `a` (as a piece turns), its middle along its own x and z
 * (`mu`, `mv`), its sides.
 */
function fitBox(
  xs: readonly number[],
  zs: readonly number[],
): { a: number; mu: number; mv: number; w: number; d: number } | null {
  const n = xs.length
  const at = (a: number) => {
    // the box's own x is (cos a, −sin a) and its z (sin a, cos a) in the piece's frame
    const ux = Math.cos(a)
    const uz = -Math.sin(a)
    let u0 = Number.POSITIVE_INFINITY
    let u1 = Number.NEGATIVE_INFINITY
    let v0 = Number.POSITIVE_INFINITY
    let v1 = Number.NEGATIVE_INFINITY
    for (let j = 0; j < n; j++) {
      const u = xs[j]! * ux + zs[j]! * uz
      const v = -xs[j]! * uz + zs[j]! * ux
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    return { a, mu: (u0 + u1) / 2, mv: (v0 + v1) / 2, w: u1 - u0, d: v1 - v0 }
  }
  const square = at(0)
  if (!(square.w > 0 && square.d > 0)) return null
  let best = square
  for (let j = 0; j < n; j++) {
    const dx = xs[(j + 1) % n]! - xs[j]!
    const dz = zs[(j + 1) % n]! - zs[j]!
    if (Math.hypot(dx, dz) < 1e-6) continue
    // the edge's direction as a turn (x → (cos a, −sin a)), folded into a quarter
    let a = Math.atan2(-dz, dx) % (Math.PI / 2)
    if (a < 0) a += Math.PI / 2
    const b = at(a)
    if (b.w > 0 && b.d > 0 && b.w * b.d < best.w * best.d) best = b
  }
  return best.w * best.d < square.w * square.d * TURNED_GAIN ? best : square
}

/**
 * A blocker's shapes in its prefab's frame (tile space), from its pieces as written: the composer's and
 * the checks' view. `of` a piece with no outline (or no such piece) gives none.
 */
export function blockerShapes(b: TileBlocker, pieces: readonly BlockerPiece[]): BlockerShape[] {
  if (isBlockerOf(b)) {
    const p = pieces[b.of]
    return p ? pieceBlockerShapes(p, b.pad ?? 0) : []
  }
  if (isBlockerBox(b)) return [{ kind: "box", x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot ?? 0 }]
  return [{ kind: "circle", x: b.x, z: b.z, r: b.r }]
}

/** A shape placed in a frame turned by `rot` about (ox, oz) (a tile in the world), as a solid. */
export function shapeSolid(sh: BlockerShape, ox = 0, oz = 0, rot = 0, base = 0): Solid {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const x = ox + sh.x * c + sh.z * s
  const z = oz - sh.x * s + sh.z * c
  if (sh.kind === "circle") return discSolid("blocker", x, z, sh.r, base)
  // the box's own x, turned by its rot and the frame's (collide.ts `turn`: x → (cos, −sin))
  const a = sh.rot + rot
  return boxSolid("blocker", x, z, Math.cos(a), -Math.sin(a), sh.w, sh.d, base)
}

/** A shape mirrored left for right (x → −x), as mirrorPrefab turns a piece the other way. */
export function mirrorBlocker(b: TileBlocker): TileBlocker {
  if (isBlockerOf(b)) return b
  if (isBlockerBox(b)) return { ...b, x: -b.x, ...(b.rot !== undefined ? { rot: -b.rot } : {}) }
  return { ...b, x: -b.x }
}

/** How far a point is from a shape (negative inside), in the shape's own frame. */
export function shapeDistance(sh: BlockerShape, x: number, z: number): number {
  if (sh.kind === "circle") return Math.hypot(x - sh.x, z - sh.z) - sh.r
  const c = Math.cos(sh.rot)
  const s = Math.sin(sh.rot)
  // into the box's own frame (the inverse of `turn`)
  const dx = x - sh.x
  const dz = z - sh.z
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const qx = Math.abs(lx) - sh.w / 2
  const qz = Math.abs(lz) - sh.d / 2
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0))
  return out > 0 ? out : Math.max(qx, qz)
}

/** Lower than this (metres, as placed) a piece is ground underfoot, never what a blocker covers. */
const FLAT = 0.12
/** Ground no blocker is written for (a path, a patch, a plate, a river's bed): a disc on one is for what stands by it. */
const UNDERFOOT = /(^|\/|-)(path|patch|floor|ground|plate|tiles|rug|carpet)(-|$)/

/** A blocker written as a disc, matched to a piece: which, how far off, and how its shape compares. */
export interface BlockerMatch {
  /** The disc's index among the prefab's blockers. */
  k: number
  /** The piece it covers (none: no piece is under it, it stays as written). */
  of?: number
  /** How far the disc's middle is from the piece's. */
  off: number
  /** The disc's radius, and the round the piece's shape fits in. */
  r: number
  reach: number
  /** Left out: a closed building's (its foot is walked round already). */
  dropped?: boolean
}

/**
 * The prefab's blockers written as discs over pieces (the composer's "block it": a disc on the piece's
 * middle as wide as its catalog size) as the pieces' own shapes (`{ of }`). A disc is a piece's when that
 * piece's middle is within its inner half (at least 0.35 m) and the piece has an outline that stands up
 * off the ground; the nearest wins, and each piece takes one disc (two crates stacked: one each). A disc
 * on no piece (the ground between an archery range's targets) stays as it is. Pure.
 */
export function blockersAsPieces(prefab: {
  pieces: readonly (BlockerPiece & { y?: number })[]
  blockers?: readonly TileBlocker[]
}): { blockers: TileBlocker[]; matches: BlockerMatch[] } {
  const blockers = [...(prefab.blockers ?? [])]
  const matches: BlockerMatch[] = []
  const taken = new Set<number>()
  // already a piece's: that piece is taken
  for (const b of blockers) if (isBlockerOf(b)) taken.add(b.of)
  const stands = (p: BlockerPiece) => {
    const o = pieceOutline(p.piece)
    return !!o && o.top * p.scale >= FLAT && !UNDERFOOT.test(p.piece) && pieceBlockerShapes(p).length > 0
  }
  // nearest pairs first, so a disc on one crate of a stack does not take the other's
  const pairs: { k: number; i: number; d: number }[] = []
  blockers.forEach((b, k) => {
    if (isBlockerOf(b) || isBlockerBox(b)) return
    const within = Math.max(0.35, b.r * 0.6)
    prefab.pieces.forEach((p, i) => {
      const d = Math.hypot(p.x - b.x, p.z - b.z)
      if (d < within && stands(p)) pairs.push({ k, i, d })
    })
  })
  pairs.sort((a, b) => a.d - b.d || a.i - b.i)
  const done = new Set<number>()
  const dropped = new Set<number>()
  for (const { k, i, d } of pairs) {
    if (done.has(k) || taken.has(i)) continue
    done.add(k)
    taken.add(i)
    const disc = blockers[k] as BlockerCircle
    // a closed building is walked round by its own foot already (spots.ts: every building blocks its
    // footprint, authored or not): a disc inside it says nothing more
    if (solidToFoot(prefab.pieces[i]!.piece)) {
      dropped.add(k)
      matches.push({ k, of: i, off: d, r: disc.r, reach: 0, dropped: true })
      continue
    }
    const shapes = pieceBlockerShapes(prefab.pieces[i]!)
    let reach = 0
    for (const sh of shapes)
      for (let j = 0, o = shapeOutline(sh, 8); j < o.length; j += 2)
        reach = Math.max(reach, Math.hypot(o[j]! - disc.x, o[j + 1]! - disc.z))
    matches.push({ k, of: i, off: d, r: disc.r, reach })
    blockers[k] = { of: i }
  }
  blockers.forEach((b, k) => {
    if (!done.has(k) && !isBlockerOf(b) && !isBlockerBox(b)) matches.push({ k, off: 0, r: b.r, reach: 0 })
  })
  return { blockers: blockers.filter((_, k) => !dropped.has(k)), matches: matches.sort((a, b) => a.k - b.k) }
}

/** A shape's corners (a box's four; a circle's `n` round it), x, z after one another: for drawing it. */
export function shapeOutline(sh: BlockerShape, n = 24): number[] {
  const out: number[] = []
  if (sh.kind === "circle") {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      out.push(sh.x + Math.cos(a) * sh.r, sh.z + Math.sin(a) * sh.r)
    }
    return out
  }
  const c = Math.cos(sh.rot)
  const s = Math.sin(sh.rot)
  for (const [a, b] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const) {
    const lx = a * sh.w
    const lz = b * sh.d
    out.push(sh.x + lx * c + lz * s, sh.z - lx * s + lz * c)
  }
  return out
}
