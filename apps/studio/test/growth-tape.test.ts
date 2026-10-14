/**
 * The history's growth tape (hall/timeline.tsx, V1's TimelineGrowth): what re-renders it, which key press
 * is its Space, the beats it draws (each its own shape), its figures as parts, and the plates' safe band.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type Chronicle, DAY_MS, readChronicle } from "@guildhall/sim"
import { busiestWeek, historyMarkers } from "../src/hall/history.ts"
import { growthLine, growthParts } from "../src/hall/hud/view.ts"
import { barKey, isSpace } from "../src/hall/timeline.tsx"
import { layoutPlates, type PlateBox, SAFE_TOP } from "../src/hexworld/places.ts"

const DIR = join(import.meta.dir, "../../../packages/sim/test/fixtures/repo")
const read = async (name: string): Promise<Chronicle> =>
  readChronicle(new Uint8Array(await Bun.file(join(DIR, `${name}.json.gz`)).arrayBuffer()))

describe("the tape's renders", () => {
  test("while it plays the key holds still (the clock's ticks move the bar, not React)", () => {
    const at = (t: number) => barKey({ playing: true, rate: 1, t, jumps: 0 })
    expect(at(0.1)).toBe(at(0.7))
  })
  test("a pause, a speed, a jump or a scrub at rest re-render it", () => {
    const base = { playing: false, rate: 1, t: 0.4, jumps: 0 }
    const key = barKey(base)
    expect(barKey({ ...base, playing: true })).not.toBe(key)
    expect(barKey({ ...base, rate: 2 })).not.toBe(key)
    expect(barKey({ ...base, jumps: 1 })).not.toBe(key)
    expect(barKey({ ...base, t: 0.5 })).not.toBe(key)
  })
})

describe("Space", () => {
  const press = (target: unknown, more: Partial<KeyboardEvent> = {}) =>
    isSpace({ key: " ", repeat: false, metaKey: false, ctrlKey: false, altKey: false, target, ...more } as never)
  test("on the page or the scrub it plays and pauses", () => {
    expect(press(null)).toBe(true)
    expect(press({ tagName: "BODY" })).toBe(true)
    expect(press({ tagName: "INPUT", type: "range" })).toBe(true)
  })
  test("never in a field, on a button of its own, held down, or with a modifier", () => {
    expect(press({ tagName: "INPUT", type: "text" })).toBe(false)
    expect(press({ tagName: "TEXTAREA" })).toBe(false)
    expect(press({ tagName: "BUTTON" })).toBe(false)
    expect(press({ tagName: "DIV", isContentEditable: true })).toBe(false)
    expect(press(null, { repeat: true })).toBe(false)
    expect(press(null, { metaKey: true })).toBe(false)
    expect(isSpace({ key: "k", repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: null })).toBe(false)
  })
})

describe("react's tape", async () => {
  const c = await read("react")
  test("the eras are tall notches, the busiest week a glow, every beat inside the history", () => {
    const marks = historyMarkers(c)
    const eras = marks.filter((m) => m.kind === "era")
    expect(eras.length).toBeGreaterThanOrEqual(4)
    expect(eras[0]?.label).toMatch(/^Chapter II · v15/)
    expect(marks.filter((m) => m.kind === "busiest")).toHaveLength(1)
    // a major that opens an era is that era's beat, not a second one on the same day
    for (const r of marks.filter((m) => m.kind === "release"))
      expect(eras.some((e) => Math.abs(e.at - r.at) < DAY_MS)).toBe(false)
  })
  test("the busiest week: the most commits, its middle day", () => {
    const b = busiestWeek(c)
    const commits = c.weekly.commits ?? []
    expect(b?.commits).toBe(Math.max(...commits))
    expect(b?.day).toBe(c.start + commits.indexOf(b?.commits ?? -1) * 7 + 3)
    expect(busiestWeek({ ...c, weekly: {} })).toBeNull()
  })
  test("the figures as three parts, the line their join", () => {
    const day = c.start + 1000
    const parts = growthParts(c, day)
    expect(parts).toHaveLength(3)
    expect(parts[1]).toMatch(/in town$/)
    expect(growthLine(c, day)).toBe(parts.join(" · "))
    expect(growthParts(c, c.end)[2]).toBe(`${c.repo.files.toLocaleString("en-US")} files`)
  })
})

describe("the plates' safe band", () => {
  const box: PlateBox = { full: [200, 44], sm: [120, 30] }
  test("a plate whose heart is under the HUD's top row slides down below it", () => {
    const [laid] = layoutPlates([[400, 50]], [box], [0], [], [1000, 800], undefined, SAFE_TOP)
    expect(laid?.at?.[1]).toBeGreaterThanOrEqual(SAFE_TOP + 44)
  })
  test("without a band, as before", () => {
    const [laid] = layoutPlates([[400, 50]], [box], [0], [], [1000, 800])
    expect(laid?.at?.[1]).toBe(50)
  })
})
