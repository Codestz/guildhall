import type { Cell } from "../../lands.ts"
import { key, neighbours, rings, step, unkey } from "../hex.ts"
import { contiguous } from "../tiles.ts"

/** The land as it is planned: the district that holds each land hex, by key. Anything missing is sea. */
export type Owners = Map<string, number>

/** Rings from the hub that hold all the land, and every hex out to one ring past them. */
export function spanOf(owner: Owners): { radius: number; cells: Cell[] } {
  let radius = 0
  for (const id of owner.keys()) radius = Math.max(radius, rings(unkey(id)))
  const cells: Cell[] = []
  for (let q = -radius - 1; q <= radius + 1; q++)
    for (let line = -2 * radius - 2; line <= 2 * radius + 2; line++)
      if ((q - line) % 2 === 0 && rings([q, line]) <= radius + 1) cells.push([q, line])
  return { radius, cells }
}

/** How many of a hex's neighbours are land, and the district holding most of them (the lowest on a tie). */
export function majority(owner: Owners, cell: Cell): { count: number; district: number } {
  const counts = new Map<number, number>()
  for (const next of neighbours(cell)) {
    const i = owner.get(key(next))
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1)
  }
  let district = -1
  let most = 0
  let count = 0
  for (const [i, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    count += n
    if (n > most) {
      most = n
      district = i
    }
  }
  return { count, district }
}

/** The sides of a hex that meet the sea. */
export const wet = (owner: Owners, cell: Cell): number[] =>
  [0, 1, 2, 3, 4, 5].filter((dir) => !owner.has(key(step(cell, dir))))

/** Whether the pack's coast tiles can draw a hex meeting the sea on these sides: one run of ≤ 4. */
export const drawable = (dirs: number[]): boolean =>
  dirs.length === 0 || (dirs.length <= 4 && !!contiguous(dirs))
