import { describe, expect, test } from "bun:test"
import {
  blightSpans,
  editedPlaces,
  LIVING,
  type LivingSpan,
  livingAt,
  livingLevel,
  workSpans,
  worldShows,
} from "../src/index.ts"
import { Feed, fileIn } from "./events-fixtures.ts"

/**
 * Living work (story/living.ts): reads glow, edits scaffold, failures blight, place by place, with their
 * timings. Places: core 0, world 1, sim 2, render 3.
 */

const T0 = 1_000_000

function guild(): Feed {
  const f = new Feed()
  f.start("gm", T0)
  f.start("h", T0, "gm", "explore")
  return f
}

/** A call that starts at `at` and ends `ms` later. */
function call(f: Feed, tool: string, input: Record<string, unknown>, at: number, ms: number, call: string) {
  f.change({ type: "tool", id: "h", call, name: tool, state: "running", input, at })
  if (ms >= 0) f.change({ type: "tool", id: "h", call, name: tool, state: "completed", input, at: at + ms })
}

const at = (f: Feed, t: number) => livingAt(workSpans(f.log.events, t), t)

describe("a read glows its place", () => {
  test("up over readRiseMs, held while it runs, out over readFadeMs once it is done", () => {
    const f = guild()
    call(f, "read", { filePath: fileIn("world") }, T0 + 1000, 3000, "r1")
    const start = T0 + 1000
    const end = start + 3000
    expect(at(f, start - 1).get(1)).toBeUndefined()
    // rising: half way up is under full, past the rise it is full
    const half = at(f, start + LIVING.readRiseMs / 2).get(1)?.read ?? 0
    expect(half).toBeGreaterThan(0.2)
    expect(half).toBeLessThan(0.8)
    expect(at(f, start + LIVING.readRiseMs).get(1)?.read).toBe(1)
    // held while running (a long read): full the whole way
    expect(at(f, end - 1).get(1)?.read).toBe(1)
    expect(at(f, end).get(1)?.read).toBe(1)
    // fading: lower and lower, gone at readFadeMs
    const a = at(f, end + 1000).get(1)?.read ?? 0
    const b = at(f, end + 3000).get(1)?.read ?? 0
    expect(a).toBeLessThan(1)
    expect(b).toBeLessThan(a)
    expect(b).toBeGreaterThan(0)
    expect(at(f, end + LIVING.readFadeMs).get(1)).toBeUndefined()
    // only its place
    expect(at(f, end).get(0)).toBeUndefined()
    expect(at(f, end).get(1)?.readers).toEqual(["h"])
  })

  test("a quick read (heard ending 200 ms in) still comes up, a search glows less, and a running one is followed", () => {
    const f = guild()
    f.tool("h", "read", { filePath: fileIn("core") }, T0 + 1000)
    const quick = at(f, T0 + 1200).get(0)?.read ?? 0
    expect(quick).toBeGreaterThan(0.3)
    expect(quick).toBeLessThan(1)
    f.grep("h", "sim", T0 + 2000)
    const g = at(f, T0 + 2200 + 100).get(2)?.read ?? 0
    expect(g).toBeGreaterThan(0)
    expect(g).toBeLessThanOrEqual(LIVING.searchLevel)
    call(f, "read", { filePath: fileIn("render") }, T0 + 3000, -1, "open")
    expect(at(f, T0 + 3000 + 20_000).get(3)?.read).toBe(1)
  })

  test("a call that names two places glows both; one heard only at its end starts there", () => {
    const f = guild()
    const input = { filePath: fileIn("core"), path: fileIn("world") }
    f.change({ type: "tool", id: "h", call: "g", name: "read", state: "completed", input, at: T0 + 500 })
    const spans = workSpans(f.log.events, T0 + 600)
    expect(spans.map((s) => s.place).sort()).toEqual([0, 1])
    for (const s of spans) {
      expect(s.start).toBe(T0 + 500)
      expect(s.end).toBe(T0 + 500)
    }
  })

  test("reduced motion: flat, on or off", () => {
    const f = guild()
    call(f, "read", { filePath: fileIn("world") }, T0, 1000, "r")
    const spans = workSpans(f.log.events, T0 + 1000)
    expect(livingAt(spans, T0 + 10, true).get(1)?.read).toBe(1)
    expect(livingAt(spans, T0 + 1000 + LIVING.readFadeMs / 2 - 1, true).get(1)?.read).toBe(1)
    expect(livingAt(spans, T0 + 1000 + LIVING.readFadeMs / 2, true).get(1)).toBeUndefined()
  })

  test("what is gone by t is not a span; the lookback bounds the read", () => {
    const f = guild()
    f.tool("h", "read", { filePath: fileIn("core") }, T0)
    expect(workSpans(f.log.events, T0 + 200 + LIVING.readFadeMs + 1)).toEqual([])
    expect(workSpans(f.log.events, T0 + LIVING.lookbackMs + 1000)).toEqual([])
  })
})

