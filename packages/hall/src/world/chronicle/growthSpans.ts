import { rings } from "../gen/hex.ts"
import type { Cell } from "../lands.ts"

/**
 * Small pure helpers of the growth timelapse (growth.ts): hex distances, a folder's weight, and
 * film-time intervals kept as flat [on, off, on, off…] lists.
 */

/** Film seconds between two readings of the chronicle. */
export const STEP_S = 0.1
/** World radius of a hex (lands.ts: HEX_SCALE 5). */
export const HEX_R = 10 / Math.sqrt(3)

/** Hexes between two cells. */
export const hexDistance = (a: Cell, b: Cell): number => rings([a[0] - b[0], a[1] - b[1]])

/** What a folder weighs for its land: its bytes, or (a chronicle without sizes) ~2 KB a file. */
export const sizeOf = (files: number, bytes: number): number => (bytes > 0 ? bytes : files * 2048)

/** Keeps each value up for `hold` readings after it was last reached (no flicker at a boundary). */
export function held(series: Int32Array, hold: number): Int32Array {
  const out = new Int32Array(series.length)
  for (let i = 0; i < series.length; i++) {
    let top = 0
    for (let j = Math.max(0, i - hold); j <= i; j++) top = Math.max(top, series[j] as number)
    out[i] = top
  }
  return out
}

/** Intervals in which `count[i] > rank`, as flat film times. */
export function spansOf(count: Int32Array, rank: number): number[] {
  const out: number[] = []
  let on = false
  for (let i = 0; i < count.length; i++) {
    const up = (count[i] as number) > rank
    if (up !== on) out.push(i * STEP_S)
    on = up
  }
  if (on) out.push(Number.POSITIVE_INFINITY)
  return out
}

/** The union of flat interval lists, sorted. */
export function union(lists: readonly number[][]): number[] {
  const pairs: [number, number][] = []
  for (const list of lists)
    for (let i = 0; i < list.length; i += 2) pairs.push([list[i] ?? 0, list[i + 1] ?? 0])
  pairs.sort((a, b) => a[0] - b[0])
  const out: number[] = []
  for (const [on, off] of pairs) {
    const last = out.length - 1
    if (last > 0 && on <= (out[last] as number)) out[last] = Math.max(out[last] as number, off)
    else out.push(on, off)
  }
  return out
}

/** True while `t` is inside one of the intervals. */
export function heldAt(spans: readonly number[], t: number): boolean {
  for (let i = 0; i < spans.length; i += 2)
    if (t >= (spans[i] as number) && t < (spans[i + 1] as number)) return true
  return false
}

export const angleGap = (a: number, b: number): number =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
