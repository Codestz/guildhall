/**
 * The hall's HUD wiring (T3): toasts told once per run of repeats, the timeline's one scale picked for
 * you and its few beats, the history bar's growth line, the director's skip over a quiet stretch, and a
 * told story's acts as hours.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { readChronicle } from "@guildhall/sim"
import { pickToasts } from "@guildhall/ui"
import { fewMarkers, groupRepeats, REPEAT_MS, type SessionEntry } from "../src/hall/feeds/view.ts"
import { storyHour } from "../src/hall/hud/HallHud.tsx"
import { QUIET_AHEAD_MS, quietSkip, SKIP_MAX } from "../src/hall/hud/mount.tsx"
import { growthLine } from "../src/hall/hud/view.ts"
import { barScale } from "../src/hall/timeline.tsx"

let seq = 0
const line = (at: number, over: Partial<SessionEntry> = {}): SessionEntry => {
  const key = `s${seq++}`
  return {
    key,
    at,
    kind: "fail",
    who: "Artisan II",
    banner: "#c33",
    text: `bash failed: engine ${key}`,
    short: "bash failed",
    hero: "a2",
    same: "actor.deed|a2|bash|true",
    ...over,
  }
}

describe("toasts: repeats told once", () => {
  test("three failures of one tool in a row are one line, ×3, at the newest", () => {
    const runs = [line(1000), line(2000), line(3000)]
    const out = groupRepeats(runs)
    expect(out).toHaveLength(1)
    expect(out[0]?.text).toBe("bash failed ×3")
    expect(out[0]?.key).toBe(runs[2]?.key)
    expect(out[0]?.at).toBe(3000)
  })

  test("another line of the same hero between, or a long wait, starts a new run", () => {
    const other = line(1500, {
      kind: "deed",
      same: "actor.deed|a2|read|false|x",
      text: "read x",
      short: "read",
    })
    expect(groupRepeats([line(1000), other, line(2000)])).toHaveLength(3)
    expect(groupRepeats([line(0), line(REPEAT_MS + 1)])).toHaveLength(2)
  })

  test("another hero's lines between do not break a run, and the run moves to the end", () => {
    const b = line(1500, {
      hero: "b",
      who: "Warden",
      same: "actor.join|b|joins",
      text: "joins the party",
      kind: "join",
    })
    const out = groupRepeats([line(1000), b, line(2000)])
    expect(out.map((e) => e.text)).toEqual(["joins the party", "bash failed ×2"])
  })

  test("a repeat brings its toast back: the grouped line has a key the toasts have not seen", () => {
    const seen = new Map<string, number>()
    const first = groupRepeats([line(1000)])
    expect(pickToasts(first, 0, seen, 2)).toHaveLength(1)
    // long after the first toast faded, a second failure: the run's toast comes up again
    const both = groupRepeats([...first, line(2000)])
    const shown = pickToasts(both, 60_000, seen, 2)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.text).toBe("bash failed ×2")
  })
})

describe("the timeline: one scale, picked for you", () => {
  test("a session's scale once heard from; a repo's growth without one; nothing without either", () => {
    expect(barScale(true, true, true)).toBe("session")
    expect(barScale(false, true, false)).toBe("session")
    expect(barScale(true, false, false)).toBe("history")
    expect(barScale(false, false, false)).toBeNull()
  })

  test("a live hall still waiting for its first event shows its history meanwhile", () => {
    expect(barScale(true, true, false)).toBe("history")
  })

  test("few beats: the telling ones first, none crowding another", () => {
    const marks = [
      { at: 100, kind: "quest" as const },
      { at: 105, kind: "plea" as const },
      { at: 500, kind: "loot" as const },
      { at: 900, kind: "fail" as const },
      { at: 2000, kind: "quest" as const },
    ]
    const few = fewMarkers(marks, 0, 1000, 0.05)
    expect(few.map((m) => m.kind)).toEqual(["plea", "loot", "fail"])
    expect(fewMarkers(marks, 0, 1000, 0.001, 2).map((m) => m.kind)).toEqual(["plea", "fail"])
  })
})

describe("the history bar's growth line", () => {
  test("contributors so far, those in town, and the files, on a day", async () => {
    const c = await readChronicle(
      new Uint8Array(await Bun.file(join(import.meta.dir, "../public/lab/repo/react.json.gz")).arrayBuffer()),
    )
    const today = growthLine(c, c.end)
    expect(today).toContain(`${c.repo.contributors.toLocaleString("en-US")} contributors`)
    expect(today).toContain(`${c.repo.files.toLocaleString("en-US")} files`)
    expect(today).toMatch(/· [\d,]+ in town ·/)
    const early = growthLine(c, c.start + 30)
    const n = (s: string) => Number(s.replace(/,/g, ""))
    expect(n(early.split(" ")[0] ?? "")).toBeLessThan(c.repo.contributors)
  })
})

describe("the director's skip", () => {
  const events = [{ at: 0 }, { at: 1000 }, { at: 30_000 }, { at: 31_000 }]
  test("inside the action the replay runs at its pace", () => {
    expect(quietSkip(events, 500)).toBe(1)
    // just after an event, and just before the next
    expect(quietSkip(events, 1200)).toBe(1)
    expect(quietSkip(events, 30_000 - QUIET_AHEAD_MS + 100)).toBe(1)
  })

  test("a long quiet stretch runs faster the longer the wait, at most SKIP_MAX; the end does not", () => {
    const mid = quietSkip(events, 5000)
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThanOrEqual(SKIP_MAX)
    expect(quietSkip(events, 3000)).toBeGreaterThanOrEqual(mid)
    expect(quietSkip(events, 40_000)).toBe(1)
  })
})

describe("a told story's acts as hours", () => {
  test("dawn to night across the acts", () => {
    expect(storyHour(0, 5)).toBeCloseTo(6.5)
    expect(storyHour(4, 5)).toBeCloseTo(20.5)
    expect(storyHour(2, 5)).toBeGreaterThan(storyHour(1, 5))
    expect(storyHour(9, 5)).toBeCloseTo(20.5)
  })
})
