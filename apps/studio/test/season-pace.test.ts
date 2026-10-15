import { describe, expect, test } from "bun:test"
import { playingSeasonDate } from "../src/hall/seasonPace.ts"

const DAY = 86_400_000
const range = {
  start: 0,
  end: 3650 * DAY,
  markers: [
    { at: 1000 * DAY, kind: "era" },
    { at: 1500 * DAY, kind: "release" },
    { at: 2500 * DAY, kind: "era" },
  ],
}

describe("a playing history keeps one season per chapter", () => {
  test("every day of a chapter shows the season of the chapter's last day", () => {
    expect(playingSeasonDate(10 * DAY, range)).toBe(1000 * DAY)
    expect(playingSeasonDate(999 * DAY, range)).toBe(1000 * DAY)
    expect(playingSeasonDate(1000 * DAY, range)).toBe(2500 * DAY)
    expect(playingSeasonDate(2000 * DAY, range)).toBe(2500 * DAY)
  })

  test("the last chapter runs to the history's end; releases do not split chapters", () => {
    expect(playingSeasonDate(3000 * DAY, range)).toBe(3650 * DAY)
    expect(playingSeasonDate(1600 * DAY, range)).toBe(2500 * DAY)
  })

  test("a history with no eras is one chapter", () => {
    expect(playingSeasonDate(5 * DAY, { start: 0, end: 100 * DAY, markers: [] })).toBe(100 * DAY)
  })
})
