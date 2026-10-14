/**
 * Work routines (decisions.md "Game feel plan", task A): everyone works, a routine's sample is a pure
 * function of (stay, seed, t), its loops read (a fisher's catch, a miner's cart), the stocks it fills
 * only grow over a day (but for what is carried off or tipped), and the carry walks go where they should.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type Folk, lifePlaces, lifePose, planFolk, workTiles } from "../src/hex/life.ts"
import {
  CHOP_TRIP,
  cyclesSpan,
  type LifeSample,
  PROPS,
  planStocks,
  ROUTINES,
  routineCycles,
  routineSample,
  routineSpan,
  routineYield,
  STOCK_DAY,
  stockAt,
} from "../src/hex/routines.ts"
import { hexIsland, hexWalk, hexWorld, hexZones, installTilePrefabs, type TilePrefab } from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as TilePrefab),
)
afterAll(() => installTilePrefabs(null))

/** Screen seconds to a day hour (the studio's SPEEDUP 20). */
const SPH = 180

const islands = new Map<number, { folk: Folk[]; zones: ReturnType<typeof hexZones> }>()
function island(seed: number) {
  let got = islands.get(seed)
  if (!got) {
    const h = hexIsland({ seed, files: 4000 })
    const z = hexZones(h)
    const w = hexWorld(h, z)
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    const places = lifePlaces(h, z, w, walk)
    got = { folk: planFolk(h, z, w, walk, { seed, pace: 144, places, secPerHour: SPH }), zones: z }
    islands.set(seed, got)
  }
  return got
}

const works = (f: Folk) => f.day.some((s) => s.kind === "stay" && s.act === "work")

describe("every role works", () => {
  for (const seed of [1, 2, 3, 4, 5, 6])
    test(`seed ${seed}: every townsfolk has work`, () => {
      const { folk, zones } = island(seed)
      const idle = folk.filter((f) => !works(f)).map((f) => `${zones.zones[f.zone]!.kind}/${f.role}`)
      expect(idle).toEqual([])
    }, 30000)

  test("over the six seeds every working role plays its own routine somewhere", () => {
    const seen = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6])
      for (const f of island(seed).folk)
        for (const s of f.day) if (s.kind === "stay" && s.routine) seen.add(`${f.role}:${s.routine.id}`)
    for (const want of [
      "fisher:fish",
      "fisher:deliver",
      "lumberjack:chop",
      "lumberjack:stack",
      "miner:mine",
      "smith:smith",
      "farmer:farm",
      "merchant:serve",
      "tavern-keeper:tavern",
      "archer:archery",
      "guard:post",
      "monk:bell",
      "monk:garden",
    ])
      expect([want, seen.has(want)]).toEqual([want, true])
  }, 60000)
})

