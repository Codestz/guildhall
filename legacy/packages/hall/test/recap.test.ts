import { describe, expect, test } from "bun:test"
import { parseDeepLink } from "../src/guild/deeplink.ts"
import { legendOf } from "../src/guild/legends.ts"
import {
  compactOf,
  fileNameOf,
  heroOf,
  type Recap,
  recapOf,
  recapQuery,
  sentenceCase,
} from "../src/guild/recap.ts"
import { GuildStore, type ScenarioId } from "../src/guild/store.ts"
import { contrast, readable, wrapRuns } from "../src/hud/RecapDraw.ts"

/** A story played to its end (paused there), and the recap of its focal party. */
function recapAtEnd(scenario: ScenarioId): { store: GuildStore; recap: Recap } {
  const store = new GuildStore()
  store.load(scenario)
  store.seek(store.duration - 1)
  const sessions = store.party()
  const legend = legendOf(store.moments.history, sessions)
  if (!legend) throw new Error(`${scenario}: no legend`)
  const recap = recapOf({
    legend,
    history: store.moments.history,
    sessions,
    lookup: { session: (id) => store.sessionOf(id) },
    guild: "acme/shop",
    story: scenario,
  })
  return { store, recap }
}

describe("the hero", () => {
  test("the seas: the release's galleon, though the director weighs sea moments 0", () => {
    const { recap } = recapAtEnd("seas")
    expect(recap.hero?.subject).toEqual({ kind: "sea", moment: "sea-release" })
    expect(recap.hero?.label).toContain("galleon")
    // Filmed after the galleon has anchored, on a whole second (a link's `t` is mm:ss).
    expect(recap.hero?.shot ?? 0).toBeGreaterThan(recap.hero?.at ?? 0)
    expect((recap.hero?.shot ?? 1) % 1000).toBe(0)
  })

  test("a party without a sea: an adventurer bringing something home", () => {
    const { recap } = recapAtEnd("party")
    expect(recap.hero?.subject.kind).toBe("adventurer")
  })

  test("a red then green outranks a plain loot; a plea never is the hero", () => {
    const base = { agent: "", title: "Implementer", color: "#e0702f", master: "m", seq: 1, live: false }
    const ci = (state: "failed" | "passed") =>
      ({ kind: "ci", repo: "a/b", branch: "main", name: "CI", state, at: 0, guild: "g" }) as never
    const told = [
      { ...base, id: "a", parent: "m", kind: "plea", at: 1000 },
      { ...base, id: "sea", kind: "sea-red", event: ci("failed"), at: 2000 },
      { ...base, id: "a", parent: "m", kind: "loot", at: 3000 },
      { ...base, id: "sea", kind: "sea-green", event: ci("passed"), at: 4000 },
    ] as never
    expect(heroOf(told, [])?.subject).toEqual({ kind: "sea", moment: "sea-green" })
    expect(heroOf([told[0]] as never, [])).toBeUndefined()
  })

  test("the same recap after a seek as after playing through", () => {
    const played = recapAtEnd("seas").recap
    const store = new GuildStore()
    store.load("seas")
    store.seek(30_000)
    store.seek(store.duration - 1)
    const sessions = store.party()
    const legend = legendOf(store.moments.history, sessions)
    if (!legend) throw new Error("no legend")
    const sought = recapOf({
      legend,
      history: store.moments.history,
      sessions,
      lookup: { session: (id) => store.sessionOf(id) },
      guild: "acme/shop",
      story: "seas",
    })
    expect(sought).toEqual(played)
  })
})

