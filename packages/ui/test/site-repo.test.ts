import { describe, expect, test } from "bun:test"
import { parseRepo, readWelcomeDismissed, WELCOME_KEY, writeWelcomeDismissed } from "../src/site/repo.ts"

describe("parseRepo", () => {
  test.each([
    ["facebook/react", "facebook/react"],
    ["  Codestz/guildhall  ", "Codestz/guildhall"],
    ["https://github.com/facebook/react", "facebook/react"],
    ["http://www.github.com/facebook/react/", "facebook/react"],
    ["github.com/facebook/react", "facebook/react"],
    ["https://github.com/facebook/react.git", "facebook/react"],
    ["git@github.com:facebook/react.git", "facebook/react"],
    ["https://github.com/facebook/react/tree/main/packages?tab=readme#top", "facebook/react"],
    ["vercel/next.js", "vercel/next.js"],
  ])("accepts %s", (input, slug) => {
    const r = parseRepo(input)
    expect(r.ok && r.slug).toBe(slug)
  })

  test.each([
    "",
    "   ",
    "react",
    "facebook/",
    "/react",
    "-bad/react",
    "bad-/react",
    "has space/react",
    "facebook/re act",
    "facebook/..",
    "https://gitlab.com/facebook/react",
    "ftp://github.com/facebook/react",
  ])("rejects %j with a reason", (input) => {
    const r = parseRepo(input)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason.length).toBeGreaterThan(0)
  })

  test("owner names are at most 39 characters", () => {
    expect(parseRepo(`${"a".repeat(39)}/x`).ok).toBe(true)
    expect(parseRepo(`${"a".repeat(40)}/x`).ok).toBe(false)
  })
})

describe("remembered dismissal", () => {
  test("round-trips through a storage", () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
    expect(readWelcomeDismissed(storage)).toBe(false)
    writeWelcomeDismissed(storage)
    expect(data.get(WELCOME_KEY)).toBe("1")
    expect(readWelcomeDismissed(storage)).toBe(true)
  })

  test("blocked storage never throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    }
    expect(readWelcomeDismissed(blocked)).toBe(false)
    expect(() => writeWelcomeDismissed(blocked)).not.toThrow()
  })
})