describe("a routine is a pure function of its stay, its seed and the time", () => {
  const ids = Object.keys(ROUTINES)

  test("played on in small steps or set to any time: the same sample", () => {
    for (const id of ids) {
      const at = { id, seed: 777 }
      const played: LifeSample[] = []
      for (let k = 0; k < 12000; k++) played.push(routineSample(at, k / 30))
      // set out of order (another stay's routine drawn between, other blocks first)
      const other = { id, seed: 778 }
      for (let k = played.length - 1; k >= 0; k -= 37) {
        routineSample(other, k * 3.1)
        routineSample(at, 9999 - k)
        expect(routineSample({ id, seed: 777 }, k / 30)).toEqual(played[k]!)
        expect(routineSample(at, k / 30)).toEqual(played[k]!)
      }
    }
  })

  test("every block lasts the same, and a clip's phase stays within it", () => {
    for (const id of ids) {
      const span = routineSpan(id)
      for (const seed of [1, 2, 3]) {
        const at = { id, seed }
        const K = ROUTINES[id]!.block ?? 8
        expect(cyclesSpan(at, K)).toBeCloseTo(span, 6)
        expect(cyclesSpan(at, 2 * K)).toBeCloseTo(2 * span, 6)
        for (let t = 0; t < span * 2; t += 0.37) {
          const s = routineSample(at, t)
          expect(s.phase).toBeGreaterThanOrEqual(0)
          expect(s.phase).toBeLessThan(1)
          expect(s.u).toBeGreaterThanOrEqual(0)
          expect(s.u).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  test("what a routine has yielded is what its beats said, counted as they came", () => {
    for (const [id, beat] of [
      ["fish", "drop"],
      ["mine", "throw"],
      ["smith", "quench"],
      ["farm", "drop"],
      ["archery", "release"],
    ] as const) {
      const at = { id, seed: 99 }
      let seen = 0
      let last = ""
      for (let t = 0; t < 600; t += 1 / 30) {
        const s = routineSample(at, t)
        const key = s.beat === beat ? `${s.cycle}` : ""
        if (key && key !== last) seen++
        last = key
        // (a yield counts once its part is over; a beat comes inside it)
        expect(routineYield(at, t)).toBeLessThanOrEqual(seen)
      }
      expect(routineYield(at, 600)).toBeGreaterThan(seen - 2)
    }
  })

  test("a fisher's loop: cast, a wait of 4 to 9 s, the bite, reeling, the catch, into the basket", () => {
    const at = { id: "fish", seed: 4242 }
    const order: string[] = []
    const waits: number[] = []
    let since = 0
    let prev = ""
    for (let t = 0; t < routineSpan("fish"); t += 0.01) {
      const s = routineSample(at, t)
      if (s.clip !== prev) {
        if (prev === "Fishing_Idle") waits.push(t - since)
        since = t
        if (order.length < 6) order.push(s.clip)
        prev = s.clip
      }
    }
    expect(order).toEqual([
      "Fishing_Cast",
      "Fishing_Idle",
      "Fishing_Bite",
      "Fishing_Reeling",
      "Fishing_Catch",
      "PickUp",
    ])
    expect(waits.length).toBe(8)
    for (const w of waits) {
      expect(w).toBeGreaterThanOrEqual(4 - 0.02)
      expect(w).toBeLessThanOrEqual(9 + 0.02)
    }
    // seeded: not all the same
    expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(3)
    // the fish shows from the catch until it is in the basket
    const caught = routineSample(at, 0)
    expect(caught.props).toContain(PROPS.rod)
  })

  test("a miner's cart: six throws, then it rolls its rail and back", () => {
    const at = { id: "mine", seed: 5 }
    const span = routineSpan("mine")
    expect(routineYield(at, span - 0.01)).toBe(6)
    expect(routineCycles(at, span + 0.01)).toBe(6)
  })

  test("per frame, 200 townsfolk sample in well under 0.1 ms", () => {
    const ats = Array.from({ length: 200 }, (_, k) => ({ id: ids[k % ids.length]!, seed: k * 31 }))
    // warm
    for (let f = 0; f < 200; f++) for (const at of ats) routineSample(at, f / 60)
    const frames = 2000
    const t0 = performance.now()
    for (let f = 0; f < frames; f++) for (const at of ats) routineSample(at, 1000 + f / 60)
    const per = (performance.now() - t0) / frames
    expect(per).toBeLessThan(0.1)
  })
})

describe("carry walks and stocks over a day", () => {
  const { folk } = island(1)
  const stocks = planStocks(folk)

  test("a woodcutter carries a log to the pile every few rounds of blows, a fisher the basket to a stall", () => {
    const logs = folk.flatMap((f) => f.day.filter((s) => s.kind === "walk" && s.carry === PROPS.log))
    const baskets = folk.filter((f) => f.day.some((s) => s.kind === "walk" && s.carry === PROPS.basket))
    expect(logs.length).toBeGreaterThan(20)
    expect(baskets.length).toBeGreaterThan(0)
    for (const f of baskets) {
      const k = f.day.findIndex((s) => s.kind === "walk" && s.carry === PROPS.basket)
      const walk = f.day[k]!
      const at = f.day[k + 1]!
      expect(at.kind === "stay" && at.routine?.id).toBe("deliver")
      // before lunch, after the morning's fishing
      expect(walk.from).toBeGreaterThan(9.5)
      expect(walk.from).toBeLessThan(12.5)
      expect(f.day[k - 1]?.kind === "stay" && f.day[k - 1]!.kind === "stay").toBe(true)
    }
    // the chopping between two trips is CHOP_TRIP rounds
    for (const f of folk) {
      const day = f.day
      for (let k = 1; k + 1 < day.length; k++) {
        const s = day[k]!
        if (s.kind !== "stay" || s.routine?.id !== "chop") continue
        const next = day[k + 1]!
        if (next.kind !== "walk" || next.carry !== PROPS.log) continue
        expect((s.to - s.from) * SPH).toBeCloseTo(cyclesSpan(s.routine, CHOP_TRIP), 4)
      }
    }
  })

  test("a lifePose walking a carry walk says what is carried", () => {
    const f = folk.find((ff) => ff.day.some((s) => s.kind === "walk" && s.carry === PROPS.log))!
    const walk = f.day.find((s) => s.kind === "walk" && s.carry === PROPS.log)!
    const p = lifePose(f.day, (walk.from + walk.to) / 2, 24)
    expect(p.act).toBe("walk")
    expect(p.carry).toBe(PROPS.log)
    const stay = f.day.find((s) => s.kind === "stay" && s.routine?.id === "chop")!
    const q = lifePose(f.day, (stay.from + stay.to) / 2, 24)
    expect(q.routine?.id).toBe("chop")
    expect(q.since).toBe(stay.from)
  })

  test("the piles, crates, bars, planks, heaps and a stall's fish only grow over a day; baskets until carried off", () => {
    const kinds = new Set(stocks.map((s) => s.kind))
    for (const k of ["basket", "log-pile", "ore-cart", "ore-heap", "stall-fish"]) expect(kinds).toContain(k)
    for (const s of stocks) {
      let last = -1
      let took = 0
      for (let h = STOCK_DAY; h < STOCK_DAY + 24; h += 1 / 60) {
        const now = stockAt(s, h % 24, SPH)
        expect(now.count).toBeGreaterThanOrEqual(0)
        if (s.kind === "ore-cart" || s.kind === "arrows") {
          // tipped and pulled out again and again, never over a load
          expect(now.count).toBeLessThanOrEqual(s.cap)
          continue
        }
        const taken = (s.takes ?? []).filter((t) => t <= h % 24 && t > STOCK_DAY).length
        if (taken > took) {
          took = taken
          last = -1
        }
        expect(now.count).toBeGreaterThanOrEqual(last)
        last = now.count
      }
    }
    // and they fill: by evening the piles have logs, the stalls fish, the heaps ore
    const evening = (kind: string) =>
      stocks.filter((s) => s.kind === kind).reduce((n, s) => n + stockAt(s, 19, SPH).count, 0)
    expect(evening("log-pile")).toBeGreaterThan(10)
    expect(evening("stall-fish")).toBeGreaterThan(0)
    expect(evening("ore-heap")).toBeGreaterThan(0)
    // a basket fills over the morning
    const basket = stocks.find((s) => s.kind === "basket")!
    expect(stockAt(basket, 9, SPH).count).toBeGreaterThan(stockAt(basket, 7, SPH).count)
  })
})
