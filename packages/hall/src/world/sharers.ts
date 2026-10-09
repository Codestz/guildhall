import { activeWorld } from "./active.ts"
import { beside, LOCAL_WALK, type Place, type Spots, type Step, spotsOf } from "./behaviours.ts"
import {
  BODY,
  blocker,
  islandObstacles,
  keepObstacles,
  type Obstacle,
  onDryLand,
  onKeepFloor,
} from "./clearance.ts"
import { districtById } from "./districtWork.ts"
import type { SiteId } from "./lands.ts"
import { type Post, type Spot, STATIONS, type StationId } from "./layout.ts"
import { sitesOf } from "./siteMap.ts"

/**
 * Room for a crowd at a berth (Chapter 2: 100–300 adventurers). Past a place's posts the store
 * sends the extra workers to the posts again, and each sharer gets their own standing spots, moved
 * off the post's by an offset (world/behaviours.ts `shifted`). A few sharers stand in a line beside
 * the post, as they always have; a crowd would make that line a road long, into the water and
 * through the buildings. So each sharer's offset is the nearest one round the post that keeps them
 * a body apart from everyone else at the place and puts every spot their routine stands on, and
 * every short walk between them, on open ground: dry level land clear of the island's obstacles at
 * a site, the keep's open floor at a station (world/clearance.ts).
 *
 * The berths of a place take their spots in turns, lap by lap, so a berth's offsets never depend
 * on how many share the others. Worked out the first time a place overflows and kept.
 */

/** Spots a lattice step apart: two bodies (BODY 0.35) this far apart never touch. */
const STEP = 1
/** The nearest a sharer's post comes to anyone else's post at the place. */
const APART = 0.95
/** The furthest a sharer stands from the post. */
const REACH = 12
/** The legacy line: how many sharers stand beside the post before the crowd spreads round it. */
const LINE = 3
/** Points along a walk, this far apart, each kept clear. */
const ALONG = 0.25

/** The offset of the `lap`-th sharer of `place`'s berth (lap ≥ 1). */
export function spread(place: Place, lap: number): Spot {
  const field = fieldOf(place)
  if (!field) return beside(place, lap)
  const own = field.offsets[place.berth]
  if (!own) return beside(place, lap)
  while (own.length < lap && field.rounds < MAX_ROUNDS) field.round()
  // Past every open spot round the post: they share again, rather than stand nowhere.
  return own[(lap - 1) % Math.max(1, own.length)] ?? beside(place, lap)
}

/** More rounds than any berth has open spots: the search stops there. */
const MAX_ROUNDS = 120

/** Each world's fields, by place key (the active world's: world/active.ts; the hand map's by default). */
const fields = new WeakMap<object, Map<string, Field | null>>()
const HAND = {}

function fieldOf(place: Place): Field | undefined {
  const world = activeWorld()
  const known = fields.get(world ?? HAND) ?? new Map<string, Field | null>()
  fields.set(world ?? HAND, known)
  let field = known.get(place.key)
  if (field === undefined) {
    const posts = postsOf(place.key)
    field = posts ? new Field(place, posts) : null
    known.set(place.key, field)
  }
  return field ?? undefined
}

/** The posts of a place, from its key (`site:forest`, `station:forge`, `district:compiler`), on the active world. */
function postsOf(key: string): readonly Post[] | undefined {
  const colon = key.indexOf(":")
  const kind = key.slice(0, colon)
  const id = key.slice(colon + 1)
  if (kind === "site") return sitesOf()[id as SiteId]?.posts
  if (kind === "station") return STATIONS[id as StationId]?.posts
  if (kind === "district") return districtById(id)?.posts
  return undefined
}

/** One place's ground and who has which part of it. */
class Field {
  /** Each berth's offsets, lap 1 first. */
  readonly offsets: Spot[][]
  rounds = 0
  private readonly berths: { spots: Spots; candidates: Spot[]; next: number }[]
  /** Sharers' posts, as they are handed out. */
  private readonly posts: Spot[] = []
  /** Where the place's own workers stand and walk to (their posts too): no sharer stands on them. */
  private readonly stands: Spot[] = []
  private readonly island: boolean
  private readonly obstacles: readonly Obstacle[]
  private readonly walks: readonly (readonly Step[])[]
  private readonly marks: ReadonlySet<string>

