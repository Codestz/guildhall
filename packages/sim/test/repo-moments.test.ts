import { describe, expect, test } from "bun:test"
import {
  type Chronicle,
  DAY_MS,
  type HistoryMoment,
  historyMomentsOf,
  isoOf,
  type MomentEra,
  notableHands,
  repoLegendOf,
} from "../src/index.ts"
import { chronicle } from "./repo-fixtures.ts"

/**
 * The history's moments (story/repo/moments.ts) on V1's bundled chronicles: what the hall narrates while
 * the island grows. react's thirteen years and Guildhall's first three days.
 */

const erasOf = (c: Chronicle): MomentEra[] =>
  repoLegendOf(c).eras.map((e) => ({
    from: Math.floor(e.begin / DAY_MS),
    numeral: e.numeral,
    title: e.title.replace(/`/g, ""),
    span: e.span,
    ...(e.release ? { release: e.release } : {}),
  }))

const find = (ms: readonly HistoryMoment[], id: string) => ms.find((m) => m.id === id)

describe("react's moments", async () => {
  const c = await chronicle("react")
  const moments = historyMomentsOf(c, {
    eras: erasOf(c),
    placeOf: (u) => (u === "packages/react-dom" ? "the village of react-dom" : undefined),
  })

  test("the first commit founds the island, by its author, on the first day", () => {
    const m = find(moments, "founded")
    expect(m?.day).toBe(c.start)
    expect(m?.text).toBe("Ben Newman makes the first commit: the island of react is founded")
    expect(m?.parts[0]).toEqual({ text: "Ben Newman", color: expect.any(String) })
    expect(m?.weight).toBe(100)
  })

  test("notable hands arrive on their first commit; no bots, nobody from the first day", () => {
    const dan = moments.find((m) => m.kind === "arrival" && m.who === "Dan Abramov")
    expect(dan && isoOf(dan.day)).toBe("2014-05-25")
    expect(dan?.text).toBe("Dan Abramov arrives: the first of 1,601 commits")
    const arrivals = moments.filter((m) => m.kind === "arrival")
    expect(arrivals.length).toBeGreaterThan(10)
    expect(arrivals.length).toBeLessThanOrEqual(24)
    for (const m of arrivals) {
      expect(m.day).toBeGreaterThan(c.start)
      expect(m.who).not.toMatch(/bot|script/i)
    }
    // the busiest hand on the first day (Paul O'Shannessy) is the founding's, not an arrival
    expect(notableHands(c).some((p) => p.first === c.start)).toBe(false)
  })

  test("places are founded on their unit's birth, named as the island built them", () => {
    const dom = find(moments, "place:packages/react-dom")
    expect(dom && isoOf(dom.day)).toBe("2015-06-17")
    expect(dom?.text).toBe("packages/react-dom is founded: the village of react-dom rises")
    expect(dom?.unit).toBe("packages/react-dom")
    const compiler = find(moments, "place:compiler")
    expect(compiler && isoOf(compiler.day)).toBe("2024-05-15")
    expect(compiler?.text).toContain("a new place rises from the sea")
    // renamed into is no founding
    expect(find(moments, "place:packages/react-codemod")).toBeUndefined()
    // the root, the pools and dot folders are no places
    expect(moments.some((m) => m.unit === "/" || m.unit?.endsWith("*") || m.unit?.startsWith("."))).toBe(
      false,
    )
  })

  test("the eras open as acts, each major its era's tagline; the first release sets sail", () => {
    const eras = moments.filter((m) => m.kind === "era")
    expect(eras.map((m) => m.chapter?.title)).toEqual([
      "The First Stones",
      "The Age of v15",
      "The Old Ground Cleared",
      "The Age of v17",
      "The Rise of compiler",
      "The Age of v19",
    ])
    // the first opens with the founding, which tells it
    expect(eras[0]?.weight).toBe(0)
    expect(eras[1]?.chapter).toEqual({
      act: "Chapter II",
      title: "The Age of v15",
      tagline: "v15.0.0 sets sail · April 2016 – September 2017",
    })
    // a major that opens an era is told by it, not twice
    expect(find(moments, "release:v15.0.0")).toBeUndefined()
    expect(find(moments, "release:v0.3.0")?.text).toBe(
      "v0.3.0, the first release, sets sail from the harbour",
    )
  })

  test("the island passes round sizes, the guild round numbers, and the old ground is cleared", () => {
    const files = moments.filter((m) => m.id.startsWith("files:")).map((m) => m.id)
    expect(files).toEqual(["files:1000", "files:2500", "files:5000"])
    expect(moments.some((m) => m.id === "hands:1000")).toBe(true)
    expect(find(moments, "gone:docs")?.text).toBe("docs is cleared away: its land sinks back into the sea")
    expect(find(moments, "reshaped:" + (find(moments, "place:compiler")?.day ?? 0))?.text).toBe(
      "A single commit reshapes 3,669 files",
    )
  })

  test("oldest first, an era's heading before its day's moments, every day inside the history", () => {
    for (let i = 1; i < moments.length; i++)
      expect((moments[i] as HistoryMoment).day).toBeGreaterThanOrEqual((moments[i - 1] as HistoryMoment).day)
    expect(moments[0]?.kind).toBe("era")
    expect(moments[1]?.id).toBe("founded")
    for (const m of moments) {
      expect(m.day).toBeGreaterThanOrEqual(c.start)
      expect(m.day).toBeLessThanOrEqual(c.end)
      // a line's parts say its text (a title card's are its three lines)
      if (!m.chapter) expect(m.parts.map((p) => p.text).join("")).toBe(m.text)
    }
    expect(new Set(moments.map((m) => m.id)).size).toBe(moments.length)
  })

  test("deterministic", () => {
    expect(historyMomentsOf(c, { eras: erasOf(c) })).toEqual(historyMomentsOf(c, { eras: erasOf(c) }))
  })
})

describe("guildhall's moments", async () => {
  const c = await chronicle("guildhall")
  const moments = historyMomentsOf(c, { eras: erasOf(c) })

  test("its founder, its one late place, its first release, its days as chapters", () => {
    expect(find(moments, "founded")?.text).toBe(
      "Codestz makes the first commit: the island of guildhall is founded",
    )
    expect(find(moments, "place:packages/claude-code")?.day).toBe(c.end)
    expect(find(moments, "release:v0.1.0")?.day).toBe(c.end)
    expect(moments.filter((m) => m.kind === "era").map((m) => m.chapter?.title)).toEqual([
      "The First Stones",
      "The Second Day",
      "The First Galleon",
    ])
    // one hand: nobody arrives, no round numbers of hands
    expect(moments.some((m) => m.kind === "arrival" || m.id.startsWith("hands:"))).toBe(false)
  })
})
