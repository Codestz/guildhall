import { describe, expect, test } from "bun:test"
import { balanceBreak, captionLines, splitParts, wordsOf } from "../src/index.ts"

/** A monospace measure: 10 px a letter. */
const mono = (w: { pieces: readonly { text: string }[] }) =>
  w.pieces.reduce((n, p) => n + p.text.length * 10, 0)
const text = (lines: { text: string }[][]) => lines.map((l) => l.map((p) => p.text).join(""))

describe("wordsOf", () => {
  test("words run across parts: a name and its comma are one word", () => {
    const words = wordsOf([{ text: "In the " }, { text: "Search bug", color: "#fff" }, { text: " quest, " }])
    expect(words.map((w) => w.pieces.map((p) => p.text).join(""))).toEqual([
      "In",
      "the",
      "Search",
      "bug",
      "quest,",
    ])
    expect(words[2]?.pieces[0]?.part).toBe(1)
  })
})

describe("balanceBreak", () => {
  test("a line that fits stays one line", () => {
    expect(balanceBreak([50, 50, 50], 10, 170)).toBe(0)
  })

  test("a long line breaks where its two lines are nearest equal", () => {
    // 4 words of 100 and a space of 10: 430 wide; halves of 210 and 210
    expect(balanceBreak([100, 100, 100, 100], 10, 300)).toBe(2)
  })

  test("the first line's lead (the diamond) counts against it", () => {
    // without a lead [60 | 60 60] would tie toward the earlier; a 60 lead pushes the break later
    expect(balanceBreak([60, 60, 60], 0, 150, 0)).toBe(1)
    expect(balanceBreak([60, 60, 60], 0, 150, 60)).toBe(1)
    expect(balanceBreak([20, 20, 20, 20, 20, 20], 0, 100, 40)).toBe(2)
  })

  test("the first line never runs past the room", () => {
    const k = balanceBreak([300, 20, 20, 20], 10, 320)
    expect(k).toBe(1)
  })

  test("a word wider than the room still breaks after itself (the row cuts)", () => {
    expect(balanceBreak([500, 20], 10, 200)).toBe(1)
  })
})

describe("captionLines", () => {
  test("V1's line splits into two balanced rows, names kept whole", () => {
    const parts = [
      { text: "In the " },
      { text: "Search bug", color: "#d4ad3a" },
      { text: " quest, " },
      { text: "the Warden", color: "#3fae6b" },
      { text: " runs gh run view --log-failed — 1 failing job and pores over ci.yml." },
    ]
    const lines = captionLines(parts, mono, 10, 576)
    expect(lines).toHaveLength(2)
    const [a, b] = text(lines)
    expect(`${a} ${b}`).toBe(parts.map((p) => p.text).join(""))
    expect(Math.abs((a?.length ?? 0) - (b?.length ?? 0))).toBeLessThan(12)
    // the coloured parts keep their colour on whichever row they land
    expect(
      lines
        .flat()
        .filter((p) => "color" in p && p.color)
        .map((p) => p.text),
    ).toEqual(["Search bug", "the Warden"])
  })

  test("a short line is one row, as it came", () => {
    const parts = [{ text: "The Scout returns." }]
    expect(captionLines(parts, mono, 10, 576)).toEqual([parts])
  })
})

describe("splitParts", () => {
  test("splits inside a part and drops the space", () => {
    expect(splitParts([{ text: "ab cd" }, { text: " ef" }], 2)).toEqual([
      [{ text: "ab" }],
      [{ text: "cd" }, { text: " ef" }],
    ])
  })

  test("splits at a part's edge", () => {
    expect(splitParts([{ text: "ab" }, { text: " cd" }], 2)).toEqual([[{ text: "ab" }], [{ text: "cd" }]])
  })
})
