/**
 * The heroes' itineraries (life/itineraries.ts, plan-hud-events.md L1) on a real island, from random
 * guild streams: a pose is a pure sample (planned from the whole log or as the clock passes, the same at
 * every t), every walk keeps to the walk graph and ends at the spot it was booked within its walk time,
 * no two heroes hold one spot, the Guildmaster sits in the Guildhall's gathering while it dispatches,
 * and a leaver walks home and fades.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { hash } from "@guildhall/core"
import {
  guildhallZone,
  HEX_TILE_SIZE,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  type LifeStay,
  type LifeWalk,
  lifePlaces,
  type PlaceSpec,
  parseTilePrefabs,
  WALK_MPS,
  workTiles,
} from "@guildhall/world"
import {
  bindPlaces,
  flush,
  GONE_MS,
  itineraries,
  type LifeKit,
  LifePlanner,
  normalizer,
  placeAt,
  poseAt,
  RUN_CLIP,
  type WorldActor,
  walkEnd,
} from "../src/index.ts"
import { Feed, PACKAGES } from "./events-fixtures.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

const spec = (id: string, files: number, extra: Partial<PlaceSpec> = {}): PlaceSpec => ({
  id,
  label: id.split("/").pop() ?? id,
  kind: "settlement",
  tier: files >= 1000 ? 3 : files >= 60 ? 2 : 1,
  files,
  ...extra,
})
const REPO: PlaceSpec[] = [
  spec("packages/hall", 2400, { capital: true }),
  spec("/", 20, { kind: "harbour", label: "guildhall" }),
  spec("test", 300, { kind: "camp" }),
  spec("packages/core", 400),
  spec("packages/world", 900),
  spec("packages/sim", 120),
  spec("packages/render", 300),
]
const FILES = REPO.reduce((n, s) => n + s.files, 0)

const h = hexIsland({ seed: 2, files: FILES })
const z = hexZones(h, { places: REPO })
const w = hexWorld(h, z)
const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
const home = guildhallZone(walk, z)
const binding = bindPlaces(REPO, z)
const kit: LifeKit = {
  walk,
  spots: (zi) => places.heroSpots(zi),
  home,
  near: places.walkNear,
  island: h,
}
const MPS = WALK_MPS * 1.1

const T0 = 1_790_000_000_000

/** A seeded random in [0, 1). */
const rng = (seed: number) => {
  let k = 0
  return () => (hash(`life:${seed}:${k++}`) >>> 0) / 2 ** 32
}

/**
 * A random guild: a guildmaster sends 2–4 subagents; each works in bursts of edits in one package (now
 * and then a grep across all four), may ask a human, and finishes; the guildmaster then works on its
 * own and finishes. Then the clock runs on until every leaver has gone.
 */
function story(seed: number): Feed {
  const r = rng(seed)
  const feed = new Feed(64, normalizer({ placeOf: binding.placeOf }))
  const acts: { at: number; run: (at: number) => void }[] = []
  /** Something done at `t` ms into the story (on a 500 ms grid, so calls never overlap). */
  const at = (t: number, run: (at: number) => void) => acts.push({ at: T0 + Math.round(t / 500) * 500, run })
  const pick = () => PACKAGES[Math.floor(r() * PACKAGES.length)] as (typeof PACKAGES)[number]
  at(0, (when) => feed.start("root", when))
  const subs = 2 + Math.floor(r() * 3)
  let end = 0
  for (let s = 0; s < subs; s++) {
    const id = `sub${s}`
    let t = 2000 + s * 1500
    at(t, (when) => feed.start(id, when, "root", "explore"))
    const bursts = 1 + Math.floor(r() * 3)
    for (let b = 0; b < bursts; b++) {
      const pkg = pick()
      const edits = 10 + Math.floor(r() * 15)
      for (let e = 0; e < edits; e++) {
        t += 3000 + r() * 4000
        if (r() < 0.1)
          at(t, (when) => {
            for (const [k, p] of PACKAGES.entries()) feed.grep(id, p, when + k * 50)
          })
        else at(t, (when) => feed.edit(id, pkg, when))
      }
      if (r() < 0.3) {
        // it asks a human, and is answered
        t += 2000
        at(t, (when) => feed.change({ type: "status", id, status: "waiting", at: when }))
        t += 4000
        at(t, (when) => feed.change({ type: "status", id, status: "busy", at: when }))
      }
      t += 5000 + r() * 20_000
    }
    at(t, (when) => feed.change({ type: "status", id, status: "idle", at: when }))
    end = Math.max(end, t)
  }
  let t = end + 3000
  const pkg = pick()
  for (let e = 0; e < 25; e++) {
    t += 4000
    at(t, (when) => feed.edit("root", pkg, when))
  }
  t += 30_000
  at(t, (when) => feed.change({ type: "status", id: "root", status: "idle", at: when }))
  acts.sort((a, b) => a.at - b.at)
  for (const a of acts) a.run(a.at)
  feed.log.append(...flush(feed.ctx, T0 + t + GONE_MS + 1000))
  return feed
}

