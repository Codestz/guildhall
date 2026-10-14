/**
 * Life between people (social.ts) over the townsfolk's days, with the authored data/tiles as the Studio
 * builds: the tavern drinks and toasts on one clock, a few walk home tipsy (never by daylight), walkers
 * stop to chat a body apart or wave, a buyer and a seller haggle together, bards and lamplighters work,
 * and everything stays a pure function of the seed and the clock.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  BARD_TILES,
  boardReaders,
  CHAT_MIN,
  type Folk,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  type LifeStay,
  type LifeStep,
  lifePlaces,
  lifePose,
  planFolk,
  routineClock,
  routineSample,
  TIPSY_FROM,
  TIPSY_HOME,
  type TilePrefab,
  workTiles,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as TilePrefab),
)
afterAll(() => installTilePrefabs(null))

const SPH = 180
const islands = new Map<number, ReturnType<typeof build>>()
function build(seed: number) {
  const h = hexIsland({ seed, files: 4000 })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
  const folk = planFolk(h, z, w, walk, { seed, pace: 144, places, secPerHour: SPH })
  return { h, z, w, walk, places, folk }
}
const island = (seed: number) => {
  const got = islands.get(seed) ?? build(seed)
  islands.set(seed, got)
  return got
}
const stays = (f: Folk, id?: string) =>
  f.day.filter((s): s is LifeStay => s.kind === "stay" && (id === undefined || s.routine?.id === id))

describe("life between people", () => {
  for (const seed of [1, 2, 3])
    test(`seed ${seed}: every day is still one loop, in order, every walk's times rising`, () => {
      for (const f of island(seed).folk) {
        let t = f.day[0]!.from
        for (const s of f.day as LifeStep[]) {
          expect(s.from).toBeCloseTo(t, 9)
          expect(s.to).toBeGreaterThanOrEqual(s.from - 1e-9)
          if (s.kind === "walk") {
            expect(s.pts.length).toBe(s.times.length)
            expect(s.ground.length).toBe(s.pts.length - 1)
            for (let k = 1; k < s.times.length; k++)
              expect(s.times[k]!).toBeGreaterThanOrEqual(s.times[k - 1]! - 1e-9)
            expect(s.times[0]).toBeCloseTo(s.from, 9)
            expect(s.times.at(-1)!).toBeCloseTo(s.to, 9)
          }
          t = s.to
        }
        // (a day may run past midnight already before this pass: seed 3's farmer 107 walks a chop trip's way twice)
        expect(t).toBeGreaterThanOrEqual(24 - 1e-6)
      }
    }, 30000)

  test("the same seed plans the same life (the worker's plan is a pure function of it)", () => {
    const a = island(1).folk
    const b = build(1).folk
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  }, 30000)

  test("scrub = play: a routine on the day's clock samples the same set at an hour or played up to it", () => {
    const { folk } = island(1)
    const social = folk.flatMap((f) =>
      stays(f).filter((s) =>
        ["drink", "drink-stand", "bard", "chat", "wave", "haggle-buy", "haggle-sell"].includes(
          s.routine?.id ?? "",
        ),
      ),
    )
    expect(social.length).toBeGreaterThan(20)
    for (const s of social.slice(0, 60)) {
      const at = s.routine!
      const hour = s.from + (s.to - s.from) * 0.6
      const into = (hour - s.from) * SPH
      const set = routineSample({ ...at }, routineClock(at, into, hour, SPH))
      // played: from the stay's start in 1/30 s steps on a fresh copy (its own block cache)
      const played = { ...at }
      let last = routineSample(played, routineClock(played, 0, s.from, SPH))
      for (let t = 0; t <= into; t += 1 / 30)
        last = routineSample(played, routineClock(played, t, s.from + t / SPH, SPH))
      last = routineSample(played, routineClock(played, into, hour, SPH))
      expect([last.clip, last.phase, last.say ?? ""]).toEqual([set.clip, set.phase, set.say ?? ""])
    }
  })

  for (const seed of [1, 2, 3])
    test(`seed ${seed}: the tavern's evening drinks on one clock a tile, toasts together, and has its bard`, () => {
      const { folk, places } = island(seed)
      const drink = folk.flatMap((f) => [...stays(f, "drink"), ...stays(f, "drink-stand")])
      expect(drink.length).toBeGreaterThan(15)
      // nobody drinks the evening's way before five
      for (const s of drink) expect(s.from).toBeGreaterThanOrEqual(16)
      const byTile = new Map<number, Set<number>>()
      const tileOf = (s: LifeStay) =>
        places.furniture.spots.find((p) => Math.abs(p.x - s.at[0]) < 1e-6 && Math.abs(p.z - s.at[2]) < 1e-6)!
          .tile
      for (const s of drink) {
        const t = tileOf(s)
        byTile.set(t, (byTile.get(t) ?? new Set()).add(s.routine!.day!))
      }
      for (const days of byTile.values()) expect(days.size).toBe(1)
      // at a toast everyone at a table is up with a mug at once
      const tile = [...byTile.keys()][0]!
      const at = drink.filter((s) => tileOf(s) === tile && s.from < 20 && s.to > 20.5)
      if (at.length >= 2) {
        let hour = 20
        for (; hour < 20.5; hour += 0.5 / SPH)
          if (routineSample(at[0]!.routine!, routineClock(at[0]!.routine!, 0, hour, SPH)).clip === "Cheering")
            break
        for (const s of at)
          expect(routineSample(s.routine!, routineClock(s.routine!, 0, hour, SPH)).clip).toBe("Cheering")
      }
      const bards = folk.filter((f) => f.role === "bard")
      const gardens = new Set(
        places.furniture.spots
          .filter((p) => BARD_TILES.has(places.prefabOf(p.tile) ?? ""))
          .map((p) => p.tile),
      )
      expect(bards.length).toBe(gardens.size)
      for (const b of bards) {
        const work = stays(b, "bard")
        expect(work.length).toBe(1)
        expect(work[0]!.from).toBeGreaterThan(17)
        expect(work[0]!.to).toBeLessThan(23.5)
      }
    }, 30000)

  for (const seed of [1, 2, 3])
    test(`seed ${seed}: nobody is drunk by daylight: tipsy walks and their stops are late and home before midnight`, () => {
      const { folk } = island(seed)
      let tipsy = 0
      for (const f of folk)
        for (const s of f.day) {
          if (s.kind === "walk" && s.tipsy) {
            tipsy++
            expect(s.from).toBeGreaterThanOrEqual(TIPSY_FROM)
            expect(s.to).toBeLessThanOrEqual(TIPSY_HOME + 1e-6)
          }
          if (s.kind === "stay" && (s.routine?.id === "reel" || s.routine?.id === "slump")) {
            expect(s.from).toBeGreaterThanOrEqual(TIPSY_FROM)
            expect(s.to).toBeLessThanOrEqual(TIPSY_HOME)
          }
        }
      expect(tipsy).toBeGreaterThan(4)
      // and at work hours a sample of the whole town shows nobody tipsy
      for (let hour = 6; hour < TIPSY_FROM; hour += 0.05)
        for (const f of folk) expect(lifePose(f.day, hour, 24).tipsy ?? false).toBe(false)
    }, 30000)

  for (const seed of [1, 2, 3])
    test(`seed ${seed}: chats and waves come in pairs, face each other, and never overlap anyone's body`, () => {
      const { folk } = island(seed)
      const meet = folk.flatMap((f) =>
        stays(f)
          .filter((s) => s.routine?.id === "chat" || s.routine?.id === "wave")
          .map((s) => ({ f, s })),
      )
      const chats = meet.filter((m) => m.s.routine!.id === "chat")
      expect(chats.length).toBeGreaterThan(5)
      expect(meet.length - chats.length).toBeGreaterThan(5)
      for (const m of meet) {
        // the other side: the same moment, its seed the pair's other (social.ts)
        const mates = (a: LifeStay, b: LifeStay) => (a.routine!.seed ^ 0x2c1b) === b.routine!.seed
        const other = meet.filter(
          (o) =>
            o.f !== m.f &&
            o.s.routine!.id === m.s.routine!.id &&
            Math.abs(o.s.from - m.s.from) < 1e-9 &&
            (mates(o.s, m.s) || mates(m.s, o.s)),
        )
        expect(other.length).toBe(1)
        const o = other[0]!
        const d = Math.hypot(o.s.at[0] - m.s.at[0], o.s.at[2] - m.s.at[2])
        if (m.s.routine!.id === "chat") expect(d).toBeGreaterThanOrEqual(CHAT_MIN - 1e-6)
        // facing the other
        const want = Math.atan2(o.s.at[0] - m.s.at[0], o.s.at[2] - m.s.at[2])
        expect(Math.abs(Math.sin((want - m.s.facing) / 2))).toBeLessThan(1e-6)
        // only in the day, a few seconds
        expect(m.s.from).toBeGreaterThanOrEqual(7)
        expect((m.s.to - m.s.from) * SPH).toBeLessThanOrEqual(8.01)
        // nobody else standing within a body of either while they talk
        const mid = (m.s.from + m.s.to) / 2
        for (const f of folk) {
          if (f === m.f || f === o.f) continue
          const p = lifePose(f.day, mid, 24)
          if (p.indoors || p.act === "walk") continue
          expect(Math.hypot(p.at[0] - m.s.at[0], p.at[2] - m.s.at[2])).toBeGreaterThan(0.6)
        }
      }
    }, 30000)

  test("a buyer and the merchant across the counter haggle on one clock, the coin changing hands together", () => {
    let n = 0
    for (const seed of [1, 2, 3]) {
      const { folk } = island(seed)
      const sells = folk.flatMap((f) => stays(f, "haggle-sell"))
      for (const b of folk.flatMap((f) => stays(f, "haggle-buy"))) {
        const s = sells.find((x) => x.routine!.day === b.routine!.day && x.from < b.to && x.to > b.from)
        expect(s).toBeDefined()
        const hour = Math.max(b.from, s!.from) + 0.01
        for (let t = 0; t < 12; t += 0.25) {
          const h = hour + t / SPH
          const pb = routineSample(b.routine!, routineClock(b.routine!, 0, h, SPH))
          const ps = routineSample(s!.routine!, routineClock(s!.routine!, 0, h, SPH))
          expect(pb.props.length > 0).toBe(ps.props.length > 0)
        }
        n++
      }
    }
    expect(n).toBeGreaterThan(2)
  }, 60000)

  test("lamplighters go round their lamps at dusk with a torch, and every one of them and the bards works", () => {
    for (const seed of [1, 2, 3]) {
      const { folk } = island(seed)
      const lighters = folk.filter((f) => f.role === "lamplighter")
      expect(lighters.length).toBeGreaterThan(0)
      for (const f of lighters) {
        const lamps = stays(f, "light")
        expect(lamps.length).toBeGreaterThanOrEqual(3)
        for (const s of lamps) {
          expect(s.from).toBeGreaterThan(17)
          expect(s.from).toBeLessThan(21)
          expect(s.act).toBe("work")
        }
      }
    }
  }, 60000)

  test("the notice board's readers stand clear of everything, of the pinning spot and of each other", () => {
    const { places } = island(1)
    const board = places.heroSpots.board()
    expect(board).not.toBeNull()
    const readers = boardReaders(board!, places.furniture)
    expect(readers.length).toBeGreaterThanOrEqual(3)
    for (const r of readers) {
      expect(places.furniture.blocked(r.at[0], r.at[2], 0.3)).toBe(false)
      expect(Math.hypot(r.at[0] - board!.spot.at[0], r.at[2] - board!.spot.at[2])).toBeGreaterThan(0.9)
      for (const o of readers)
        if (o !== r) expect(Math.hypot(o.at[0] - r.at[0], o.at[2] - r.at[2])).toBeGreaterThan(0.8)
    }
  })
})
