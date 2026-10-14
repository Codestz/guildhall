/**
 * The history's narration (hall/historyEvents.ts): when the moments are told as the island grows. At most
 * one caption per `CAPTION_GAP_S` of playback, the heaviest kept; the toasts the next tier; the feed every
 * moment up to the day; and all of it a function of `t` (and the speed), so a scrub tells what a
 * playthrough tells.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type Chronicle, isoOf, readChronicle, repoLegendOf } from "@guildhall/sim"
import { HISTORY_SECONDS } from "../src/hall/clock.ts"
import {
  type Beat,
  beatAt,
  beatsOf,
  CAPTION_GAP_S,
  CAPTION_HOLD_S,
  captionOf,
  entryOf,
  feedAt,
  gapOf,
  passed,
  SLIP,
  scheduleOf,
  spaced,
  TOAST_GAP_S,
  TOAST_MIN_WEIGHT,
  TOAST_WINDOW_S,
  toastsAt,
} from "../src/hall/historyEvents.ts"

const DIR = join(import.meta.dir, "../../../packages/sim/test/fixtures/repo")
const read = async (name: string): Promise<Chronicle> =>
  readChronicle(new Uint8Array(await Bun.file(join(DIR, `${name}.json.gz`)).arrayBuffer()))

const toldAt = (b: Beat) => b.at ?? b.t
const RATES = [0.5, 1, 2, 4]

describe("react's history, narrated", async () => {
  const c = await read("react")
  const beats = beatsOf(c, repoLegendOf(c))

  test("the beats are the chronicle's moments on the clock, oldest first", () => {
    expect(beats.length).toBeGreaterThan(60)
    for (let i = 1; i < beats.length; i++)
      expect((beats[i] as Beat).t).toBeGreaterThanOrEqual((beats[i - 1] as Beat).t)
    expect(beats.find((b) => b.moment.id === "founded")?.t).toBe(0)
  })

  for (const rate of RATES)
    test(`at ${rate}×: one caption per ${CAPTION_GAP_S} s of playback at most, the heaviest kept`, () => {
      const { captions, toasts } = scheduleOf(beats, rate)
      const gap = gapOf(CAPTION_GAP_S, rate)
      for (let i = 1; i < captions.length; i++)
        expect(toldAt(captions[i] as Beat) - toldAt(captions[i - 1] as Beat)).toBeGreaterThanOrEqual(
          gap - 1e-9,
        )
      // a caption is told on its day or a little after, never before
      for (const b of captions) {
        expect(toldAt(b)).toBeGreaterThanOrEqual(b.t)
        expect(toldAt(b) - b.t).toBeLessThanOrEqual(SLIP * gap + 1e-9)
      }
      // every beat left out had a caption at least as heavy within reach of its moment
      const kept = new Set(captions.map((b) => b.moment.id))
      for (const b of beats) {
        if (kept.has(b.moment.id)) continue
        const blocker = captions.find(
          (k) => k.moment.weight >= b.moment.weight && Math.abs(toldAt(k) - b.t) < gap + SLIP * gap + 1e-9,
        )
        expect(blocker).toBeDefined()
      }
      // the founding is always told first
      expect(captions[0]?.moment.id).toBe("founded")
      // the toasts: the next tier, never a caption's, at most one per TOAST_GAP_S
      const tg = gapOf(TOAST_GAP_S, rate)
      for (let i = 1; i < toasts.length; i++)
        expect(toldAt(toasts[i] as Beat) - toldAt(toasts[i - 1] as Beat)).toBeGreaterThanOrEqual(tg - 1e-9)
      for (const b of toasts) {
        expect(kept.has(b.moment.id)).toBe(false)
        expect(b.moment.weight).toBeGreaterThanOrEqual(TOAST_MIN_WEIGHT)
      }
      // the whole history at this speed holds no more captions than its seconds allow
      expect(captions.length).toBeLessThanOrEqual(Math.floor(HISTORY_SECONDS / rate / CAPTION_GAP_S) + 1)
    })

  test("at 1×: the founding, the eras as acts, the places and hands in the toasts", () => {
    const { captions, toasts } = scheduleOf(beats, 1)
    const said = captions.map((b) => `${isoOf(b.moment.day)} ${b.moment.chapter?.title ?? b.moment.text}`)
    expect(said.slice(0, 4)).toEqual([
      "2013-05-29 Ben Newman makes the first commit: the island of react is founded",
      "2016-04-08 The Age of v15",
      "2017-09-26 The Old Ground Cleared",
      "2020-10-20 The Age of v17",
    ])
    expect(toasts.some((b) => b.moment.who === "Dan Abramov")).toBe(true)
    expect(toasts.some((b) => b.moment.unit === "compiler")).toBe(true)
  })

  test("scrub = play: the caption at t is the same reached by playing or by a jump", () => {
    for (const rate of RATES) {
      const { captions } = scheduleOf(beats, rate)
      const hold = gapOf(CAPTION_HOLD_S, rate)
      // play at 60 frames a second: every caption is the clock's at some frame, in order
      const dt = rate / HISTORY_SECONDS / 60
      const heard: number[] = []
      const played: [t: number, k: number][] = []
      for (let t = 0; t <= 1 + 1e-9; t += dt) {
        const k = beatAt(captions, Math.min(1, t), hold)
        played.push([Math.min(1, t), k])
        if (k >= 0 && heard.at(-1) !== k) heard.push(k)
      }
      expect(heard).toEqual(captions.map((_, k) => k))
      // a jump to any of those moments (in any order) lands on the same caption
      const jumps = played.map((p, i) => [p, (i * 7919) % played.length] as const).sort((a, b) => a[1] - b[1])
      for (const [[t, k]] of jumps.slice(0, 400)) expect(beatAt(captions, t, hold)).toBe(k)
    }
  })

  test("toasts at t are those passed within their window; a jump back shows them again", () => {
    const { toasts } = scheduleOf(beats, 1)
    const window = gapOf(TOAST_WINDOW_S, 1)
    const one = toasts[3] as Beat
    const at = toldAt(one)
    expect(toastsAt(toasts, at - 1e-4, window).includes(one)).toBe(false)
    expect(toastsAt(toasts, at, window).includes(one)).toBe(true)
    expect(toastsAt(toasts, at + window + 1e-4, window).includes(one)).toBe(false)
    expect(toastsAt(toasts, at, window)).toEqual(toastsAt(toasts, at, window))
  })

  test("the feed holds every moment up to the day, newest last; all of them at today", () => {
    const half = feedAt(beats, 0.5)
    expect(half.length).toBe(passed(beats, 0.5))
    expect(half.every((e) => e.at <= (c.start + 0.5 * (c.end - c.start)) * 86_400_000)).toBe(true)
    expect(feedAt(beats, 1).length).toBe(beats.length)
    expect(feedAt(beats, 0).map((e) => e.who || e.text)[1]).toBe("Ben Newman")
  })

  test("a line opens with its hand's name in their colour; a place's opens its dossier; an era the book", () => {
    const dan = beats.find((b) => b.moment.who === "Dan Abramov") as Beat
    expect(entryOf(dan)).toMatchObject({
      who: "Dan Abramov",
      kind: "join",
      text: "arrives: the first of 1,601 commits",
    })
    const dom = beats.find((b) => b.moment.unit === "packages/react-dom" && b.moment.kind === "place") as Beat
    expect(entryOf(dom, (u) => (u === "packages/react-dom" ? 7 : -1)).hero).toBe("place:7")
    const era = beats.find(
      (b) => b.moment.kind === "era" && b.moment.chapter?.title === "The Age of v15",
    ) as Beat
    expect(entryOf(era)).toMatchObject({ who: "II. The Age of v15", hero: "era:era-2" })
    expect(captionOf(era, 1)).toMatchObject({
      kind: "chapter",
      parts: [
        { text: "Chapter II" },
        { text: "The Age of v15" },
        { text: "v15.0.0 sets sail · April 2016 – September 2017" },
      ],
    })
    expect(captionOf(dan, 2).text).toBe("Dan Abramov arrives: the first of 1,601 commits.")
  })
})

describe("guildhall's three days, narrated", async () => {
  const c = await read("guildhall")
  const beats = beatsOf(c, repoLegendOf(c))

  test("founder, the days as chapters, its first release and its last place in the toasts", () => {
    const { captions, toasts } = scheduleOf(beats, 1)
    expect(captions.map((b) => b.moment.chapter?.title ?? b.moment.id)).toEqual([
      "founded",
      "The Second Day",
      "The First Galleon",
    ])
    const rest = toasts.map((b) => b.moment.id)
    expect(rest).toContain("release:v0.1.0")
  })
})

describe("spacing", () => {
  const beat = (id: string, t: number, weight: number): Beat => ({
    t,
    moment: { id, day: 0, kind: "milestone", weight, text: id, parts: [{ text: id }] },
  })

  test("the heavier of two crowding beats is told; the lighter waits a little, or is left out", () => {
    const gap = 0.1
    const out = spaced([beat("a", 0.5, 10), beat("b", 0.52, 50), beat("c", 0.6, 5)], gap)
    expect(out.map((b) => b.moment.id)).toEqual(["b", "c"])
    // c waited for b: told one gap after it, within its slip
    expect(toldAt(out[1] as Beat)).toBeCloseTo(0.62, 9)
    // a would have to go before its day: never
    expect(out.some((b) => b.moment.id === "a")).toBe(false)
  })

  test("as heavy: the earlier wins", () => {
    expect(spaced([beat("late", 0.31, 20), beat("early", 0.3, 20)], 0.1).map((b) => b.moment.id)).toEqual([
      "early",
    ])
  })
})
