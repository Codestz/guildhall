/**
 * A townsperson's day as keyframes render can sample cheaply: a run of steps covering 0–24 h, each a
 * stay (standing, working or indoors at one place, with the clip to play) or a walk (a polyline with
 * height, the hour at every point, a clip per segment). `DayBuilder` lays a day out leg by leg on the
 * route graph, booking every place it stays at so no two people stand on one spot at once.
 */
import { add, sub, type Vec2 } from "../geom/vec.ts"
import { type Arc, laneLine, type RouteGraph, route, type Vec3 } from "./route.ts"
import { WALK_RULES } from "./walk.ts"

/** Standing at one place from `from` to `to` (hours). */
export interface Stay {
  kind: "stay"
  from: number
  to: number
  at: Vec3
  facing: number
  clip: string
  /** The place's key: a station id, `<station>#<k>` for a spot beside it, `node:<id>`, `lamp:<i>`, `home:<actor>`. */
  place: string
  /** Inside (at home): not drawn. */
  indoors?: true
}

/** Walking a leg: `pts[i]` is reached at hour `times[i]`; segment i is walked with `clips[i]` along walk edge `edges[i]` (−1: a step off the street). */
export interface Walk {
  kind: "walk"
  from: number
  to: number
  pts: Vec3[]
  times: number[]
  clips: string[]
  edges: number[]
}

export type Step = Stay | Walk

/** Where someone can be: a route node, the point they stand on there, and the way they face. */
export interface Spot {
  key: string
  node: number
  at: Vec2
  y: number
  facing: number
}

/** What a pose is at an hour. */
export interface Pose {
  at: Vec3
  facing: number
  clip: string
  indoors: boolean
  walking: boolean
}

/** Who is walking: metres an hour on a street, their lane (0..1 of the room), their walk clip. */
export interface Gait {
  pace: number
  lane: number
  walk: string
}

/** A heading (obb.ts: forward is `[sin h, cos h]`) looking along `d`. */
export const heading = (d: Vec2): number => Math.atan2(d[0], d[1])

/** Who stands where when: intervals per place key, with their owner. */
export class Bookings {
  private map = new Map<string, { a: number; b: number; who: string }[]>()
  free(key: string, a: number, b: number, who: string): boolean {
    if (key.startsWith("home:")) return true
    return !(this.map.get(key) ?? []).some((x) => x.who !== who && x.a < b - 1e-6 && a < x.b - 1e-6)
  }
  book(key: string, a: number, b: number, who: string): void {
    if (key.startsWith("home:") || b <= a) return
    const list = this.map.get(key) ?? []
    list.push({ a, b, who })
    this.map.set(key, list)
  }
}

/** Route lookups shared by everyone in a town: the graph and the routes found so far. */
export class Router {
  private cache = new Map<string, Arc[] | null>()
  constructor(readonly graph: RouteGraph) {}
  arcs(from: number, to: number): Arc[] | null {
    const k = `${from}>${to}`
    let got = this.cache.get(k)
    if (got === undefined) {
      got = route(this.graph, from, to)
      this.cache.set(k, got)
    }
    return got
  }
  /** Metres from one node to another (Infinity when unreachable). */
  metres(from: number, to: number): number {
    const a = this.arcs(from, to)
    return a ? a.reduce((s, x) => s + x.len, 0) : Infinity
  }
}

/** The shortest a stay may be, hours (a minute). */
const MIN_STAY = 1 / 60

/** Options of one stay. */
export interface StayAs {
  clip: string
  /** Face this way; defaults to the spot's own facing. */
  facing?: number
  indoors?: boolean
}

/**
 * Lays out one day. It starts at `start` at 00:00 (staying as `first`), each `go` walks on to the
 * first candidate reachable in time and free, and `close` walks back to `start` and stays until 24:00,
 * so the day loops.
 */
export class DayBuilder {
  readonly steps: Step[] = []
  private cur: { spot: Spot; from: number; until: number; as: StayAs }
  constructor(
    private readonly who: string,
    private readonly gait: Gait,
    private readonly router: Router,
    private readonly bookings: Bookings,
    private readonly start: Spot,
    private readonly first: StayAs,
    firstUntil: number,
  ) {
    this.cur = { spot: start, from: 0, until: firstUntil, as: first }
  }

  /** Where they are now, and until when they mean to stay. */
  get here(): Spot {
    return this.cur.spot
  }
  get until(): number {
    return this.cur.until
  }

  /** Hours to walk from the current spot to `to` along the centre lines (Infinity when unreachable). */
  hoursTo(to: Spot): number {
    const arcs = this.router.arcs(this.cur.spot.node, to.node)
    if (!arcs) return Infinity
    return arcs.reduce((s, a) => s + a.len / (this.gait.pace * WALK_RULES[a.kind].speed), 0)
  }

