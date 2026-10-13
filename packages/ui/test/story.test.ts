import { describe, expect, test } from "bun:test"
import {
  altOf,
  badgeMarkdown,
  cardFileName,
  clockOf,
  contrast,
  costOf,
  duration,
  islandLink,
  type RecapView,
  readable,
  spell,
  tokensOf,
  wrapRuns,
} from "../src/index.ts"

// The drawing tests from V1 (main:packages/hall/test/recap.test.ts "drawing").
describe("the card's layout", () => {
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
    expect(readable("#e0702f")).toBe("#e0702f")
  })

  test("the file name is the sim's slug", () => {
    expect(
      cardFileName({ guild: "facebook/react", title: "Add cursor pagination to GET /users" }, "landscape"),
    ).toBe("guildhall-chronicle-facebook-react-add-cursor-pagination-to-get-users.png")
    expect(cardFileName({ guild: "", title: "!!" }, "portrait")).toBe(
      "guildhall-chronicle-session-portrait.png",
    )
  })

  test("the preview's alt text says everything the picture does", () => {
    const recap: RecapView = {
      title: "Add cursor pagination",
      guild: "Codestz/guildhall",
      story: "A party",
      outcome: "complete",
      numbers: [{ value: "6", label: "adventurers" }],
      lines: [
        {
          at: 1,
          kind: "complete",
          parts: [{ text: "The quest is complete." }],
          text: "The quest is complete.",
        },
      ],
      hero: { label: "The quest is done", at: 61_000 },
    }
    expect(altOf(recap, "portrait")).toBe(
      "Portrait Chronicle card: “Add cursor pagination”, Codestz/guildhall, A party. Pictured: The quest is done. 6 adventurers. The quest is complete.",
    )
  })

  test("a repo's card: named by the repo alone, its own line under the title", () => {
    const recap: RecapView = {
      kind: "repo",
      title: "react/react",
      guild: "react/react",
      story: "Since May 2013 · 13 years",
      subtitle: "Since May 2013 · 13 years",
      outcome: "underway",
      numbers: [{ value: "19.1k", label: "commits" }],
      lines: [{ at: 1, kind: "busiest", parts: [{ text: "April 2019 was its busiest month." }], text: "" }],
      hero: { label: "The island today", at: 0, mark: "7,252 files" },
      site: "guildhall.codestz.dev/hall/react/react",
    }
    expect(cardFileName(recap, "landscape")).toBe("guildhall-chronicle-react-react.png")
    expect(cardFileName(recap, "portrait")).toBe("guildhall-chronicle-react-react-portrait.png")
    expect(altOf({ ...recap, lines: [] }, "landscape")).toBe(
      "Landscape Chronicle card: “react/react”, Since May 2013 · 13 years. Pictured: The island today. 19.1k commits. ",
    )
  })
})

describe("the book's words read as the sim's Markdown", () => {
  test("V1's numbers", () => {
    expect(duration(42_000)).toBe("42s")
    expect(duration(185_000)).toBe("3m 05s")
    expect(clockOf(61_400)).toBe("1:01")
    expect(tokensOf(840)).toBe("840 tokens")
    expect(tokensOf(12_400)).toBe("12.4k tokens")
    expect(tokensOf(9_894_000)).toBe("9894k tokens")
    expect(costOf(0.4831)).toBe("$0.483")
    expect(costOf(6.4)).toBe("$6.40")
    expect(spell(3)).toBe("three")
    expect(spell(16)).toBe("16")
  })
})

describe("the README badge", () => {
  test("a shields badge that links to the island", () => {
    expect(islandLink("Codestz/guildhall")).toBe("https://guildhall.codestz.dev/hall/Codestz/guildhall")
    expect(badgeMarkdown("Codestz/guildhall")).toBe(
      "[![See Codestz/guildhall as an island in Guildhall](https://img.shields.io/badge/Guildhall-see_it_as_an_island-dcb662?labelColor=15110d)](https://guildhall.codestz.dev/hall/Codestz/guildhall)",
    )
  })

  test("a strange name cannot break out of the link", () => {
    const md = badgeMarkdown("a]b/c d", "https://example.test/")
    expect(md).toContain("See a\\]b/c d as an island")
    expect(md).toContain("(https://example.test/hall/a%5Db/c%20d)")
  })
})