describe("the numbers and lines", () => {
  test("tokens read at a glance: 9.9M, not 9894k", () => {
    expect(compactOf(950)).toBe("950")
    expect(compactOf(96_800)).toBe("96.8k")
    expect(compactOf(136_000)).toBe("136k")
    expect(compactOf(9_894_000)).toBe("9.9M")
    expect(compactOf(2_000_000)).toBe("2M")
    const { recap } = recapAtEnd("saga")
    expect(recap.numbers.find((n) => n.label === "tokens")?.value).toMatch(/^\d+(\.\d)?M$/)
  })

  test("three lines, in story order, never a plea", () => {
    for (const scenario of ["saga", "seas", "party", "factions"] as const) {
      const { recap } = recapAtEnd(scenario)
      expect(recap.lines.length).toBe(3)
      expect(recap.lines.map((l) => l.at)).toEqual([...recap.lines.map((l) => l.at)].sort((a, b) => a - b))
      for (const line of recap.lines) {
        expect(line.kind).not.toBe("plea")
        expect(line.text).not.toMatch(/your word/)
      }
    }
  })

  test("a name opening a sentence takes its capital", () => {
    const parts = sentenceCase([
      { text: "The quest is complete. " },
      { text: "the Guildmaster", color: "#d4ad3a" },
      { text: " has the last word: " },
      { text: "the Verifier", color: "#5b9" },
    ])
    expect(parts.map((p) => p.text).join("")).toBe(
      "The quest is complete. The Guildmaster has the last word: the Verifier",
    )
    expect(parts[1]?.color).toBe("#d4ad3a")
  })
})

describe("the link", () => {
  test("every link parses back whole: nothing ignored", () => {
    const queries = [
      recapQuery({
        story: "seas",
        t: 108_000,
        hour: 20.27,
        weather: "clear",
        view: "diorama",
        look: { x: 24, z: 101 },
      }),
      recapQuery({
        story: "party",
        repo: "facebook/react",
        t: 61_400,
        hour: 9,
        weather: "cloudy",
        look: { x: -3.4, z: 2.6 },
      }),
      recapQuery({ story: "rush", n: 40, t: 5000, select: "Implementer II" }),
      recapQuery({ hour: 12, weather: "storm", look: { x: 1, z: 2 } }), // live: no story, no seek
    ]
    for (const q of queries) expect(parseDeepLink(q, false).ignored).toEqual([])
    const { link } = parseDeepLink(queries[0] as string, false)
    expect(link).toMatchObject({ story: "seas", t: 108_000, paused: true, bard: false, weather: "clear" })
    expect(link.look).toMatchObject({ x: 24, z: 101 })
    expect(parseDeepLink(queries[1] as string, false).link.repo).toBe("facebook/react")
    expect(queries[3]).not.toContain("paused")
  })

  test("the file name is a slug", () => {
    expect(
      fileNameOf({ guild: "facebook/react", title: "Add cursor pagination to GET /users" }, "landscape"),
    ).toBe("guildhall-chronicle-facebook-react-add-cursor-pagination-to-get-users.png")
    expect(fileNameOf({ guild: "", title: "!!" }, "portrait")).toBe(
      "guildhall-chronicle-session-portrait.png",
    )
  })
})

describe("drawing", () => {
  /** A monospace measure: 10 px a character. */
  const measure = (text: string) => text.length * 10

  test("wraps by words, keeping each name's colour", () => {
    const lines = wrapRuns(
      [
        { text: "The " },
        { text: "Implementer II", color: "#e0702f" },
        { text: " rises again and takes up the work." },
      ],
      measure,
      200,
      3,
    )
    for (const line of lines) expect(measure(line.map((r) => r.text).join(""))).toBeLessThanOrEqual(200)
    expect(lines.flat().find((r) => r.color)?.text).toContain("Implementer")
    expect(lines.map((l) => l.map((r) => r.text).join("")).join(" ")).toBe(
      "The Implementer II rises again and takes up the work.",
    )
  })

  test("too long: cut at the last line with an ellipsis", () => {
    const lines = wrapRuns([{ text: "word ".repeat(40) }], measure, 100, 2)
    expect(lines.length).toBe(2)
    const last = lines[1]?.map((r) => r.text).join("") ?? ""
    expect(last.endsWith("…")).toBe(true)
    expect(measure(last)).toBeLessThanOrEqual(100)
  })

  test("role colours are lifted to 4.5:1 on the card's ink", () => {
    for (const color of ["#2a2a6a", "#7a5cff", "#e0702f", "#d4ad3a", "#333333"])
      expect(contrast(readable(color), "#15110d")).toBeGreaterThanOrEqual(4.5)
    expect(readable("#e0702f")).toBe("#e0702f") // already readable: untouched
  })
})
