import { describe, expect, test } from "bun:test"
import { applyAll, emptyModel } from "@guildhall/core"
import { seas } from "../src/index.ts"
import { RELEASE_TAIL_MS } from "../src/seas.ts"

describe("seas: a party with GitHub beside it", () => {
  const { changes, sea } = seas()

  test("same seed, same story", () => {
    expect(seas(3)).toEqual(seas(3))
  })

  test("the party finishes, like any other run", () => {
    const model = applyAll(emptyModel(), changes)
    expect([...model.sessions.values()].every((s) => s.status === "done")).toBe(true)
  })

  test("pushes, a PR opened then merged, CI red then green, a release last", () => {
    const kinds = sea.map((e) => (e.kind === "ci" ? `ci:${e.state}` : e.kind))
    const first = (kind: string) => kinds.indexOf(kind)
    expect(kinds.filter((k) => k === "push").length).toBeGreaterThanOrEqual(2)
    expect(first("pr_opened")).toBeLessThan(first("pr_merged"))
    expect(first("ci:failed")).toBeLessThan(first("ci:passed"))
    expect(first("ci:passed")).toBeLessThan(first("pr_merged"))
    expect(kinds.at(-1)).toBe("release")
  })

  test("each push follows a passing test run, and the sea stays within the run", () => {
    const tests = changes.filter(
      (c) => c.type === "tool" && c.state === "completed" && c.summary?.endsWith("pass"),
    )
    for (const push of sea.filter((e) => e.kind === "push" && e.branch !== "main"))
      expect(tests.some((t) => t.at <= push.at)).toBe(true)
    const end = changes.at(-1)!.at
    for (const event of sea) expect(event.at).toBeLessThanOrEqual(end)
    for (let i = 1; i < sea.length; i++) expect(sea[i]!.at).toBeGreaterThanOrEqual(sea[i - 1]!.at)
  })

  test("the story runs on after its release, long enough to see it arrive", () => {
    const release = sea.find((e) => e.kind === "release")
    const end = changes.at(-1)?.at ?? 0
    expect(release).toBeDefined()
    expect(end - (release?.at ?? end)).toBeGreaterThanOrEqual(RELEASE_TAIL_MS)
  })

  test("every id is unique (a hall dedupes on it)", () => {
    expect(new Set(sea.map((e) => e.id)).size).toBe(sea.length)
  })

  test("the repo's open work: pull requests in every status, one closed unmerged", () => {
    const opened = sea.flatMap((e) => (e.kind === "pr_opened" ? [e] : []))
    expect([...new Set(opened.map((e) => e.status))].sort()).toEqual(["draft", "open", "ready", "review"])
    expect(opened.every((e) => typeof e.size === "number")).toBe(true)
    expect(sea.filter((e) => e.kind === "pr_closed")).toHaveLength(1)
  })

  test("more issues are open than the queue seats, and the merge closes the contrast bug", () => {
    const closed = new Set(sea.flatMap((e) => (e.kind === "issue_closed" ? [e.number] : [])))
    const open = sea.flatMap((e) => (e.kind === "issue_opened" && !closed.has(e.number) ? [e] : []))
    expect(open.length).toBeGreaterThan(10)
    expect(open.some((e) => e.labels?.includes("bug"))).toBe(true)
    const merge = sea.find((e) => e.kind === "pr_merged")
    const fixed = sea.find((e) => e.kind === "issue_closed" && e.number === 141)
    expect(fixed?.at).toBeGreaterThan(merge?.at ?? Number.POSITIVE_INFINITY)
  })
})
