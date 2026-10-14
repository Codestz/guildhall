/**
 * Life between people (decisions.md "Life ideas"): what the townsfolk's days do together, laid over
 * the days `planFolk` made, in the same pure, seeded plan (the build worker's), so a set clock and a
 * played one agree.
 *
 *   tavern     the evening's seats and the bar's end drink on one clock per tile (routines.ts `drink`,
 *              `drink-stand`): mugs up together for a toast, a song in every block; a canteen's lunch
 *              is a mug over the table (`dine`). A bard stands in a beer garden's evening and leads it.
 *   tipsy      a few of the latest home from the tavern walk it slower, weaving (`LifeWalk.tipsy`), and
 *              stop half-way: down against a wall for a moment (`slump`), or a reel where none is near.
 *              Only after nine at night, and home before midnight.
 *   meetings   two walkers whose ways cross stop and chat a few seconds, facing each other a metre or so
 *              apart, taking turns (`chat`); two who see each other coming down a road wave (`wave`).
 *   haggles    a customer at a market stall and the merchant behind it haggle on one clock, the coin
 *              changing hands at the end (`haggle-buy` / `haggle-sell`).
 *   lamps      a lamplighter goes round a place's lamp posts at dusk with a torch (`light`).
 *
 * Nobody animal: people only (user, 10-13).
 */
import { hash2 } from "../geom/noise.ts"
import { solidDistance } from "./collide.ts"
import { hexAt } from "./grid.ts"
import type { HexIsland } from "./island.ts"
import {
  doorOut,
  doorSpot,
  type Folk,
  type LifePlaces,
  type LifeSpot,
  type LifeStay,
  type LifeStep,
  type LifeWalk,
  LoopBuilder,
  lifePose,
  nodeNear,
  spotAt,
  type Vec3,
} from "./life.ts"
import { PROPS, routineSpan } from "./routines.ts"
import { HARD } from "./spots.ts"
import { HEX_TILE_SIZE, opensEvening } from "./tiles.ts"
import { cutsHard, floodWay, type HexWalk } from "./walk.ts"
import type { HexDoorway, HexWorld } from "./world.ts"
import type { HexZones } from "./zones.ts"

export interface SocialOpts {
  h: HexIsland
  z: HexZones
  w: Pick<HexWorld, "pieces"> & Partial<Pick<HexWorld, "doorways">>
  walk: HexWalk
  places: LifePlaces
  seed: number
  /** Metres an hour of the day (planFolk's `pace`). */
  pace: number
  /** Screen seconds to a day hour. */
  secPerHour: number
}

/** What the pass did, for the logs and the tests. */
export interface SocialStats {
  drinkers: number
  bards: number
  tipsy: number
  chats: number
  waves: number
  haggles: number
  lamplighters: number
  lamps: number
}

/** Prefabs whose evening has a bard (a beer garden), and where on the tile he stands (tile space). */
export const BARD_TILES: ReadonlySet<string> = new Set(["tavern-garden", "tavern-yard"])

/** A tipsy walk home leaves the tavern no earlier than this (day hours): nobody drunk by daylight. */
export const TIPSY_FROM = 21
/** Home by then at the latest. */
export const TIPSY_HOME = 23.9
/** Share of the late ones who walk home tipsy. */
const TIPSY_P = 0.3
/** How much longer a tipsy walk takes, at most. */
const TIPSY_SLOW = 1.5
/** Screen seconds a weave takes (one side and back). */
const WEAVE_S = 2.4
/** Screen seconds a tipsy walker stops half-way (the slump is 6.7 s). */
const LEAN_S = 7.2

/** Two walkers stop to chat this far apart, metres (bodies never touch: two radii are under 0.8). */
export const CHAT_MIN = 1.0
export const CHAT_MAX = 1.6
/** And wave across this far. */
const WAVE_MIN = 4
const WAVE_MAX = 8
/** Screen seconds a chat lasts (from, to) and a wave. */
const CHAT_S: readonly [number, number] = [4, 8]
const WAVE_S = 2.4
/** A chat's two sides take turns this many seconds apart (routines.ts `chat`: talk 2.6, listen 2.6). */
export const CHAT_TURN = 2.6
/** Shares of the crossings that become a chat, of the sightings a wave. */
const CHAT_P = 0.55
const WAVE_P = 0.3
/** Day hours meetings happen in. */
const MEET_FROM = 7
const MEET_TO = 20.5
/** Hours between one person's meetings at least, and how many a day at most. */
const MEET_GAP = 0.25
const MEET_MAX = 4
/** Nobody else stands this near a meeting (metres, their planned stays). */
const MEET_CLEAR = 0.75
/** … and this far from every wall and house (out of a doorway's threshold), metres. */
const MEET_ROOM = 0.2

