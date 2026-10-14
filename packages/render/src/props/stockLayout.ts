/**
 * How a stock looks at a level (pure): the pieces it is drawn with, in its frame (x right of its facing,
 * z ahead, y up, metres). What work leaves (world routines.ts `Stock`) counts on all day; it is drawn as
 * `min(count, cap)` mapped to a few levels (decisions.md GF-A: basket 40, heap 90, pile 40), so the stock
 * batch is written only when a level changes, never per unit.
 */
import { PROPS, type StockKind } from "@guildhall/world"

export type DrawnKind = StockKind | "stall-fish"

/** One piece of a stock as drawn: its catalog id, place, turn about y (and a tilt about x), scale. */
export interface StockPiece {
  piece: string
  at: readonly [number, number, number]
  yaw: number
  tilt?: number
  scale: number
  /** Rides the cart (moves along the rail with it). */
  cart?: boolean
}

export const BASKET = "built/basket"
export const CART = "built/cart"
export const FLOAT = "built/float"
export const CRATE = "kaykit-dungeon/box-small"
export const TRACK = "kaykit-holiday/tracks-straight"
/** A track piece's length along its rail, metres. */
export const TRACK_LEN = 2

/** Levels a kind is drawn at (0: empty), and the units each level shows (the last: full). */
export const LEVELS: Readonly<Record<DrawnKind, readonly number[]>> = {
  basket: [0, 1, 3, 5, 7],
  "log-pile": [0, 3, 6, 10, 15],
  "ore-heap": [0, 4, 9, 16, 25],
  planks: [0, 2, 4, 7, 10],
  crates: [0, 2, 4, 6, 9],
  bars: [0, 2, 4, 6, 9],
  // counted one by one: a cart's six throws, the butts' ten arrows, a stall's four baskets
  "ore-cart": [0, 1, 2, 3, 4, 5, 6],
  arrows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "stall-fish": [0, 1, 2, 3, 4],
}

/** The caps a stock is drawn to (decisions.md GF-A); a kind not named here draws to its own cap. */
export const DRAWN_CAP: Partial<Record<DrawnKind, number>> = { basket: 40, "ore-heap": 90, "log-pile": 40 }

/**
 * The level a stock of `kind` shows with `count` units (`cap`: what fills it): `min(count, cap)` over the
 * kind's levels, the first unit always showing something, a full one the last level.
 */
export function stockLevel(kind: DrawnKind, count: number, cap: number): number {
  const levels = LEVELS[kind]
  const top = levels.length - 1
  const full = Math.max(1, DRAWN_CAP[kind] ?? cap)
  const n = Math.max(0, Math.min(count, full))
  if (n <= 0) return 0
  // one by one: the count itself (to the last level)
  if (levels[top] === top) return Math.min(top, Math.round(n))
  return Math.max(1, Math.min(top, Math.ceil((n / full) * top)))
}