/** The stream's last event's time. */
const lastAt = (feed: Feed) => feed.log.events[feed.log.length - 1]!.at

const SEEDS = [1, 2, 3, 4]
const plans = SEEDS.map((seed) => {
  const feed = story(seed)
  return { seed, feed, its: itineraries(feed.log, kit) }
})

describe("a hero's pose is a pure sample", () => {
  test("planned from the whole log or as the clock passes, the same at 50 random times", () => {
    for (const { seed, feed, its } of plans) {
      const r = rng(seed + 100)
      const end = lastAt(feed) + 20_000
      const times = Array.from({ length: 50 }, () => T0 + r() * (end - T0)).sort((a, b) => a - b)
      const play = new LifePlanner(kit)
      let next = 0
      const events = feed.log.events
      let compared = 0
      for (const t of times) {
        while (next < events.length && events[next]!.at <= t) play.push(events[next++]!)
        play.advance(t)
        for (const id of its.keys()) {
          const seek = poseAt(its.get(id)!, t)
          expect([seed, id, t, play.poseAt(id, t)]).toEqual([seed, id, t, seek])
          if (seek) compared++
        }
      }
      expect(compared).toBeGreaterThan(50)
    }
  }, 120_000)

  test("the same log plans the same itineraries", () => {
    const again = itineraries(plans[0]!.feed.log, kit)
    expect(JSON.stringify([...again.values()])).toBe(JSON.stringify([...plans[0]!.its.values()]))
  })
})

/** Metres from a point to the nearest edge of the walk graph. */
function offGraph(x: number, zz: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const e of walk.edges) {
    const a = walk.nodes[e.a]!
    const b = walk.nodes[e.b]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz
    const f = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (zz - a.z) * dz) / l2)) : 0
    best = Math.min(best, Math.hypot(a.x + dx * f - x, a.z + dz * f - zz))
  }
  return best
}

const walksOf = (feed: (typeof plans)[number]) =>
  [...feed.its.values()].flatMap((it) =>
    it.steps.flatMap((s, k) => (s.kind === "walk" ? [{ walk: s, next: it.steps[k + 1] }] : [])),
  )

describe("a hero's walk", () => {
  test("keeps to the walk graph: every point on a way, or on the approach to the spots it joins", () => {
    let walks = 0
    for (const plan of plans)
      for (const { walk: s } of walksOf(plan)) {
        walks++
        const a = s.pts[0]!
        const b = s.pts[s.pts.length - 1]!
        for (const p of s.pts) {
          const approach = Math.min(
            Math.hypot(p[0] - a[0], p[2] - a[2]),
            Math.hypot(p[0] - b[0], p[2] - b[2]),
          )
          if (approach <= HEX_TILE_SIZE * 1.8 + 0.5) continue
          expect(offGraph(p[0], p[2])).toBeLessThan(2.5)
        }
      }
    expect(walks).toBeGreaterThan(20)
  }, 60_000)

  test("reaches its spot within its walk time, at the walking pace", () => {
    let arrived = 0
    for (const plan of plans)
      for (const { walk: s, next } of walksOf(plan)) {
        // a walk cut short (sent elsewhere on the way) goes on as the next walk; a whole one ends in a stay
        expect(next).toBeDefined()
        if (next?.kind !== "stay") continue
        const stay = next as LifeStay
        expect(stay.from).toBe(s.to)
        const end = s.pts[s.pts.length - 1]!
        let metres = 0
        for (let k = 1; k < s.pts.length; k++)
          metres += Math.hypot(s.pts[k]![0] - s.pts[k - 1]![0], s.pts[k]![2] - s.pts[k - 1]![2])
        expect(s.pts.length).toBe(s.times.length)
        // the whole way walked: it ends at the spot it was sent to, on time, at the pace
        expect(s.times[s.times.length - 1]).toBe(s.to)
        expect(end).toEqual(stay.at)
        expect(poseAt({ id: "x", steps: [s, stay], shown: [[s.from, Infinity]] }, s.to)?.at).toEqual(stay.at)
        expect((s.to - s.from) / 1000).toBeCloseTo(metres / MPS, 3)
        arrived++
      }
    expect(arrived).toBeGreaterThan(20)
  })

  test("a walk cut short is followed by the next from where it got to", () => {
    let cut = 0
    for (const plan of plans)
      for (const it of plan.its.values())
        for (let k = 1; k < it.steps.length; k++) {
          const prev = it.steps[k - 1]!
          const s = it.steps[k]!
          expect(s.from).toBeGreaterThanOrEqual(prev.from)
          expect(s.from).toBe(prev.to)
          if (s.kind === "walk" && prev.kind === "walk") {
            const end = walkEnd(prev as LifeWalk)
            expect(end).toEqual(s.pts[0]!)
            cut++
          }
        }
    expect(cut).toBeGreaterThan(0)
  })
})

