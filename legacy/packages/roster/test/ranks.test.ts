import { describe, expect, test } from "bun:test"
import { COMMIT_FLOOR, commitRank } from "../src/index.ts"

describe("a repo's contributors rank by commits", () => {
  test("the bars follow the repo's own spread: top 10% masters, top 40% journeymen", () => {
    const commits = Array.from({ length: 100 }, (_, i) => (i + 1) * 10) // 10 … 1000
    const rank = commitRank(commits)
    expect(rank(1000)).toBe("master")
    expect(rank(910)).toBe("master")
    expect(rank(900)).toBe("journeyman")
    expect(rank(610)).toBe("journeyman")
    expect(rank(600)).toBe("apprentice")
  })

  test("a small repo's bars never drop under the floors", () => {
    const rank = commitRank([3, 5, 20])
    expect(rank(20)).toBe("journeyman")
    expect(rank(COMMIT_FLOOR.master - 1)).toBe("journeyman")
    expect(rank(COMMIT_FLOOR.master)).toBe("master")
    expect(rank(COMMIT_FLOOR.journeyman - 1)).toBe("apprentice")
  })

  test("no contributors: only the floors", () => {
    const rank = commitRank([])
    expect(rank(0)).toBe("apprentice")
    expect(rank(COMMIT_FLOOR.journeyman)).toBe("journeyman")
  })
})
