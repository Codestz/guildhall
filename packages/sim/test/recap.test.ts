// From V1 (main:packages/hall/test/recap.test.ts). The deep-link test went with `recapQuery` (V1's
// URL vocabulary; the V2 hall's link comes with H1); the drawing tests are @guildhall/ui's.
import { describe, expect, test } from "bun:test"
import { compactOf, fileNameOf, heroOf, sentenceCase } from "../src/index.ts"
import { bookOf } from "./story-fixtures.ts"

describe("the hero", () => {
  test("the seas: the release's galleon, though the director weighs sea moments 0", async () => {
    const { recap } = await bookOf("seas")
    expect(recap.hero?.subject).toEqual({ kind: "sea", moment: "sea-release" })
    expect(recap.hero?.label).toContain("galleon")
    // Filmed after the galleon has anchored, on a whole second (a link's `t` is mm:ss).
    expect(recap.hero?.shot ?? 0).toBeGreaterThan(recap.hero?.at ?? 0)
    expect((recap.hero?.shot ?? 1) % 1000).toBe(0)
  })

  test("a party without a sea: an adventurer bringing something home", async () => {
    const { recap } = await bookOf("party")
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
    expect(heroOf([(told as never[])[0]] as never, [])).toBeUndefined()
  })
})

describe("the numbers and lines", () => {
  test("tokens read at a glance: 9.9M, not 9894k", async () => {
    expect(compactOf(950)).toBe("950")
    expect(compactOf(96_800)).toBe("96.8k")
    expect(compactOf(136_000)).toBe("136k")
    expect(compactOf(9_894_000)).toBe("9.9M")
    expect(compactOf(2_000_000)).toBe("2M")
    const { recap } = await bookOf("saga")
    expect(recap.numbers.find((n) => n.label === "tokens")?.value).toMatch(/^\d+(\.\d)?M$/)
  })

  test("three lines, in story order, never a plea", async () => {
    for (const name of ["saga", "seas", "party", "rush"] as const) {
      const { recap } = await bookOf(name)
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

describe("the file", () => {
  test("the file name is a slug", () => {
    expect(
      fileNameOf({ guild: "facebook/react", title: "Add cursor pagination to GET /users" }, "landscape"),
    ).toBe("guildhall-chronicle-facebook-react-add-cursor-pagination-to-get-users.png")
    expect(fileNameOf({ guild: "", title: "!!" }, "portrait")).toBe(
      "guildhall-chronicle-session-portrait.png",
    )
  })
})