describe("spots, the Guildmaster and the leavers", () => {
  const gather = places.heroSpots(home)

  test("no two heroes stand at one spot at once", () => {
    for (const { seed, feed, its } of plans) {
      const r = rng(seed + 200)
      for (let n = 0; n < 300; n++) {
        const t = T0 + r() * (lastAt(feed) - T0)
        const standing = [...its.values()]
          .map((it) => poseAt(it, t))
          .filter((p) => p !== null && p.act !== "walk")
        for (let i = 0; i < standing.length; i++)
          for (let j = i + 1; j < standing.length; j++) {
            const a = standing[i]!.at
            const b = standing[j]!.at
            expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(0.05)
          }
      }
    }
  })

  test("the Guildmaster sits in the gathering while its subagents work, and walks to its own work after", () => {
    let working = 0
    for (const { feed, its } of plans) {
      const root = its.get("root")!
      let dispatching = 0
      for (const s of root.steps) {
        if (s.kind !== "stay" || !Number.isFinite(s.to) || s.to - s.from < 1000) continue
        const mid = (s.from + s.to) / 2
        const world = feed.log.stateAt(mid)
        const subs = [...world.actors.values()].filter((a) => a.parent === "root" && a.gone === undefined)
        const busy = subs.some(
          (a) => a.status === "working" || a.status === "starting" || a.status === "waiting",
        )
        const atGather = gather.some((g) => Math.hypot(g.at[0] - s.at[0], g.at[2] - s.at[2]) < 1e-9)
        if (busy) {
          expect(atGather).toBe(true)
          dispatching++
        }
        const me = world.actors.get("root") as WorldActor
        const place = placeAt(me, mid)
        if (!busy && me.status === "working" && place !== undefined && place !== home) {
          const there = places.heroSpots(place)
          expect(there.some((g) => Math.hypot(g.at[0] - s.at[0], g.at[2] - s.at[2]) < 1e-9)).toBe(true)
          expect(s.act).toBe("work")
          working++
        }
      }
      expect(dispatching).toBeGreaterThan(0)
    }
    // (the walks on this island are long: in some stories the guildmaster finishes on its way there)
    expect(working).toBeGreaterThan(0)
  })

  test("a subagent works at its place's spots; a leaver walks home and fades", () => {
    let subs = 0
    let workers = 0
    for (const { feed, its } of plans) {
      for (const [id, it] of its) {
        if (id === "root") continue
        const left = feed.log.events.find((e) => e.kind === "actor.leave" && e.id === id)!
        expect(left).toBeDefined()
        // gone from its fade on; at the Guildhall's gathering just before
        const fade = it.shown[0]![1]
        expect(fade).toBeGreaterThanOrEqual(left.at)
        expect(poseAt(it, fade)).toBeNull()
        expect(poseAt(it, fade + 60_000)).toBeNull()
        const before = poseAt(it, fade - 1)!
        expect(gather.some((g) => Math.hypot(g.at[0] - before.at[0], g.at[2] - before.at[2]) < 0.01)).toBe(
          true,
        )
        // before it joins, nobody
        expect(poseAt(it, it.shown[0]![0] - 1)).toBeNull()
        // somewhere along the way it worked at a spot of a package's place
        const worked = it.steps.some(
          (s) =>
            s.kind === "stay" &&
            s.act === "work" &&
            z.zones.some((_, zi) => zi !== home && places.heroSpots(zi).some((g) => g.at === s.at)),
        )
        subs++
        if (worked) workers++
      }
    }
    // some get there and work; the rest finish (or are sent on) while on the way: this island is
    // ~150 m across, a two-minute walk, and these subagents work 30 s to 3 min at a place
    expect(subs).toBeGreaterThan(8)
    expect(workers).toBeGreaterThanOrEqual(4)
  })
})

