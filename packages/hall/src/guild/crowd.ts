import { FORGE_BUCKETS } from "../world/behaviours.ts"
import { FURNITURE } from "../world/furniture.ts"
import KIT from "../world/kit.json"
import {
  HAND_INS,
  HEARTH,
  HEARTH_SEATS,
  hearthSeat,
  INFIRMARY,
  INFIRMARY_MATS,
  type Post,
  ROOM,
  type Spot,
  STATIONS,
  TAVERN,
} from "../world/layout.ts"

/**
 * Room for a crowd in the keep (Chapter 2: 100–300 adventurers). The tavern has six stools and the
 * hearth nine places on the floor; the infirmary three beds and three bedrolls. Past them the
 * crowd used to take the same places again, two or ten bodies on one spot. Now whoever is past
 * them takes the nearest free floor round the place instead: open floor between the furniture,
 * off everyone's posts, nearest first, and nobody handed a spot someone else has
 * (test/crowd.test.ts).
 *
 * The floor is a lattice, worked out the first time a place overflows and kept: a story that
 * never overflows never pays for it.
 */

/** Lattice step, world units: two bodies (BODY 0.35) a step apart never touch. */
const STEP = 1
/** A body's radius plus a little: how far a spot keeps off furniture and the hearth. */
const ROOM_FOR_A_BODY = 0.45
/** Off any fixed post (stool, bed, station, hand-in): its owner keeps their place. */
const OFF_POSTS = 0.9
/** The hearth's stones. */
const HEARTH_RADIUS = 1.8
/** Underfoot pieces nobody walks round: rugs, floorboards. */
const FLAT = /^(floor_wood|rug_)/

/**
 * One cast's claims on the floor (one `viewsOf`): handed out in join order, so the same stage
 * gives everyone the same spot every refresh.
 */
export class Crowd {
  private taken = new Set<string>()
  private next = new Map<string, number>()

  /** The nearest free spot of the keep's floor round `centre`, facing it. */
  near(centre: Spot): Post {
    const key = spotKey(centre)
    const floor = floorNear(centre)
    let i = this.next.get(key) ?? 0
    while (i < floor.length && this.taken.has(spotKey(floor[i] as Spot))) i++
    this.next.set(key, i + 1)
    // Past every free spot in the keep (hundreds): they share again, rather than stand nowhere.
    const spot = floor[i] ?? floor[i % Math.max(1, floor.length)] ?? centre
    this.taken.add(spotKey(spot))
    return [spot[0], spot[1], Math.atan2(centre[0] - spot[0], centre[1] - spot[1])]
  }
}

const spotKey = (spot: Spot): string => `${spot[0]},${spot[1]}`

/** The keep's free floor, nearest `centre` first. */
function floorNear(centre: Spot): readonly Spot[] {
  const key = spotKey(centre)
  let sorted = SORTED.get(key)
  if (!sorted) {
    const away = (s: Spot) => Math.hypot(s[0] - centre[0], s[1] - centre[1])
    sorted = [...keepFloor()].sort((a, b) => away(a) - away(b) || a[0] - b[0] || a[1] - b[1])
    SORTED.set(key, sorted)
  }
  return sorted
}
const SORTED = new Map<string, readonly Spot[]>()

let FLOOR: Spot[] | undefined
function keepFloor(): Spot[] {
  if (FLOOR) return FLOOR
  const posts: Spot[] = [
    ...Object.values(STATIONS).flatMap((station) => station.posts),
    ...TAVERN,
    ...INFIRMARY,
    ...INFIRMARY_MATS,
    ...HAND_INS,
    ...Array.from({ length: HEARTH_SEATS }, (_, n) => hearthSeat(n)),
  ].map(([x, z]) => [x, z] as const)
  const furniture: Footprint[] = [
    ...FURNITURE.filter((p) => !FLAT.test(p.piece) && (p.y ?? 0) <= 0.5).map(
      (p): Footprint => ({ ...p, bounds: KIT[p.piece] }),
    ),
    // The forge's quench buckets stand on the floor too (world/behaviours.ts), turned as drawn.
    ...FORGE_BUCKETS.map(([x, z]): Footprint => ({ bounds: KIT.bucket_metal, x, z, rot: -0.4 })),
  ]
  FLOOR = []
  // A step in from the walls all round.
  for (let x = -ROOM.width / 2 + STEP; x <= ROOM.width / 2 - STEP; x += STEP)
    for (let z = -ROOM.depth / 2 + STEP; z <= ROOM.depth / 2 - STEP; z += STEP) {
      if (Math.hypot(x - HEARTH[0], z - HEARTH[1]) < HEARTH_RADIUS + ROOM_FOR_A_BODY) continue
      if (posts.some((s) => Math.hypot(s[0] - x, s[1] - z) < OFF_POSTS)) continue
      if (furniture.some((f) => distanceTo(f, x, z) < ROOM_FOR_A_BODY)) continue
      FLOOR.push([x, z])
    }
  return FLOOR
}

/** A placed piece's ground: its model's bounding box, at its place, turned and scaled. */
interface Footprint {
  bounds: { min: readonly number[]; max: readonly number[] }
  x: number
  z: number
  rot?: number
  scale?: number
}

/** Distance from (x, z) to a footprint: 0 inside. */
function distanceTo(f: Footprint, x: number, z: number): number {
  const scale = f.scale ?? 1
  const c = Math.cos(f.rot ?? 0)
  const s = Math.sin(f.rot ?? 0)
  const dx = x - f.x
  const dz = z - f.z
  const lx = (dx * c - dz * s) / scale
  const lz = (dx * s + dz * c) / scale
  const ox = Math.max((f.bounds.min[0] ?? 0) - lx, 0, lx - (f.bounds.max[0] ?? 0))
  const oz = Math.max((f.bounds.min[2] ?? 0) - lz, 0, lz - (f.bounds.max[2] ?? 0))
  return Math.hypot(ox, oz) * scale
}