/** A seeded number in [0, 1) for piece k of a stock (the same each time it is laid out). */
const jitter = (k: number, salt: number) => {
  const x = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

const P = PROPS

/** Pieces in a round heap: rings outward, each ring a little lower; `r` the piece's spacing. */
function heap(n: number, piece: string, r: number, scale: number, base = 0): StockPiece[] {
  const out: StockPiece[] = []
  let k = 0
  for (let ring = 0; k < n; ring++) {
    const inRing = ring === 0 ? 1 : ring * 6
    for (let j = 0; j < inRing && k < n; j++, k++) {
      const a = (j / inRing) * Math.PI * 2 + ring * 0.5
      const rr = ring * r
      out.push({
        piece,
        at: [Math.cos(a) * rr, base, Math.sin(a) * rr],
        yaw: jitter(k, 1) * Math.PI * 2,
        scale: scale * (0.85 + jitter(k, 2) * 0.3),
      })
    }
  }
  // the inner rings sit on the outer ones: the heap rises to its middle
  const rings = Math.ceil((Math.sqrt(12 * n - 3) - 3) / 6) + 1
  return out.map((p) => {
    const d = Math.hypot(p.at[0], p.at[2]) / Math.max(r, 1e-3)
    return { ...p, at: [p.at[0], p.at[1] + Math.max(0, rings - 1 - d) * r * 0.55, p.at[2]] }
  })
}

/** Long pieces stacked: rows of `perRow` side by side across x, each row up one `h` and one fewer. */
function stack(n: number, piece: string, w: number, h: number, scale: number): StockPiece[] {
  const out: StockPiece[] = []
  let row = 0
  let k = 0
  while (k < n) {
    const inRow = Math.max(1, 5 - row)
    const across = Math.min(inRow, n - k)
    for (let j = 0; j < across; j++, k++)
      out.push({
        piece,
        at: [(j - (inRow - 1) / 2) * w, row * h, (jitter(k, 3) - 0.5) * 0.08],
        yaw: (jitter(k, 4) - 0.5) * 0.12,
        scale,
      })
    row++
  }
  return out
}

/**
 * A stock's pieces at a level (its container, if it has one, first). `stock.piece` is what one unit
 * is (a fish, a log, ore). A cart's ore rides it (`cart`); its rail is laid separately (`railPieces`).
 */
export function stockLayout(kind: DrawnKind, level: number, piece: string): StockPiece[] {
  const n = LEVELS[kind][Math.max(0, Math.min(level, LEVELS[kind].length - 1))] ?? 0
  switch (kind) {
    case "basket":
      return [
        { piece: BASKET, at: [0, 0, 0], yaw: 0.3, scale: 1 },
        ...Array.from({ length: n }, (_, k): StockPiece => {
          const a = k * 2.4
          const r = k === 0 ? 0 : 0.1
          return {
            piece: P.fish,
            at: [Math.cos(a) * r, 0.24 + Math.floor(k / 3) * 0.04, Math.sin(a) * r],
            yaw: a + 0.6,
            tilt: (jitter(k, 5) - 0.5) * 0.6,
            scale: 0.55,
          }
        }),
      ]
    case "stall-fish":
      return Array.from({ length: n }, (_, k): StockPiece[] => {
        const x = (k - 1.5) * 0.5
        return [
          { piece: BASKET, at: [x, 0, 0], yaw: k * 0.7, scale: 0.85 },
          ...[0, 1, 2].map(
            (j): StockPiece => ({
              piece: P.fish,
              at: [x + (j - 1) * 0.07, 0.21, (j % 2) * 0.05 - 0.02],
              yaw: j * 2.1 + k,
              tilt: 0.2,
              scale: 0.5,
            }),
          ),
        ]
      }).flat()
    case "log-pile":
      // logs lying along z (as a pile is stacked from the side), rows across x
      return stack(n, piece, 0.36, 0.3, 0.5)
    case "planks":
      // two stacks side by side, a plank on the last
      return Array.from(
        { length: n },
        (_, k): StockPiece => ({
          piece,
          at: [((k % 2) - 0.5) * 0.24, Math.floor(k / 2) * 0.085, (jitter(k, 3) - 0.5) * 0.06],
          yaw: (jitter(k, 4) - 0.5) * 0.1,
          scale: 0.55,
        }),
      )
    case "bars":
      return stack(n, piece, 0.17, 0.1, 0.4)
    case "ore-heap":
      return heap(n, piece, 0.2, 0.85)
    case "crates":
      return [{ piece: CRATE, at: [0, 0, 0], yaw: 0, scale: 0.5 }, ...heap(n, piece, 0.1, 0.22, 0.5)]
    case "ore-cart":
      return Array.from({ length: n }, (_, k): StockPiece => {
        const a = k * 2.1
        const r = k === 0 ? 0 : 0.17
        return {
          piece,
          at: [Math.cos(a) * r * 0.8, 0.5 + (k > 3 ? 0.08 : 0), Math.sin(a) * r * 1.2],
          yaw: k,
          scale: 0.75,
          cart: true,
        }
      })
    case "arrows":
      // stuck in the butts at chest height, pointing back to the line (their tails toward −z)
      return Array.from(
        { length: n },
        (_, k): StockPiece => ({
          piece,
          at: [(jitter(k, 6) - 0.5) * 0.55, 1.05 + (jitter(k, 7) - 0.5) * 0.5, -0.32],
          yaw: Math.PI + (jitter(k, 8) - 0.5) * 0.25,
          tilt: (jitter(k, 9) - 0.5) * 0.25,
          scale: 0.6,
        }),
      )
  }
}

/** The most pieces a kind ever shows (its full level), for the batch's room. */
export function stockRoom(kind: DrawnKind, piece: string): number {
  return stockLayout(kind, LEVELS[kind].length - 1, piece).length
}

/**
 * The rail a cart rolls (world metres): tracks end to end from its place to the rail's end and a little
 * past, along the line between them; their yaw (about +y) and centres.
 */
export function railPieces(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): { at: [number, number]; yaw: number }[] {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const len = Math.hypot(dx, dz)
  if (len < 1e-3) return []
  const yaw = Math.atan2(dx, dz)
  const n = Math.max(1, Math.ceil((len + 1) / TRACK_LEN))
  // centred on the run from half a metre behind the cart to half a metre past the end
  const start = -0.5 + (len + 1 - n * TRACK_LEN) / 2
  return Array.from({ length: n }, (_, k) => {
    const s = start + (k + 0.5) * TRACK_LEN
    return { at: [from[0] + (dx / len) * s, from[2] + (dz / len) * s], yaw }
  })
}
