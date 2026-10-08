import { keepFloor } from "../world/clearance.ts"
import type { Post, Spot } from "../world/layout.ts"

/**
 * Room for a crowd in the keep (Chapter 2: 100–300 adventurers). The tavern has six stools and the
 * hearth nine places on the floor; the infirmary three beds and three bedrolls. Past them the
 * crowd used to take the same places again, two or ten bodies on one spot. Now whoever is past
 * them takes the nearest free floor round the place instead: open floor between the furniture,
 * off everyone's posts, nearest first, and nobody handed a spot someone else has
 * (test/crowd.test.ts).
 *
 * The floor is a lattice (world/clearance.ts `keepFloor`), worked out the first time a place
 * overflows and kept: a story that never overflows never pays for it.
 */

/**
 * One cast's claims on the floor (one `viewsOf`): handed out in join order, so the same stage
 * gives everyone the same spot every refresh.
 */
export class Crowd {
  private taken = new Set<string>()
  private next = new Map<string, number>()
  private sharing = new Map<string, number>()

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

  /**
   * A post several are sent to at once (a party's hand-in): the first stands on it, the rest on
   * the nearest free floor round it, all facing the post's way.
   */
  share(post: Post): Post {
    const key = spotKey([post[0], post[1]])
    const sharing = this.sharing.get(key) ?? 0
    this.sharing.set(key, sharing + 1)
    if (sharing === 0) return post
    const [x, z] = this.near([post[0], post[1]])
    return [x, z, post[2]]
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
