import { cellToWorld } from "../../lands.ts"
import { Heap } from "../heap.ts"
import { cellAt, key, neighbours, noise, rng, unkey } from "../hex.ts"
import type { PlanDistrict } from "../plan.ts"
import { RESERVED } from "./keep.ts"
import type { Owners } from "./land.ts"
import { COUNT, SHARE, tierOf } from "./tier.ts"

/**
 * Generator v2's mountain ground (terrain v2 §2.1, as amended): ranges are laid across the whole
 * island before any road, lot or field, so they have room to stand. Each is a band of hexes round a
 * wandering spine, centred on open ground away from the keep, not out on the rim: the keep sits in
 * the plain with the ranges at a distance. Roads then cross them where they must (the passes), and
 * lots, sites and fields keep to the flatter ground between.
 */

/** Mountains stand at least this far from the keep (world units): the guild's work stays on level ground. */
export const CLEAR = 36
/** A district keeps at least this share of its hexes off the ranges. */
const KEEP_LOW = 0.4
/** The main range holds this much more land than each of the others. */
const MAIN = 1.5
/** Half a spine's length as a multiple of the square root of the range's area. */
const REACH = 0.8
/** One hex's area, square world units. */
const HEX_AREA = 86.6

type Point = readonly [number, number]
type Spine = readonly Point[]

/** The ranges' hexes, main range first: the ground the roads, lots and fields are kept off. */
export function reserveRanges(
  districts: readonly PlanDistrict[],
  owner: Owners,
  seed: number,
): Set<string>[] {
  const tier = tierOf(districts.reduce((sum, d) => sum + d.folder.files, 0))
  const count = COUNT[tier]
  if (count === 0) return []
  const apart = new Set<string>()
  for (const { square } of districts) {
    apart.add(key(square))
    for (const next of neighbours(square)) apart.add(key(next))
  }
  // Open ground: inland (a range is never a cape on the coast), clear of the keep and the squares.
  const fits = new Set<string>()
  for (const id of owner.keys()) {
    const cell = unkey(id)
    const [x, z] = cellToWorld(cell)
    if (RESERVED.has(id) || apart.has(id) || Math.hypot(x, z) < CLEAR) continue
    if (neighbours(cell).every((next) => owner.has(key(next)))) fits.add(id)
  }
  if (fits.size === 0) return []

  const random = rng(seed ^ 0x72_61_6e_67)
  const target = SHARE[tier] * owner.size
  const weights = Array.from({ length: count }, (_, m) => (m === 0 ? MAIN : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const room = weights.map((w) => Math.max(8, Math.round((target * w) / total)))
  const extent = Math.sqrt((owner.size * HEX_AREA) / Math.PI)

  // Centres: the main range inland of the island's middle, the rest each as far from the others as can be.
  const middle = centroid(fits)
  const aim: Point = [
    middle[0] + (random() - 0.5) * extent * 0.5,
    middle[1] + (random() - 0.5) * extent * 0.5,
  ]
  const centres: Point[] = [nearest(fits, aim)]
  while (centres.length < room.length) {
    let best: Point = aim
    let farthest = -1
    for (const id of [...fits].sort()) {
      const [x, z] = cellToWorld(unkey(id))
      const d = Math.min(...centres.map(([cx, cz]) => Math.hypot(x - cx, z - cz)), Math.hypot(x, z) * 1.2)
      if (d > farthest) {
        farthest = d
        best = [x, z]
      }
    }
    centres.push(best)
  }
  // The main range runs across the way out from the keep (a wall at the valley's far side).
  const spines = centres.map(([cx, cz], m) => {
    const angle = m === 0 ? Math.atan2(cz, cx) + Math.PI / 2 + (random() - 0.5) * 0.9 : random() * Math.PI
    return spineOf(cx, cz, angle, REACH * Math.sqrt((room[m] ?? 8) * HEX_AREA), random() * 6)
  })

  const hexes = new Map<number, number>()
  for (const d of owner.values()) hexes.set(d, (hexes.get(d) ?? 0) + 1)
  const held = new Map<number, number>()
  const claimed = new Map<string, number>()
  const size = room.map(() => 0)
  const heap = new Heap<[number, string, number]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  const offer = (id: string, m: number): void => {
    if (!fits.has(id) || claimed.has(id)) return
    const at = cellToWorld(unkey(id))
    heap.push([distanceTo(spines[m] ?? [], at) + 7 * noise(seed, unkey(id), "range"), id, m])
  }
  centres.forEach((centre, m) => void heap.push([0, key(cellAt(centre)), m]))
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [, id, m] = item
    if (claimed.has(id) || !fits.has(id) || (size[m] ?? 0) >= (room[m] ?? 0)) continue
    const district = owner.get(id) ?? 0
    if ((held.get(district) ?? 0) + 1 > Math.floor((hexes.get(district) ?? 0) * (1 - KEEP_LOW))) continue
    const cell = unkey(id)
    // Two ranges never touch.
    if (neighbours(cell).some((n) => claimed.has(key(n)) && claimed.get(key(n)) !== m)) continue
    claimed.set(id, m)
    size[m] = (size[m] ?? 0) + 1
    held.set(district, (held.get(district) ?? 0) + 1)
    for (const next of neighbours(cell)) offer(key(next), m)
  }
  return room.map((_, m) => new Set([...claimed].filter(([, owned]) => owned === m).map(([id]) => id)))
}

/** A spine through (cx, cz): a gently winding line of half-length `reach` along `angle`. */
function spineOf(cx: number, cz: number, angle: number, reach: number, phase: number): Spine {
  const [dx, dz] = [Math.cos(angle), Math.sin(angle)]
  return Array.from({ length: 9 }, (_, k): Point => {
    const s = (k - 4) / 4
    const bend = 0.22 * reach * Math.sin(s * Math.PI * 0.9 + phase)
    return [cx + dx * s * reach - dz * bend, cz + dz * s * reach + dx * bend]
  })
}

/** Distance from a point to a spine. */
function distanceTo(spine: Spine, [x, z]: Point): number {
  let best = Number.POSITIVE_INFINITY
  for (let k = 0; k + 1 < spine.length; k++) {
    const [ax, az] = spine[k] as Point
    const [bx, bz] = spine[k + 1] as Point
    const len = (bx - ax) ** 2 + (bz - az) ** 2
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len))
    best = Math.min(best, Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t)))
  }
  return best
}

function centroid(ids: ReadonlySet<string>): Point {
  let sx = 0
  let sz = 0
  for (const id of ids) {
    const [x, z] = cellToWorld(unkey(id))
    sx += x
    sz += z
  }
  return [sx / ids.size, sz / ids.size]
}

/** The set's hex centre nearest a world point (the lowest key on a tie). */
function nearest(ids: ReadonlySet<string>, [px, pz]: Point): Point {
  let best: Point = [px, pz]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const id of [...ids].sort()) {
    const [x, z] = cellToWorld(unkey(id))
    const d = Math.hypot(x - px, z - pz)
    if (d < bestDistance) {
      bestDistance = d
      best = [x, z]
    }
  }
  return best
}