  constructor(place: Place, posts: readonly Post[]) {
    const { behaviour } = place
    this.island = !place.key.startsWith("station:")
    this.marks = behaviour.marks
    this.walks = [behaviour.loop, ...(behaviour.steer ?? []).map((s) => s.steps)]
    this.berths = posts.map((post, berth) => ({
      spots: spotsOf(behaviour, post, berth),
      candidates: candidates(post),
      next: 0,
    }))
    this.offsets = posts.map(() => [])
    for (const { spots } of this.berths)
      for (const [name, at] of Object.entries(spots)) if (!this.marks.has(name)) this.stands.push(at)
    // Only what is within reach of the place: the island has thousands of obstacles.
    const all = this.island ? islandObstacles() : keepObstacles()
    const near = REACH + LOCAL_WALK + 1
    this.obstacles = all.filter((o) => this.stands.some(([x, z]) => o.distance(x, z) < near))
  }

  /** One more lap for every berth: the next open offset round each post, in berth order. */
  round(): void {
    this.rounds++
    this.berths.forEach((berth, n) => {
      while (berth.next < berth.candidates.length) {
        const offset = berth.candidates[berth.next++] as Spot
        if (!this.open(berth.spots, offset)) continue
        const post = berth.spots.post as Spot
        this.posts.push([post[0] + offset[0], post[1] + offset[1]])
        this.offsets[n]?.push(offset)
        return
      }
    })
  }

  /** Can a sharer stand at `spots` moved by `offset`: apart from everyone, on open ground throughout? */
  private open(spots: Spots, [dx, dz]: Spot): boolean {
    const post = spots.post as Spot
    const at: Spot = [post[0] + dx, post[1] + dz]
    if (this.posts.some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < APART)) return false
    if (this.stands.some((s) => Math.hypot(s[0] - at[0], s[1] - at[1]) < APART)) return false
    for (const [name, spot] of Object.entries(spots))
      if (!this.marks.has(name) && !this.ground([spot[0] + dx, spot[1] + dz], BODY)) return false
    // Every short walk of the loop and the steers (the long ones take the roads: behaviours `legOf`).
    for (const steps of this.walks) {
      let from = at
      for (const step of [...steps, ...steps]) {
        if (!("walk" in step)) continue
        const base = spots[step.walk]
        if (!base) continue
        const to: Spot = [base[0] + dx, base[1] + dz]
        if (Math.hypot(to[0] - from[0], to[1] - from[1]) < LOCAL_WALK && !this.clearWalk(from, to))
          return false
        from = to
      }
    }
    return true
  }

  private clearWalk(from: Spot, to: Spot): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / ALONG))
    for (let k = 1; k < n; k++) {
      const t = k / n
      if (!this.ground([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], BODY * 0.6))
        return false
    }
    return true
  }

  /** Open ground for a body `clearance` round: dry land on the island, open floor in the keep. */
  private ground(spot: Spot, clearance: number): boolean {
    if (this.island ? !onDryLand(spot) : !onKeepFloor(spot)) return false
    return !blocker(spot, this.obstacles, clearance)
  }
}

/**
 * Offsets round a post, nearest first: the line beside it, then rows across its facing, staggered,
 * from a step ahead (beside the work, never in front of it) to well behind.
 */
function candidates(post: Post): Spot[] {
  const fake = { post } as Place
  const line = Array.from({ length: LINE }, (_, k) => beside(fake, k + 1))
  const facing = post[2]
  const right: Spot = [-Math.cos(facing), Math.sin(facing)]
  const back: Spot = [-Math.sin(facing), -Math.cos(facing)]
  const rows: { offset: Spot; away: number }[] = []
  const deep = Math.ceil(REACH / (STEP * 0.87))
  for (let row = -1; row <= deep; row++)
    for (let col = -REACH; col <= REACH; col++) {
      const side = (col + (row % 2 === 0 ? 0 : 0.5)) * STEP
      const behind = row * STEP * 0.87
      const away = Math.hypot(side, behind)
      if (away < STEP * 0.5 || away > REACH) continue
      // A step ahead only out to the side: never between a worker and their work.
      if (behind < 0 && Math.abs(side) < 1.5) continue
      rows.push({
        offset: [side * right[0] + behind * back[0], side * right[1] + behind * back[1]],
        away,
      })
    }
  rows.sort((a, b) => a.away - b.away || a.offset[0] - b.offset[0] || a.offset[1] - b.offset[1])
  return [...line, ...rows.map((r) => r.offset)]
}
