/**
 * The hall's history (hall/order.ts, history.ts): the reveal order has no holes, the count follows the
 * chronicle's tiles at a bounded speed and lands exactly, `?t=` reads and writes, and t = 1 is the whole
 * island (the static hall's picture).
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { REVEAL_SPAN } from "@guildhall/render"
import { DAY_MS, dayOf, filesAt, isoOf, readChronicle } from "@guildhall/sim"
import { hexIsland, landTiles } from "@guildhall/world"
import {
  CATCH_UP_S,
  dayAt,
  follow,
  frontierRate,
  historyMarkers,
  readT,
  tilesAt,
  tOfDay,
  writeT,
} from "../src/hall/history.ts"
import { skirt, tilePlaces } from "../src/hall/order.ts"
import { repoOf } from "../src/hexworld/hall.ts"

/** Whether, with the tiles placed under `count` in, any land still out is cut off from the sea (a hole). */
function hasHole(h: ReturnType<typeof hexIsland>, place: Int32Array, count: number): boolean {
  const g = h.grid
  const N = g.size
  const seen = new Uint8Array(N)
  const queue: number[] = []
  // flood the outside from every sea tile over the land not yet in
  for (let i = 0; i < N; i++)
    if (place[i] === -1) {
      seen[i] = 1
      queue.push(i)
    }
  while (queue.length) {
    const i = queue.pop() as number
    for (const j of g.neighbours(i)) {
      if (j < 0 || seen[j]) continue
      if ((place[j] as number) >= count) {
        seen[j] = 1
        queue.push(j)
      }
    }
  }
  for (let i = 0; i < N; i++) if ((place[i] as number) >= count && !seen[i]) return true
  return false
}

describe("replay places", () => {
  for (const [seed, files] of [
    [1, 7252],
    [3, 1500],
    [7, 400],
  ] as const) {
    test(`seed ${seed}, ${files} files: places follow the rank, the sea stays out, no island of n tiles has a hole`, () => {
      const h = hexIsland({ seed, files })
      const { place, ranked } = tilePlaces(h)
      let filled = 0
      for (let i = 0; i < h.grid.size; i++) {
        const rk = h.rank[i] as number
        const p = place[i] as number
        if (rk >= 0) {
          expect(p).toBeGreaterThanOrEqual(0)
          // never later than its rank: filling a hole only brings a tile forward
          expect(p).toBeLessThanOrEqual(rk)
          if (p !== rk) filled++
        } else if (h.coast[i] === 0) expect(p).toBe(-1)
        else {
          // land without a rank (an inland sea filled in) is placed last, then brought forward as a hole
          expect(p).toBeGreaterThanOrEqual(0)
          expect(p).toBeLessThanOrEqual(ranked)
        }
      }
      // the ranks are dense: every rank under `ranked` is some tile's
      const ranks = new Set<number>()
      for (let i = 0; i < h.grid.size; i++) if ((h.rank[i] as number) >= 0) ranks.add(h.rank[i] as number)
      expect(ranks.size).toBe(ranked)
      for (const count of [1, 80, 200, 330, 560, 900, Math.floor(ranked / 2), ranked, ranked + 1])
        expect(hasHole(h, place, count)).toBe(false)
      // the filled holes are few (seed 1 at 7,252 files: 115 of 2,294): the order is still the growth order
      expect(filled).toBeLessThan(ranked * 0.1)
    })
  }
})

const REPO_DIR = join(import.meta.dir, "../public/lab/repo")
const read = async (name: string) =>
  readChronicle(new Uint8Array(await Bun.file(join(REPO_DIR, `${name}.json.gz`)).arrayBuffer()))