/** Lamp posts a lamplighter goes round (pieces). */
const LAMP = /post-lantern/
/** Places with a lamplighter: the town's kinds, with at least this many lamps. */
const LAMP_KINDS = new Set(["town", "market", "harbour", "castle"])
const LAMP_MIN = 3
const LAMPLIGHTERS_MAX = 4
const LAMPS_MAX = 14
/** Out at dusk (day hours) and the seconds at a lamp (routines.ts `light`: 2.5 s). */
const LAMP_FROM = 17.4
/** … and lights none after this hour (day hours). */
const LAMP_BY = 20.9
const LAMP_S = 2.6
/** A lamplighter stands this far off the post, metres. */
const LAMP_ARM = 0.75

const rnd = (seed: number, a: number, b: number) => hash2(seed, a, b)
const key = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`
const headingTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, bz - az)

/** Lays life between people over the townsfolk's days (in place), and adds the bards and lamplighters. */
export function planSocial(folk: Folk[], o: SocialOpts): SocialStats {
  const stats: SocialStats = {
    drinkers: 0,
    bards: 0,
    tipsy: 0,
    chats: 0,
    waves: 0,
    haggles: 0,
    lamplighters: 0,
    lamps: 0,
  }
  const spots = o.places.furniture.spots
  const spotOf = new Map<string, number>()
  for (const [k, s] of spots.entries()) spotOf.set(key(s.x, s.z), k)
  tavern(folk, o, spotOf, stats)
  haggles(folk, o, spotOf, stats)
  tipsy(folk, o, stats)
  meetings(folk, o, stats)
  lamplighters(folk, o, stats)
  return stats
}

/** A tile's tavern clock: one offset for everyone drinking there (seconds on the day's). */
const clockOf = (seed: number, tile: number, span: number) => Math.floor(rnd(seed + 4401, tile, 3) * span)

/** The seats and the bar's end of the taverns, the canteens' lunches, and the beer gardens' bards. */
function tavern(folk: Folk[], o: SocialOpts, spotOf: Map<string, number>, stats: SocialStats): void {
  const spots = o.places.furniture.spots
  const span = routineSpan("drink")
  for (const f of folk)
    for (const s of f.day) {
      if (s.kind !== "stay" || s.indoors || s.routine || s.drill) continue
      const k = spotOf.get(key(s.at[0], s.at[2]))
      const spot = k === undefined ? undefined : spots[k]
      if (!spot || !opensEvening(spot.hours)) continue
      const seed = Math.floor(rnd(o.seed + 4403, f.id, Math.round(s.from * 100)) * 2 ** 30)
      if (s.from < 16) {
        // a canteen's lunch: a mug over the table, no toasts by day
        if (spot.kind === "sit") s.routine = { id: "dine", seed }
        continue
      }
      const day = clockOf(o.seed, spot.tile, span)
      s.routine = { id: spot.kind === "sit" ? "drink" : "drink-stand", seed, day }
      stats.drinkers++
    }
  // a bard in each beer garden's evening, at his own spot (roles: bard), leading the tables
  for (const [k, spot] of spots.entries()) {
    if (!spot.roles?.includes("bard") || o.places.taken.has(k)) continue
    const prefab = o.places.prefabOf(spot.tile) ?? ""
    if (!BARD_TILES.has(prefab)) continue
    const node = o.places.nodeOf(k)
    if (node < 0 || o.places.walled(k)) continue
    o.places.taken.add(k)
    const zi = o.z.zoneOf[spot.tile]! - 1
    if (zi < 0) continue
    const id = folk.length
    const r = (salt: number) => rnd(o.seed + 4405 + salt, id, spot.tile)
    const home = homeOf(o, zi, spot.tile, r(1))
    const at = o.places.lifeSpot(k)
    at.routine = { id: "bard", seed: Math.floor(r(2) * 2 ** 30), day: clockOf(o.seed, spot.tile, span) }
    const b = new LoopBuilder(
      o.walk,
      o.pace,
      0.3,
      home.spot,
      { act: "idle", indoors: home.indoors },
      o.places.walkNear,
    )
    b.go(17.1 + r(3) * 0.3, at, { act: "work" })
    b.go(23 + r(4) * 0.4, home.spot, { act: "idle", indoors: home.indoors })
    folk.push({ id, role: "bard", zone: zi, day: b.close(24) })
    stats.bards++
  }
}

/** A home for someone a pass adds: a door of the tile (or the place), else a corner of its heart. */
function homeOf(o: SocialOpts, zi: number, tile: number, pick: number): { spot: LifeSpot; indoors: boolean } {
  const doors = new Map((o.w.doorways ?? []).map((d) => [d.tile, d] as [number, HexDoorway]))
  const out = (n: number) => n >= 0 && doorOut(o.walk, n, doors, o.places.walkNear)
  const own = o.walk.door(tile)
  const zone = o.z.zones[zi]!
  const all = zone.tiles.map((i) => o.walk.door(i)).filter(out)
  const node = out(own) ? own : all.length ? all[Math.floor(pick * all.length)]! : -1
  if (node >= 0) return { spot: doorSpot(o.walk, node, doors), indoors: true }
  return { spot: spotAt(o.walk, o.walk.hearts[zi]!, Math.floor(pick * 6), 2.4), indoors: false }
}

/** Customers at a market stall and the merchant behind it: a haggle on one clock. */
function haggles(folk: Folk[], o: SocialOpts, spotOf: Map<string, number>, stats: SocialStats): void {
  const spots = o.places.furniture.spots
  // the merchants' work stays by where they stand
  const sellers = new Map<string, Folk>()
  for (const f of folk)
    for (const s of f.day)
      if (s.kind === "stay" && s.act === "work" && s.routine?.id === "serve")
        sellers.set(key(s.at[0], s.at[2]), f)
  const span = routineSpan("haggle-buy")
  for (const f of folk)
    for (const s of f.day) {
      if (s.kind !== "stay" || s.act !== "idle" || s.indoors || s.routine) continue
      const k = spotOf.get(key(s.at[0], s.at[2]))
      const spot = k === undefined ? undefined : spots[k]
      if (spot?.kind !== "stand" || !/market/.test(o.places.prefabOf(spot.tile) ?? "")) continue
      // the merchant's spot across the counter: the nearest on the tile
      let best = -1
      let bd = 2.8
      for (const j of o.places.furniture.on(spot.tile)) {
        const m = spots[j]!
        if (m.kind !== "work" || !m.roles?.includes("merchant")) continue
        const d = Math.hypot(m.x - spot.x, m.z - spot.z)
        if (d < bd) {
          bd = d
          best = j
        }
      }
      const seller = best >= 0 ? sellers.get(key(spots[best]!.x, spots[best]!.z)) : undefined
      if (!seller) continue
      const k2 = seller.day.findIndex(
        (m) =>
          m.kind === "stay" &&
          m.act === "work" &&
          m.routine?.id === "serve" &&
          m.at[0] === spots[best]!.x &&
          m.at[2] === spots[best]!.z &&
          m.from < s.to - 0.02 &&
          m.to > s.from + 0.02,
      )
      if (k2 < 0) continue
      const m = seller.day[k2] as LifeStay
      const a = Math.max(m.from, s.from)
      const b = Math.min(m.to, s.to)
      const day = Math.floor(rnd(o.seed + 4411, spot.tile, k!) * span)
      const seed = Math.floor(rnd(o.seed + 4413, f.id, k!) * 2 ** 30)
      s.routine = { id: "haggle-buy", seed, day }
      // the seller's stay split round it: serving before, haggling through, serving after
      const parts: LifeStay[] = []
      if (a > m.from + 1e-6) parts.push({ ...m, to: a })
      parts.push({ ...m, from: a, to: b, routine: { id: "haggle-sell", seed: seed ^ 0x5bd1, day } })
      if (b < m.to - 1e-6) parts.push({ ...m, from: b })
      seller.day.splice(k2, 1, ...parts)
      stats.haggles++
    }
}

/** Where a walk is at `t` (its loop's unit), and the way it faces. */
function walkAt(
  s: LifeWalk,
  t: number,
): { x: number; z: number; k: number; f: number; hx: number; hz: number } {
  let k = 0
  while (k + 2 < s.times.length && s.times[k + 1]! <= t) k++
  const a = s.pts[k]!
  const b = s.pts[k + 1]!
  const t0 = s.times[k]!
  const t1 = s.times[k + 1]!
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  const l = Math.hypot(dx, dz) || 1
  return { x: a[0] + dx * f, z: a[2] + dz * f, k, f, hx: dx / l, hz: dz / l }
}

/**
 * A walk cut at `t` with a stay of `len` there (as `stay` says) and the rest of the way `len` later:
 * the steps in its place. `slow` stretches both halves' times from the walk's start (a tipsy walk).
 */
function cutWalk(
  s: LifeWalk,
  t: number,
  len: number,
  stay: Omit<LifeStay, "kind" | "from" | "to" | "at" | "ground">,
): LifeStep[] {
  const p = walkAt(s, t)
  const y = s.pts[p.k]![1] + (s.pts[p.k + 1]![1] - s.pts[p.k]![1]) * p.f
  const at: Vec3 = [p.x, y, p.z]
  const first: LifeWalk = {
    ...s,
    to: t,
    pts: [...s.pts.slice(0, p.k + 1), at],
    times: [...s.times.slice(0, p.k + 1), t],
    ground: s.ground.slice(0, p.k + 1),
  }
  const rest: LifeWalk = {
    ...s,
    from: t + len,
    to: s.to + len,
    pts: [at, ...s.pts.slice(p.k + 1)],
    times: [t + len, ...s.times.slice(p.k + 1).map((x) => x + len)],
    ground: s.ground.slice(p.k),
  }
  const here: LifeStay = { kind: "stay", from: t, to: t + len, at, ground: s.ground[p.k] ?? true, ...stay }
  return [first, here, rest]
}

/** A tipsy walk home: slower, weaving, a stop against a wall (or a reel) half-way. */
function tipsy(folk: Folk[], o: SocialOpts, stats: SocialStats): void {
  const lean = LEAN_S / o.secPerHour
  const weave = WEAVE_S / o.secPerHour
  const solids = o.places.furniture
  for (const f of folk) {
    const i = f.day.findIndex(
      (s, k) =>
        s.kind === "stay" &&
        (s.routine?.id === "drink" || s.routine?.id === "drink-stand") &&
        s.to >= TIPSY_FROM &&
        f.day[k + 1]?.kind === "walk" &&
        f.day[k + 2]?.kind === "stay" &&
        !!(f.day[k + 2] as LifeStay).indoors,
    )
    if (i < 0 || rnd(o.seed + 4421, f.id, 1) >= TIPSY_P) continue
    const w = f.day[i + 1] as LifeWalk
    const home = f.day[i + 2] as LifeStay
    if (w.from < TIPSY_FROM) continue
    const dur = w.to - w.from
    const slow = Math.min(TIPSY_SLOW, (TIPSY_HOME - w.from - lean) / Math.max(1e-6, dur))
    if (slow < 1.15 || dur * 3600 < 1) continue
    // slower: the same way, its times stretched from the start
    const slowed: LifeWalk = {
      ...w,
      times: w.times.map((x) => w.from + (x - w.from) * slow),
      to: w.from + dur * slow,
      tipsy: weave,
    }
    // (not a way so tight to a wall or a fence that the weave would take them into it)
    if (weavesIntoWall(slowed, solids)) continue
    // half-way, a wall to slump against (a body's width off it), else a reel where they are
    // (never on a hero's spot: LifePlaces `heroNear`)
    const free = (t: number) => {
      const p = walkAt(slowed, t)
      return !o.places.heroNear(p.x, p.z, 0) && !solids.blocked(p.x, p.z, MEET_ROOM, HARD)
    }
    const stop = leanPoint(slowed, solids, free)
    let t = stop?.t ?? slowed.from + (slowed.to - slowed.from) * 0.5
    for (let k = 1; !stop && !free(t) && k <= 20; k++)
      t = slowed.from + (slowed.to - slowed.from) * (0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.02)
    if (!stop && !free(t)) continue
    const seed = Math.floor(rnd(o.seed + 4423, f.id, 2) * 2 ** 30)
    const way = walkAt(slowed, t)
    const cut = cutWalk(slowed, t, lean, {
      facing: stop ? stop.facing : Math.atan2(way.hx, way.hz),
      act: "idle",
      routine: { id: stop ? "slump" : "reel", seed },
    })
    f.day.splice(i + 1, 1, ...cut)
    const rest = cut[2] as LifeWalk
    home.from = rest.to
    stats.tipsy++
  }
}

/**
 * Whether a tipsy walk's weave (lifePose) would take the walker into a wall, a house or a fence on the
 * way: sampled every few centimetres of it, the house its ends stand in (a door's threshold) aside.
 */
function weavesIntoWall(w: LifeWalk, furniture: LifePlaces["furniture"]): boolean {
  const a = w.pts[0]!
  const b = w.pts[w.pts.length - 1]!
  const steps: LifeStep[] = [w]
  let metres = 0
  for (let k = 1; k < w.pts.length; k++)
    metres += Math.hypot(w.pts[k]![0] - w.pts[k - 1]![0], w.pts[k]![2] - w.pts[k - 1]![2])
  const n = Math.max(2, Math.ceil(metres / 0.15))
  for (let k = 1; k < n; k++) {
    const t = w.from + ((w.to - w.from) * k) / n
    const p = lifePose(steps, t, 24).at
    for (const s of furniture.solidsNear(p[0], p[2], 0.05)) {
      if (!HARD(s.kind) || solidDistance(s, p[0], p[2]) >= -WEAVE_ROOM) continue
      if (solidDistance(s, a[0], a[2]) < 1 || solidDistance(s, b[0], b[2]) < 1) continue
      return true
    }
  }
  return false
}
/** How far a weave may brush into a wall's foot (a shoulder, not the feet), metres. */
const WEAVE_ROOM = 0.1

/** Where on the middle of a walk a wall is a body's width off (the time there, and the way out from it). */
function leanPoint(
  w: LifeWalk,
  furniture: LifePlaces["furniture"],
  free: (t: number) => boolean,
): { t: number; facing: number } | null {
  const span = w.to - w.from
  let best: { t: number; facing: number; d: number } | null = null
  const out: [number, number] = [0, 0]
  for (let k = 0; k <= 30; k++) {
    const t = w.from + span * (0.35 + (0.3 * k) / 30)
    const p = walkAt(w, t)
    if (!free(t)) continue
    for (const s of furniture.solidsNear(p.x, p.z, 1.2)) {
      if (!HARD(s.kind)) continue
      const d = solidDistance(s, p.x, p.z, out)
      if (d < 0.38 || d > 0.85) continue
      if (!best || Math.abs(d - 0.5) < Math.abs(best.d - 0.5))
        best = { t, facing: Math.atan2(out[0], out[1]), d }
    }
  }
  return best && { t: best.t, facing: best.facing }
}

interface Seen {
  f: number
  j: number
  x: number
  z: number
  hx: number
  hz: number
}

/** Two walkers whose ways cross stop and chat; two who see each other coming wave. */
function meetings(folk: Folk[], o: SocialOpts, stats: SocialStats): void {
  const DT = 0.004
  const buckets = new Map<number, Seen[]>()
  for (const [fi, f] of folk.entries())
    for (const [j, s] of f.day.entries()) {
      if (s.kind !== "walk" || s.carry || s.tipsy || s.to - s.from < 0.02) continue
      if (s.to < MEET_FROM || s.from > MEET_TO) continue
      // (not right out of a door or at the end of the way)
      const t0 = Math.max(s.from + 0.008, MEET_FROM)
      const t1 = Math.min(s.to - 0.012, MEET_TO)
      for (let n = Math.ceil(t0 / DT); n * DT <= t1; n++) {
        const p = walkAt(s, n * DT)
        const list = buckets.get(n) ?? []
        if (!list.length) buckets.set(n, list)
        list.push({ f: fi, j, x: p.x, z: p.z, hx: p.hx, hz: p.hz })
      }
    }
  interface Meet {
    t: number
    kind: "chat" | "wave"
    a: Seen
    b: Seen
    len?: number
  }
  const found = new Map<string, Meet>()
  for (const [n, list] of buckets) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++)
      for (let k = i + 1; k < list.length; k++) {
        const a = list[i]!
        const b = list[k]!
        if (a.f === b.f) continue
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = Math.hypot(dx, dz)
        if (d > WAVE_MAX) continue
        const pair = a.f < b.f ? `${a.f}:${a.j}:${b.f}:${b.j}` : `${b.f}:${b.j}:${a.f}:${a.j}`
        if (found.has(pair)) continue
        // closing on each other
        const closing = dx * (b.hx - a.hx) + dz * (b.hz - a.hz) < 0
        if (d >= CHAT_MIN && d <= CHAT_MAX && closing) found.set(pair, { t: n * DT, kind: "chat", a, b })
        else if (d >= WAVE_MIN && (a.hx * dx + a.hz * dz) / d > 0.6 && (b.hx * -dx + b.hz * -dz) / d > 0.6)
          found.set(pair, { t: n * DT, kind: "wave", a, b })
      }
  }
  const meets = [...found.values()].sort((p, q) => p.t - q.t || p.a.f - q.a.f || p.b.f - q.b.f)
  const last = new Map<number, number>()
  const count = new Map<number, number>()
  const walks = new Set<string>()
  const accepted: Meet[] = []
  for (const m of meets) {
    const r = rnd(o.seed + 4431, m.a.f * 977 + m.b.f, Math.round(m.t * 1000))
    if (r >= (m.kind === "chat" ? CHAT_P : WAVE_P)) continue
    const ok = (s: Seen) =>
      !walks.has(`${s.f}:${s.j}`) &&
      m.t - (last.get(s.f) ?? -9) >= MEET_GAP &&
      (count.get(s.f) ?? 0) < MEET_MAX
    if (!ok(m.a) || !ok(m.b)) continue
    const len = (m.kind === "chat" ? CHAT_S[0] + (CHAT_S[1] - CHAT_S[0]) * r : WAVE_S) / o.secPerHour
    // the stay after each walk must outlast the delay
    const room = (s: Seen) => {
      const next = folk[s.f]!.day[s.j + 1]
      // (not a woodcutter's stay: its length is his rounds of blows between trips to the pile)
      return next?.kind === "stay" && next.routine?.id !== "chop" && next.to - next.from > len + 0.01
    }
    if (!room(m.a) || !room(m.b)) continue
    // nobody else standing where they stop, while they stand there
    const crowded = folk.some((f, fi) => {
      if (fi === m.a.f || fi === m.b.f) return false
      return [m.t, m.t + len / 2, m.t + len].some((t) => {
        const p = lifePose(f.day, t, 24)
        if (p.indoors) return false
        return [m.a, m.b].some((s) => Math.hypot(p.at[0] - s.x, p.at[2] - s.z) < MEET_CLEAR)
      })
    })
    if (crowded || o.places.heroNear(m.a.x, m.a.z, 0) || o.places.heroNear(m.b.x, m.b.z, 0)) continue
    // (nor in a doorway's threshold or against a wall: a body's room round where each stops)
    if ([m.a, m.b].some((s) => o.places.furniture.blocked(s.x, s.z, MEET_ROOM, HARD))) continue
    for (const s of [m.a, m.b]) {
      walks.add(`${s.f}:${s.j}`)
      last.set(s.f, m.t + len)
      count.set(s.f, (count.get(s.f) ?? 0) + 1)
    }
    accepted.push({ ...m, len })
  }
  // cut the walks, the latest of each person's first (their earlier steps keep their indices)
  const cuts = accepted.flatMap((m) => {
    const len = m.len ?? 0
    const seed = Math.floor(rnd(o.seed + 4433, m.a.f, m.b.f) * 2 ** 30)
    return [
      { s: m.a, other: m.b, side: 0, m, len, seed },
      { s: m.b, other: m.a, side: 1, m, len, seed: seed ^ 0x2c1b },
    ]
  })
  cuts.sort((p, q) => p.s.f - q.s.f || q.s.j - p.s.j)
  for (const c of cuts) {
    const day = folk[c.s.f]!.day
    const w = day[c.s.j] as LifeWalk
    const facing = headingTo(c.s.x, c.s.z, c.other.x, c.other.z)
    const turn = c.m.kind === "chat" ? c.side * CHAT_TURN : 0
    const steps = cutWalk(w, c.m.t, c.len, {
      facing,
      act: "idle",
      routine: { id: c.m.kind, seed: c.seed, day: -c.m.t * o.secPerHour + turn },
    })
    const next = day[c.s.j + 1] as LifeStay
    next.from = (steps[2] as LifeWalk).to
    day.splice(c.s.j, 1, ...steps)
  }
  for (const m of accepted) stats[m.kind === "chat" ? "chats" : "waves"]++
}

/** A lamplighter for the town's places with lamp posts: round them at dusk with a torch. */
function lamplighters(folk: Folk[], o: SocialOpts, stats: SocialStats): void {
  const g = o.h.grid
  const byZone = new Map<number, { x: number; z: number; tile: number }[]>()
  for (const p of o.w.pieces) {
    if (!LAMP.test(p.piece)) continue
    const { q, r } = hexAt(p.x / HEX_TILE_SIZE, p.z / HEX_TILE_SIZE)
    const tile = g.index(q, r)
    const zi = tile >= 0 ? o.z.zoneOf[tile]! - 1 : -1
    if (zi < 0 || !LAMP_KINDS.has(o.z.zones[zi]!.kind)) continue
    const list = byZone.get(zi) ?? []
    if (!list.length) byZone.set(zi, list)
    list.push({ x: p.x, z: p.z, tile })
  }
  const zones = [...byZone.entries()]
    .filter(([, l]) => l.length >= LAMP_MIN)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .slice(0, LAMPLIGHTERS_MAX)
  for (const [zi, lamps] of zones) {
    const heart = o.walk.nodes[o.walk.hearts[zi]!]
    if (!heart) continue
    const id = folk.length
    const r = (salt: number) => rnd(o.seed + 4441 + salt, id, zi)
    const home = homeOf(o, zi, o.z.zones[zi]!.tiles[Math.floor(r(1) * o.z.zones[zi]!.tiles.length)]!, r(2))
    // each lamp's spot: an arm's length off the post, toward the way, facing it
    const stands: LifeSpot[] = []
    for (const l of lamps) {
      // (from the street the post stands on, not from across the houses)
      const node = nodeNear(o.walk, o.h, l.x, l.z, o.places.walkNear, o.walk.hearts[zi]!)
      const n = o.walk.nodes[node]!
      const base = Math.atan2(n.x - l.x, n.z - l.z)
      // the first side the street reaches straight; else the first free one, by its way in round the
      // fences (a post in a tavern's garden, reached by the garden's gap); none: the lamp is left
      let round: LifeSpot | null = null
      let straight: LifeSpot | null = null
      for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
        const a = base + da
        const x = l.x + Math.sin(a) * LAMP_ARM
        const zz = l.z + Math.cos(a) * LAMP_ARM
        if (o.places.furniture.blocked(x, zz, 0.26) || o.places.heroNear(x, zz, 0)) continue
        const at: Vec3 = [x, n.y, zz]
        const stand: LifeSpot = { node, at, facing: headingTo(x, zz, l.x, l.z), ground: true }
        if (!cutsHard([n.x, n.y, n.z], at, o.places.walkNear)) {
          straight = stand
          break
        }
        if (round) continue
        const found = floodWay(
          x,
          zz,
          o.places.walkNear,
          [n],
          Math.min(20, 4 + 2 * Math.hypot(n.x - x, n.z - zz)),
        )
        if (found) round = found.way.length ? { ...stand, way: found.way } : stand
      }
      const stand = straight ?? round
      if (stand) stands.push(stand)
    }
    if (stands.length < LAMP_MIN) continue
    // nearest first from home, then the nearest next
    const route: LifeSpot[] = []
    let cx = home.spot.at[0]
    let cz = home.spot.at[2]
    const left = [...stands]
    while (left.length && route.length < LAMPS_MAX) {
      let k = 0
      for (let j = 1; j < left.length; j++)
        if (
          Math.hypot(left[j]!.at[0] - cx, left[j]!.at[2] - cz) <
          Math.hypot(left[k]!.at[0] - cx, left[k]!.at[2] - cz)
        )
          k = j
      const s = left.splice(k, 1)[0]!
      route.push(s)
      cx = s.at[0]
      cz = s.at[2]
    }
    const b = new LoopBuilder(
      o.walk,
      o.pace,
      0.35,
      home.spot,
      { act: "idle", indoors: home.indoors },
      o.places.walkNear,
    )
    let t = LAMP_FROM + r(3) * 0.3
    let lit = 0
    for (const [k, s] of route.entries()) {
      const at: LifeSpot = { ...s, routine: { id: "light", seed: Math.floor(r(10 + k) * 2 ** 30) } }
      // (a lamp the way round the houses reaches only after dark is left for the night)
      const before = b.mark()
      const arrive = b.go(t, at, { act: "work" })
      // (… and one no clean way reaches, round the fences, is left out)
      if (b.cuts > before.cuts) {
        b.back(before)
        continue
      }
      if (arrive > LAMP_BY) {
        b.back(before)
        break
      }
      t = arrive + LAMP_S / o.secPerHour
      lit++
      if (t > 20.5) break
    }
    if (lit < LAMP_MIN) continue
    b.go(t, home.spot, { act: "idle", indoors: home.indoors })
    folk.push({ id, role: "lamplighter", zone: zi, day: b.close(24), prop: PROPS.torch })
    stats.lamplighters++
    stats.lamps += lit
  }
}

/** Where a lamp the lamplighters light stands (its post), and the day hour its torch reaches it. */
export interface LampLighting {
  x: number
  z: number
  at: number
}

/** The lamps lit by hand over the day: each lamplighter's `light` stays, the post an arm's length ahead. */
export function lampLightings(folk: readonly Folk[], secPerHour: number): LampLighting[] {
  const out: LampLighting[] = []
  for (const f of folk)
    for (const s of f.day) {
      if (s.kind !== "stay" || s.routine?.id !== "light") continue
      out.push({
        x: s.at[0] + Math.sin(s.facing) * LAMP_ARM,
        z: s.at[2] + Math.cos(s.facing) * LAMP_ARM,
        // the torch reaches the glass part-way through the Interact (routines.ts `light`: its beat at 0.55)
        at: s.from + (1.3 * 0.55) / secPerHour,
      })
    }
  return out
}

/** Where people stand round the notice board when a quest is pinned: a body apart, facing it. */
export interface BoardReader {
  at: Vec3
  facing: number
}

/** Readers stand this far out from the board's foot (metres), in an arc before its face. */
const READ_R: readonly number[] = [2, 2.5, 3.1]
/** And keep this far from where the Guildmaster pins and the recruits are briefed. */
const READ_CLEAR = 0.95

/**
 * The places round the Guildhall's notice board (world heroes.ts `HeroBoard`) a small crowd gathers at
 * when a quest is pinned: in an arc before its face, clear of every solid by a body, of the pinning spot
 * and the briefing spots, and of each other; up to `n`, nearest the board's axis first.
 */
export function boardReaders(
  board: { at: Vec3; facing: number; spot: { at: Vec3 }; brief: readonly { at: Vec3 }[] },
  furniture: Pick<LifePlaces["furniture"], "blocked">,
  n = 5,
): BoardReader[] {
  const out: BoardReader[] = []
  const keep = [board.spot.at, ...board.brief.map((b) => b.at)]
  for (const r of READ_R)
    for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2]) {
      if (out.length >= n) return out
      const a = board.facing + da
      const x = board.at[0] + Math.sin(a) * r
      const zz = board.at[2] + Math.cos(a) * r
      if (furniture.blocked(x, zz, 0.28)) continue
      if (keep.some((k) => Math.hypot(k[0] - x, k[2] - zz) < READ_CLEAR)) continue
      if (out.some((o) => Math.hypot(o.at[0] - x, o.at[2] - zz) < 0.85)) continue
      out.push({ at: [x, board.at[1], zz], facing: headingTo(x, zz, board.at[0], board.at[2]) })
    }
  return out
}