  /**
   * Leaves at `depart` (default: when the current stay ends) for the first of `to` reachable and
   * free in time, and stays there until `until` (or for `dwell` hours after arriving). Returns false,
   * staying put, when none is; a spot equal to the current one only changes how they stay.
   */
  go(to: readonly Spot[], as: StayAs, when: { depart?: number; until?: number; dwell?: number }): boolean {
    const depart = this.departure(when.depart ?? this.cur.until)
    for (const spot of to) {
      const walk = spot.key === this.cur.spot.key ? null : this.walkTo(spot, depart)
      if (walk === undefined) continue
      const arrive = walk ? walk.to : depart
      const until = when.until ?? arrive + (when.dwell ?? 0.25)
      if (until - arrive < MIN_STAY || until > 24) continue
      if (!this.bookings.free(spot.key, arrive, until, this.who)) continue
      this.move(depart, walk, { spot, from: arrive, until, as })
      return true
    }
    return false
  }

  /** Walks back to the start at `depart` (default: now), staying there to 24:00. */
  close(depart?: number): Step[] {
    if (this.cur.spot.key !== this.start.key) {
      const latest = 24 - MIN_STAY - this.hoursTo(this.start) * 1.1
      const d = this.departure(Math.min(depart ?? this.cur.until, latest))
      const walk = this.walkTo(this.start, d) ?? null
      this.move(d, walk, { spot: this.start, from: walk ? walk.to : d, until: 24, as: this.first })
    }
    this.cur.until = 24
    this.move(24, null, this.cur)
    return this.steps
  }

  /** When they can leave: staying on past the planned end needs the place free that long. */
  private departure(wanted: number): number {
    let d = wanted
    if (d > this.cur.until && !this.bookings.free(this.cur.spot.key, this.cur.until, d, this.who))
      d = this.cur.until
    return Math.max(d, this.cur.from + MIN_STAY)
  }

  /** The walk from here to `spot` leaving at `depart`, or undefined when it cannot be reached. */
  private walkTo(spot: Spot, depart: number): Walk | undefined {
    const arcs = this.router.arcs(this.cur.spot.node, spot.node)
    return arcs ? this.walk(arcs, depart, this.cur.spot) : undefined
  }

  /** Ends the current stay at `depart`, takes `walk` (if any) and starts `next`. */
  private move(depart: number, walk: Walk | null, next: DayBuilder["cur"]): void {
    const c = this.cur
    const stay: Stay = {
      kind: "stay",
      from: c.from,
      to: depart,
      at: [c.spot.at[0], c.spot.y, c.spot.at[1]],
      facing: c.as.facing ?? c.spot.facing,
      clip: c.as.clip,
      place: c.spot.key,
      ...(c.as.indoors ? { indoors: true as const } : {}),
    }
    // Two stays in a row at one place with the same look are one.
    const prev = this.steps[this.steps.length - 1]
    if (
      prev?.kind === "stay" &&
      prev.place === stay.place &&
      prev.clip === stay.clip &&
      prev.facing === stay.facing &&
      !!prev.indoors === !!stay.indoors
    )
      prev.to = depart
    else this.steps.push(stay)
    this.bookings.book(c.spot.key, c.from, depart, this.who)
    if (walk) this.steps.push(walk)
    this.cur = next
  }

  /** A walk along `arcs` (every spot is its own route node, so they run from spot to spot). */
  private walk(arcs: readonly Arc[], depart: number, from: Spot): Walk {
    const { pts, seg } = laneLine(arcs, this.gait.lane)
    if (pts.length < 2)
      pts.splice(0, pts.length, [from.at[0], from.y, from.at[1]], [from.at[0], from.y, from.at[1]])
    const times = [depart]
    const clips: string[] = []
    const edges: number[] = []
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as Vec3
      const b = pts[i + 1] as Vec3
      const arc = seg[i]
      const rule = WALK_RULES[arc?.kind ?? "path"]
      const metres = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      times.push((times[i] as number) + metres / (this.gait.pace * rule.speed))
      clips.push(rule.clip === null || rule.clip === "Walking_A" ? this.gait.walk : rule.clip)
      edges.push(arc ? arc.edge : -1)
    }
    return { kind: "walk", from: depart, to: times[times.length - 1] as number, pts, times, clips, edges }
  }
}

/** The step at `hour` (wrapped into 0–24). */
export function stepAt(day: readonly Step[], hour: number): Step {
  const h = ((hour % 24) + 24) % 24
  let lo = 0
  let hi = day.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((day[mid] as Step).from <= h) lo = mid
    else hi = mid - 1
  }
  return day[lo] as Step
}

/** Where someone is, which way they face and what they play at `hour`. */
export function poseOf(day: readonly Step[], hour: number): Pose {
  const h = ((hour % 24) + 24) % 24
  const s = stepAt(day, h)
  if (s.kind === "stay")
    return { at: s.at, facing: s.facing, clip: s.clip, indoors: !!s.indoors, walking: false }
  let i = 0
  while (i + 2 < s.times.length && (s.times[i + 1] as number) <= h) i++
  const a = s.pts[i] as Vec3
  const b = s.pts[i + 1] as Vec3
  const t0 = s.times[i] as number
  const t1 = s.times[i + 1] as number
  const t = t1 > t0 ? Math.min(1, Math.max(0, (h - t0) / (t1 - t0))) : 0
  const at: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const d = sub([b[0], b[2]], [a[0], a[2]])
  return { at, facing: heading(d), clip: s.clips[i] as string, indoors: false, walking: true }
}

/** `p` moved `d` metres along heading `h`. */
export const ahead = (p: Vec2, h: number, d: number): Vec2 => add(p, [Math.sin(h) * d, Math.cos(h) * d])
