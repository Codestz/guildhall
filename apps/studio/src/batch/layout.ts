/**
 * The batch screen's pure side: `n` static pieces as houses, crop fields and woods on a grid of cells,
 * each cell one cluster (drawn as one merged shell when far).
 */
import type { RecipeInstance } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import type { BatchCluster, BatchInstance } from "@guildhall/render"

/** A compiled house: its pieces in house space, door side +z; `key` names the recipe and seed. */
export interface House {
  key: string
  parts: readonly RecipeInstance[]
}

export type Role = "house" | "field" | "wood"

/** One cell is CELL metres a side; a field plants rows ROW metres apart, a wood a WOOD × WOOD grid. */
export const CELL = 16
const ROW = 1
const WOOD = 4
/** The share of `n` each role draws: a city's mix (plan §5: 5k crops and 1k trees in 10k). */
export const SHARE: Record<Role, number> = { house: 0.4, field: 0.5, wood: 0.1 }

export const DEFAULT_N = 10000
const MAX_N = 50000

/** `?n=` as a piece count, 1…50 000; the default when absent or not a number. */
export function parseN(text: string | null): number {
  const n = Math.round(Number(text))
  return text && Number.isFinite(n) && n > 0 ? Math.min(MAX_N, n) : DEFAULT_N
}

/** Cell coordinates ring by ring outwards from the centre, so any count stays a compact square. */
export function* spiral(): Generator<[number, number]> {
  yield [0, 0]
  for (let r = 1; ; r++)
    for (let i = -r; i < r; i++) {
      yield [i, -r]
      yield [r, i]
      yield [-i, r]
      yield [-r, -i]
    }
}

const at = (piece: string, x: number, z: number, rot: number): BatchInstance => ({
  piece,
  x,
  y: 0,
  z,
  rot,
  scale: 1,
})

/** Whichever role has the most of its share left to place. */
function nextRole(left: Record<Role, number>, budget: Record<Role, number>): Role | null {
  let best: Role | null = null
  let most = 0
  for (const role of ["house", "field", "wood"] as const) {
    const share = budget[role] > 0 ? left[role] / budget[role] : 0
    if (share > most) {
      best = role
      most = share
    }
  }
  return best
}

/**
 * `n` pieces for `seed`, one cluster per cell: about SHARE of them in houses (whole houses, so it may
 * run a house over), the rest crops in rows and trees in jittered woods, exactly. Cells go out from the
 * centre and each takes whichever role is furthest behind, so the roles interleave. A role with no
 * pieces to draw from gets none and its share goes unplaced. A house's cluster is keyed by its recipe
 * and seed (houses alike share a shell); a field or wood is its own.
 */
export function batchLayout(
  n: number,
  pieces: { houses: readonly House[]; trees: readonly string[]; crops: readonly string[] },
  seed: number,
): { clusters: BatchCluster[]; cells: Record<Role, number> } {
  const budget: Record<Role, number> = {
    house: pieces.houses.length > 0 ? Math.round(n * SHARE.house) : 0,
    field: pieces.crops.length > 0 ? Math.round(n * SHARE.field) : 0,
    wood: pieces.trees.length > 0 ? Math.round(n * SHARE.wood) : 0,
  }
  const left = { ...budget }
  const cells: Record<Role, number> = { house: 0, field: 0, wood: 0 }
  const clusters: BatchCluster[] = []
  for (const [i, j] of spiral()) {
    const role = nextRole(left, budget)
    if (!role) break
    cells[role]++
    const cx = i * CELL
    const cz = j * CELL
    const key = `${i},${j}`
    const pick = <T>(list: readonly T[], salt: string) =>
      list[Math.floor(roll(seed, `${salt}:${key}`) * list.length)] as T
    const cell = (key: string, parts: BatchInstance[], rot = 0) =>
      clusters.push({ key, parts, x: cx, y: 0, z: cz, rot, scale: 1 })
    if (role === "house") {
      const house = pick(pieces.houses, "house")
      cell(house.key, [...house.parts], (Math.floor(roll(seed, `turn:${key}`) * 4) * Math.PI) / 2)
      left.house -= Math.max(1, house.parts.length)
    } else if (role === "field") {
      const crop = pick(pieces.crops, "crop")
      const side = Math.floor((CELL - 2) / ROW)
      const parts: BatchInstance[] = []
      for (let k = 0; k < side * side && left.field > 0; k++, left.field--) {
        const x = (k % side) * ROW - ((side - 1) * ROW) / 2
        const z = Math.floor(k / side) * ROW - ((side - 1) * ROW) / 2
        parts.push(at(crop, x, z, roll(seed, `crot:${key}:${k}`) * Math.PI * 2))
      }
      cell(`field:${key}`, parts)
    } else {
      const pitch = CELL / WOOD
      const parts: BatchInstance[] = []
      for (let k = 0; k < WOOD * WOOD && left.wood > 0; k++, left.wood--) {
        const jx = (roll(seed, `tx:${key}:${k}`) - 0.5) * pitch * 0.6
        const jz = (roll(seed, `tz:${key}:${k}`) - 0.5) * pitch * 0.6
        const x = ((k % WOOD) + 0.5) * pitch - CELL / 2 + jx
        const z = (Math.floor(k / WOOD) + 0.5) * pitch - CELL / 2 + jz
        parts.push(at(pick(pieces.trees, `tree:${k}`), x, z, roll(seed, `trot:${key}:${k}`) * Math.PI * 2))
      }
      cell(`wood:${key}`, parts)
    }
    left[role] = Math.max(0, left[role])
  }
  return { clusters, cells }
}