describe("an edit raises its scaffold", () => {
  test("from the call's start to editLingerMs after its end", () => {
    const f = guild()
    call(f, "edit", { filePath: fileIn("sim"), newString: "x" }, T0 + 1000, 500, "e1")
    const end = T0 + 1500
    expect(editedPlaces(workSpans(f.log.events, T0 + 999), T0 + 999).size).toBe(0)
    expect([...editedPlaces(workSpans(f.log.events, T0 + 1000), T0 + 1000)]).toEqual([2])
    expect([
      ...editedPlaces(workSpans(f.log.events, end + LIVING.editLingerMs - 1), end + LIVING.editLingerMs - 1),
    ]).toEqual([2])
    expect(
      editedPlaces(workSpans(f.log.events, end + LIVING.editLingerMs), end + LIVING.editLingerMs).size,
    ).toBe(0)
    // an edit does not glow
    expect(at(f, end).get(2)?.read).toBe(0)
    expect(at(f, end).get(2)?.editors).toEqual(["h"])
  })

  test("a write is an edit too; a second edit keeps it standing", () => {
    const f = guild()
    f.tool("h", "write", { filePath: fileIn("core"), content: "x" }, T0)
    f.edit("h", "core", T0 + 8000)
    const t = T0 + 200 + LIVING.editLingerMs + 2000
    expect([...editedPlaces(workSpans(f.log.events, t), t)]).toEqual([0])
  })
})

describe("a failing place is blighted until the fix lands, then heals", () => {
  /** h works in world (place 1) and falls there at 10 s; it is back at work at 25 s. */
  function fallen(): Feed {
    const f = new Feed()
    f.start("gm", 0)
    f.start("h", 0, "gm", "guild-implementer")
    f.edit("h", "world", 1000)
    f.change({ type: "status", id: "h", status: "failed", at: 10_000 })
    f.change({ type: "status", id: "h", status: "busy", at: 25_000 })
    return f
  }
  const blight = (f: Feed, t: number) => livingAt(blightSpans(worldShows(f.log, t), t), t).get(1)

  test("from the skeleton's rise, eased in over blightInMs, full while the grave stands", () => {
    const f = fallen()
    expect(blight(f, 9_999)).toBeUndefined()
    const rising = blight(f, 10_000 + LIVING.blightInMs / 2)?.blight ?? 0
    expect(rising).toBeGreaterThan(0.2)
    expect(rising).toBeLessThan(0.8)
    expect(blight(f, 10_000 + LIVING.blightInMs)?.blight).toBe(1)
    const standing = blight(f, 24_999)
    expect(standing?.blight).toBe(1)
    expect(standing?.failing).toEqual([{ who: "h", name: expect.any(String), cause: "fail" }])
  })

  test("the fix (the session back at work) heals it over healMs, though the skeleton stands on", () => {
    const f = fallen()
    const healing = blight(f, 25_000 + LIVING.healMs / 2)
    expect(healing?.blight).toBeGreaterThan(0.2)
    expect(healing?.blight).toBeLessThan(0.8)
    // healing, nobody is failing there any more
    expect(healing?.failing).toEqual([])
    expect(blight(f, 25_000 + LIVING.healMs)).toBeUndefined()
    // the grave is still on stage (the fixer has yet to strike it), the place is not blighted
    const shows = worldShows(f.log, 30_000)
    expect(shows.some((s) => s.kind === "undead")).toBe(true)
    expect(blightSpans(shows, 30_000)).toEqual([])
  })

  test("a fix sought past, then sought back: the grave as that time knows it", () => {
    const f = fallen()
    // a seek back to 20 s does not know the fix at 25 s: still blighted
    expect(blight(f, 20_000)?.blight).toBe(1)
    expect(livingLevel({ kind: "blight", place: 1, key: "k", start: 10_000, level: 1 }, 1e9)).toBe(1)
  })

  test("red tests blight the place they ran from; the passing run is the fix and heals it", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("h", 0, "gm", "guild-implementer")
    f.edit("h", "world", 1000)
    f.tool("h", "bash", { command: "bun test packages/world" }, 5000, {
      state: "failed",
      error: "1 failed",
    } as never)
    f.tool("h", "bash", { command: "bun test packages/world" }, 20_000)
    const red = blight(f, 12_000)
    expect(red?.blight).toBe(1)
    expect(red?.failing).toEqual([{ who: "h", name: expect.any(String), cause: "test" }])
    // the passing run ends at 20.2 s: healing, then healed
    const healing = blight(f, 20_200 + LIVING.healMs / 2)?.blight ?? 0
    expect(healing).toBeGreaterThan(0)
    expect(healing).toBeLessThan(1)
    expect(blight(f, 20_200 + LIVING.healMs)).toBeUndefined()
  })

  test("a red CI stands at no place, a failed deed's minion is flavour: neither blights", () => {
    const f = guild()
    f.sea({
      kind: "ci",
      id: "ci1",
      at: T0 + 1000,
      repo: "o/r",
      state: "failed",
      name: "check",
      branch: "main",
      sha: "a",
    })
    f.tool("h", "bash", { command: "make" }, T0 + 2000, { state: "failed", error: "exit 2" } as never)
    const t = T0 + 10_000
    const shows = worldShows(f.log, t)
    expect(shows.some((s) => s.kind === "undead")).toBe(true)
    expect(blightSpans(shows, t)).toEqual([])
  })

  test("reduced motion: no ease in, no heal ease", () => {
    const span: LivingSpan = { kind: "blight", place: 1, key: "k", start: 0, end: 5000, level: 1 }
    expect(livingLevel(span, 1, true)).toBe(1)
    expect(livingLevel(span, 5001, true)).toBe(0)
    expect(livingLevel(span, 5001)).toBeGreaterThan(0.9)
  })
})
