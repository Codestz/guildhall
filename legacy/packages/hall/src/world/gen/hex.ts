import { DMath } from "../dmath.ts"
import { type Cell, cellToWorld } from "../lands.ts"
import type { Spot } from "../layout.ts"

/**
 * The generator's hex grid: lands.ts' own (flat-top, cells as [column q, line], q − line even,
 * x = 8.66·q, z = 5·line), so a generated island lands on the same coordinates the hall draws.
 */

export const key = ([q, line]: Cell): string => `${q},${line}`
export const unkey = (id: string): Cell => {
  const [q = 0, line = 0] = id.split(",").map(Number)
  return [q, line]
}

/** Neighbour directions as lands.ts numbers them: edges 0–5 clockwise from east-south-east. */
const DIRS: readonly Cell[] = [
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
]
export const step = ([q, line]: Cell, dir: number): Cell => {
  const d = DIRS[((dir % 6) + 6) % 6] ?? [0, 0]
  return [q + d[0], line + d[1]]
}
export const neighbours = (cell: Cell): Cell[] => [0, 1, 2, 3, 4, 5].map((dir) => step(cell, dir))
export function direction(from: Cell, to: Cell): number {
  const dir = DIRS.findIndex((d) => from[0] + d[0] === to[0] && from[1] + d[1] === to[1])
  if (dir < 0) throw new Error(`hexes ${key(from)} and ${key(to)} are not neighbours`)
  return dir
}

/** Hexes from the origin. */
export function rings([q, line]: Cell): number {
  const r = (line - q) / 2
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2
}

/** The cell a world point falls in. */
export function cellAt([x, z]: Spot): Cell {
  const q0 = Math.round(x / 8.660254)
  let best: Cell = [q0, q0]
  let distance = Number.POSITIVE_INFINITY
  for (let q = q0 - 1; q <= q0 + 1; q++)
    for (let line = Math.floor(z / 5) - 2; line <= Math.ceil(z / 5) + 2; line++) {
      if ((q - line) % 2 !== 0) continue
      const [cx, cz] = cellToWorld([q, line])
      const d = DMath.hypot(cx - x, cz - z)
      if (d < distance) {
        distance = d
        best = [q, line]
      }
    }
  return best
}

/** FNV-1a, 32 bits: the stable hash behind every "random" choice. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A stable value in [0, 1) for a cell and a purpose (no sequence, so order never matters). */
export const noise = (seed: number, cell: Cell, salt: string): number =>
  hash(`${seed}:${key(cell)}:${salt}`) / 4294967296

/** mulberry32, as lands.ts seeds its scatter. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
