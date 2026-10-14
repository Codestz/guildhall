import { describe, expect, test } from "bun:test"
import {
  clock,
  cost,
  count,
  day,
  month,
  phaseOf,
  pickToasts,
  span,
  ticks,
  tokens,
} from "../src/hud/format.ts"
import type { ChronicleEntry } from "../src/hud/types.ts"

describe("numbers", () => {
  test("clock: m:ss, then h:mm:ss past an hour; never negative", () => {
    expect(clock(0)).toBe("0:00")
    expect(clock(38_900)).toBe("0:38")
    expect(clock(67_000)).toBe("1:07")
    expect(clock(3_725_000)).toBe("1:02:05")
    expect(clock(-5000)).toBe("0:00")
  })

  test("span: seconds, minutes with padded seconds, hours with padded minutes", () => {
    expect(span(7_400)).toBe("7s")
    expect(span(185_000)).toBe("3m 05s")
    expect(span(3_840_000)).toBe("1h 04m")
  })

  test("tokens and cost read compactly", () => {
    expect(tokens(840)).toBe("840")
    expect(tokens(12_340)).toBe("12.3k")
    expect(tokens(312_400)).toBe("312k")
    expect(tokens(1_240_000)).toBe("1.2M")
    expect(cost(0)).toBe("$0")
    expect(cost(0.0204)).toBe("$0.020")
    expect(cost(1.3)).toBe("$1.30")
  })

  test("count picks the noun", () => {
    expect(count(1, "hero", "heroes")).toBe("1 hero")
    expect(count(3, "hero", "heroes")).toBe("3 heroes")
    expect(count(2, "plea")).toBe("2 pleas")
  })
})

describe("phaseOf", () => {
  test("every phase has a word and a tone", () => {
    expect(phaseOf("waiting")).toEqual({ label: "Plea", tone: "plea" })
    expect(phaseOf("failed")).toEqual({ label: "In the infirmary", tone: "fail" })
    expect(phaseOf("loot").tone).toBe("loot")
  })

  test("an unknown phase still renders, as its own name, quietly", () => {
    expect(phaseOf("scouting")).toEqual({ label: "Scouting", tone: "idle" })
  })
})

describe("history dates", () => {
  test("read in UTC, so a repo's history is the same in every zone", () => {
    expect(day(Date.UTC(2021, 2, 14, 23, 30))).toBe("14 Mar 2021")
    expect(month(Date.UTC(2019, 11, 31))).toBe("Dec 2019")
  })
})

describe("ticks", () => {
  test("history: one per year inside the range, never at its ends", () => {
    const t = ticks("history", Date.UTC(2019, 5, 1), Date.UTC(2023, 2, 1))
    expect(t.map((x) => x.label)).toEqual(["2020", "2021", "2022", "2023"])
    for (const x of t) expect(x.p > 0 && x.p < 1).toBe(true)
    expect(t[0]!.p).toBeLessThan(t[1]!.p)
  })

  test("history: a long range steps by 2, 5 or 10 years so at most `max` labels show", () => {
    const t = ticks("history", Date.UTC(1990, 0, 15), Date.UTC(2026, 0, 1), 6)
    expect(t.length).toBeLessThanOrEqual(6)
    expect(t.map((x) => x.label)).toEqual(["2000", "2010", "2020"])
  })

  test("session: whole minutes, stepped to fit", () => {
    expect(ticks("session", 0, 4.5 * 60_000).map((x) => x.label)).toEqual(["1m", "2m", "3m", "4m"])
    const long = ticks("session", 0, 67 * 60_000, 6)
    expect(long.length).toBeLessThanOrEqual(6)
    expect(long.map((x) => x.label)).toEqual(["10m", "20m", "30m", "40m", "50m", "60m"])
  })

  test("an empty or reversed range has no ticks", () => {
    expect(ticks("session", 10, 10)).toEqual([])
    expect(ticks("history", 10, 0)).toEqual([])
  })
})

describe("pickToasts", () => {
  const entry = (key: string, kind: ChronicleEntry["kind"]): ChronicleEntry => ({
    key,
    at: 0,
    kind,
    who: "Warden",
    banner: "#3fae6b",
    text: "…",
  })
  const log = [
    entry("a", "join"),
    entry("b", "deed"),
    entry("c", "quest"),
    entry("d", "thought"),
    entry("e", "plea"),
  ]

  test("only moments that earn a toast, newest three, oldest first", () => {
    const seen = new Map<string, number>()
    expect(pickToasts(log, 1000, seen).map((t) => t.key)).toEqual(["a", "c", "e"])
    expect(pickToasts([...log, entry("f", "loot")], 1000, seen).map((t) => t.key)).toEqual(["c", "e", "f"])
  })

  test("each keeps its own life from when it was first shown, and leaves when it runs out", () => {
    const seen = new Map<string, number>()
    pickToasts(log, 0, seen)
    // join lives 5 s, quest 6 s, plea 11 s
    const later = pickToasts(log, 5500, seen)
    expect(later.map((t) => t.key)).toEqual(["c", "e"])
    expect(later[0]!.left).toBe(500)
    expect(pickToasts(log, 20_000, seen)).toEqual([])
  })

  test("a cap shortens every life (a short screen folds a toast into the chip after 4 s)", () => {
    const seen = new Map<string, number>()
    expect(pickToasts(log, 0, seen, 3, 4000).map((t) => t.key)).toEqual(["a", "c", "e"])
    expect(pickToasts(log, 3000, seen, 3, 4000).map((t) => t.left)).toEqual([1000, 1000, 1000])
    expect(pickToasts(log, 4500, seen, 3, 4000)).toEqual([])
  })
})