describe("the history's count", () => {
  test("tiles(t) climbs from the first commit's island to today's, eased between days", async () => {
    const c = await read("react")
    const first = tilesAt(c, c.start)
    const today = tilesAt(c, c.end)
    expect(first).toBe(landTiles(filesAt(c, c.start)))
    expect(today).toBe(landTiles(filesAt(c, c.end)))
    expect(first).toBeLessThan(today)
    const d = c.start + 400
    const mid = tilesAt(c, d + 0.5)
    expect(mid).toBeGreaterThanOrEqual(Math.min(tilesAt(c, d), tilesAt(c, d + 1)))
    expect(mid).toBeLessThanOrEqual(Math.max(tilesAt(c, d), tilesAt(c, d + 1)))
    expect(dayAt(c, 0)).toBe(c.start)
    expect(dayAt(c, 1)).toBe(c.end)
    expect(tOfDay(c, dayAt(c, 0.37))).toBeCloseTo(0.37, 12)
  })

  test("follow: bounded while playing, a scrub catches up quickly, and it lands exactly", () => {
    // playing: never faster than the limit
    expect(follow(100, 600, 0.1, true, 200)).toBe(120)
    expect(follow(100, 110, 0.1, true, 200)).toBe(110)
    expect(follow(600, 100, 0.1, true, 200)).toBe(580)
    // paused: the gap closes in about CATCH_UP_S
    let n = 0
    let frames = 0
    while (n !== 2000 && frames < 1000) {
      n = follow(n, 2000, 1 / 60, false, 100)
      frames++
    }
    expect(n).toBe(2000)
    expect(frames / 60).toBeLessThan(CATCH_UP_S * 6)
    // nothing drawn yet: straight to the target
    expect(follow(Number.NaN, 42, 0.016, true, 1)).toBe(42)
    // a long frame moves no more than a short one's cap
    expect(follow(0, 1e6, 10, true, 100)).toBe(10)
  })

  test("the frontier's speed: twice the history's pace, faster at a faster rate, never crawling", () => {
    expect(frontierRate(500, 2500, 1, 20)).toBe(200)
    expect(frontierRate(500, 2500, 4, 20)).toBe(800)
    expect(frontierRate(500, 2500, 0.5, 20)).toBe(200)
    expect(frontierRate(330, 340, 1, 20)).toBe(30)
  })

  test("?t= reads a fraction or a day, and is written as the day (today: none)", async () => {
    const c = await read("guildhall")
    expect(readT(null)).toBeNull()
    expect(readT("0.5")).toEqual({ t: 0.5 })
    expect(readT("2")).toBeNull()
    expect(readT("soon")).toBeNull()
    expect(readT("2019-03-01")).toEqual({ day: dayOf("2019-03-01T00:00:00Z") })
    expect(writeT(c, 1)).toBeNull()
    const day = writeT(c, 0)
    expect(day).toBe(isoOf(c.start))
    const back = readT(day)
    expect(back && "day" in back ? tOfDay(c, back.day) : -1).toBe(0)
  })

  test("the bar's beats: in time order, inside the history", async () => {
    const c = await read("react")
    const marks = historyMarkers(c)
    expect(marks.length).toBeGreaterThan(0)
    for (let k = 1; k < marks.length; k++) expect(marks[k]!.at).toBeGreaterThanOrEqual(marks[k - 1]!.at)
    for (const m of marks) {
      expect(m.at).toBeGreaterThan(c.start * DAY_MS)
      expect(m.at).toBeLessThanOrEqual(c.end * DAY_MS)
    }
  })

  test("t = 1 is the static hall: every tile whole, every skirt gone, at the count today gives", async () => {
    for (const name of ["react", "guildhall"]) {
      const c = await read(name)
      const repo = repoOf(c, "local")
      if (repo.kind !== "chronicled") throw new Error("no chronicle")
      const h = hexIsland({ seed: 3, files: repo.files })
      const places = tilePlaces(h)
      // the count at t = 1 (history.ts: the whole island, whatever its ranks) and its frontier
      const n = Math.max(places.ranked, tilesAt(c, c.end))
      const count = n + REVEAL_SPAN
      let last = -1
      for (let i = 0; i < places.place.length; i++) last = Math.max(last, places.place[i] as number)
      // the reveal shader's weight is clamp((count - place) / span): 1 for the last place too
      expect((count - last) / REVEAL_SPAN).toBeGreaterThanOrEqual(1)
      // a skirt leaves once count >= its until (a later tile's place) + span
      const wall = skirt(h, () => 0, places)
      let until = -1
      for (const u of wall.until) until = Math.max(until, u)
      expect(count).toBeGreaterThanOrEqual(until + REVEAL_SPAN)
    }
  })
})