describe("a long way is run", () => {
  const hurry = { within: 40, mps: 3 }
  test("within its time (or at the run's pace), the run's clip on; still the same played or sought", () => {
    let ran = 0
    for (const { seed, feed } of plans.slice(0, 2)) {
      const its = itineraries(feed.log, kit, { hurry })
      for (const it of its.values())
        for (const [k, s] of it.steps.entries()) {
          if (s.kind !== "walk" || it.steps[k + 1]?.kind !== "stay") continue
          let metres = 0
          for (let j = 1; j < s.pts.length; j++)
            metres += Math.hypot(s.pts[j]![0] - s.pts[j - 1]![0], s.pts[j]![2] - s.pts[j - 1]![2])
          const secs = (s.to - s.from) / 1000
          const pace = metres / secs
          expect(pace).toBeGreaterThan(MPS - 1e-6)
          expect(pace).toBeLessThan(hurry.mps + 1e-3)
          if (metres / MPS > hurry.within) {
            expect(secs).toBeLessThanOrEqual(Math.max(hurry.within, metres / hurry.mps) + 1e-3)
            expect(poseAt(it, (s.from + s.to) / 2)?.clip).toBe(RUN_CLIP)
            ran++
          } else expect(poseAt(it, (s.from + s.to) / 2)?.clip).toBeUndefined()
        }
      const play = new LifePlanner(kit, { hurry })
      const r = rng(seed + 300)
      const end = lastAt(feed)
      const times = Array.from({ length: 50 }, () => T0 + r() * (end - T0)).sort((a, b) => a - b)
      let next = 0
      for (const t of times) {
        while (next < feed.log.length && feed.log.events[next]!.at <= t) play.push(feed.log.events[next++]!)
        play.advance(t)
        for (const id of its.keys()) expect(play.poseAt(id, t)).toEqual(poseAt(its.get(id)!, t))
      }
    }
    expect(ran).toBeGreaterThan(3)
  }, 60_000)
})

describe("cost", () => {
  test("sampling 12 heroes costs well under 0.3 ms", () => {
    const all = plans.flatMap((p) => [...p.its.values()]).slice(0, 12)
    const end = lastAt(plans[0]!.feed)
    const n = 2000
    const t0 = performance.now()
    for (let k = 0; k < n; k++) {
      const t = T0 + ((end - T0) * k) / n
      for (const it of all) poseAt(it, t)
    }
    const ms = (performance.now() - t0) / n
    expect(all.length).toBe(12)
    expect(ms).toBeLessThan(0.05)
  })
})

describe("a crowded gathering", () => {
  test("more guildmasters than the Guildhall has spots: nobody stands within 0.9 m of another", () => {
    const spots = kit.spots(home).length
    const feed = new Feed(64, normalizer({ placeOf: binding.placeOf }))
    const n = spots + 10
    for (let k = 0; k < n; k++) feed.start(`root${k}`, T0 + k * 1000)
    const its = itineraries(feed.log, kit)
    const t = T0 + n * 1000 + 120_000
    const at = [...its.values()].flatMap((it) => {
      const p = poseAt(it, t)
      return p ? [p.at] : []
    })
    expect(at.length).toBe(n)
    let closest = Number.POSITIVE_INFINITY
    for (let i = 0; i < at.length; i++)
      for (let j = i + 1; j < at.length; j++)
        closest = Math.min(closest, Math.hypot(at[i]![0] - at[j]![0], at[i]![2] - at[j]![2]))
    expect(closest).toBeGreaterThanOrEqual(0.9)
  })
})
