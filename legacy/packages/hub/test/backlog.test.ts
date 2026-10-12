import { describe, expect, test } from "bun:test"
import type { PrStatus } from "@guildhall/core"
import { createGithub, issuesOf, POLL_MS, prStatus, pullsOf, standing, statusMoves } from "../src/github.ts"
import { fakeGithub, issue, pull, pullPage } from "./fixtures/github.ts"

/**
 * The repo's open work as the sea reads it (PROTOCOL.md §7): pull request status and size, issues,
 * and the baseline that announces what is still open. SYNTHESIZED payloads (fixtures/github.ts).
 */

const REPO = "acme/shop"
const T0 = Date.parse("2026-10-08T12:00:00Z")
const iso = (ms: number) => new Date(ms).toISOString()
const target = { repo: REPO, branches: ["main"] }
const quiet = () => {}

describe("a pull request's status, from the list's own fields", () => {
  test("draft, ready (auto-merge armed), review (reviewers asked), else open", () => {
    expect(prStatus(pull(1, iso(T0), { draft: true, reviewers: 2 }))).toBe("draft")
    expect(prStatus(pull(2, iso(T0), { autoMerge: true, reviewers: 1 }))).toBe("ready")
    expect(prStatus(pull(3, iso(T0), { reviewers: 1 }))).toBe("review")
    expect(prStatus(pull(4, iso(T0)))).toBe("open")
  })

  test("the opening carries it; a status that moves is announced once, not each time it is touched", () => {
    const known = new Map<number, PrStatus>()
    expect(statusMoves(REPO, [pull(5, iso(T0), { draft: true })], known)).toEqual([])
    const ready = [pull(5, iso(T0), { updated: iso(T0 + 5000) })]
    const moved = statusMoves(REPO, ready, known)
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ kind: "pr_updated", number: 5, status: "open", at: T0 + 5000 })
    // Touched again (a comment), same status: nothing.
    expect(statusMoves(REPO, [pull(5, iso(T0), { updated: iso(T0 + 9000) })], known)).toEqual([])
    expect(pullsOf(REPO, ready)[0]).toMatchObject({ kind: "pr_opened", status: "open" })
  })

  test("a pull request that closes is forgotten", () => {
    const known = new Map<number, PrStatus>([[6, "draft"]])
    statusMoves(REPO, [pull(6, iso(T0), { closed: iso(T0 + 1) })], known)
    expect(known.has(6)).toBe(false)
  })
})

describe("issues", () => {
  test("opened with their labels, closed once they are; pull requests the endpoint lists are skipped", () => {
    const events = issuesOf(REPO, [
      issue(10, iso(T0), { labels: ["bug", "p1"] }),
      issue(11, iso(T0), { closed: iso(T0 + 1000) }),
      issue(12, iso(T0), { pullRequest: true }),
    ])
    expect(events.map((e) => `${e.kind}#${"number" in e ? e.number : ""}`)).toEqual([
      "issue_opened#10",
      "issue_opened#11",
      "issue_closed#11",
    ])
    expect(events[0]).toMatchObject({ labels: ["bug", "p1"], author: "reporter" })
    expect(events[1] && "labels" in events[1]).toBe(false)
  })

  test("off-shape answers are skipped, not thrown on", () => {
    expect(issuesOf(REPO, { message: "Gone" })).toEqual([])
    expect(issuesOf(REPO, [{ number: "x" }])).toEqual([])
  })
})

describe("the baseline announces what is still open", () => {
  test("open pull requests and issues, not history", () => {
    const events = [
      ...pullsOf(REPO, [
        pull(1, iso(T0)),
        pull(2, iso(T0), { merged: iso(T0 + 1) }),
        pull(3, iso(T0), { closed: iso(T0 + 1) }),
      ]),
      ...issuesOf(REPO, [issue(4, iso(T0)), issue(5, iso(T0), { closed: iso(T0 + 1) })]),
    ]
    expect(standing(events).map((e) => e.id)).toEqual([`pr_opened:${REPO}#1`, `issue_opened:${REPO}#4`])
  })

  test("the poller's first poll hands them over, with the size of a pull request's diff", async () => {
    const github = fakeGithub(REPO, T0)
    github.state.pulls = [pull(7, iso(T0 - 1000), { reviewers: 1 })]
    github.state.pages.set(7, pullPage(7, 120, 30))
    github.state.issues = [issue(8, iso(T0 - 2000), { labels: ["enhancement"] })]
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    const events = await poller.poll([target], T0)
    expect(events.map((e) => e.kind)).toEqual(["issue_opened", "pr_opened"])
    expect(events[1]).toMatchObject({ number: 7, status: "review", size: 150 })
    expect(events[0]).toMatchObject({ number: 8, labels: ["enhancement"] })
  })

  test("a pull request whose page cannot be read is announced without a size", async () => {
    const github = fakeGithub(REPO, T0)
    github.state.pulls = [pull(9, iso(T0 - 1000))]
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    const [event] = await poller.poll([target], T0)
    expect(event).toMatchObject({ kind: "pr_opened", number: 9 })
    expect(event && "size" in event).toBe(false)
  })
})

describe("polling the open work", () => {
  test("then a new issue, its close and a draft marked ready are each announced once", async () => {
    const github = fakeGithub(REPO, T0)
    github.state.pulls = [pull(7, iso(T0 - 1000), { draft: true })]
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    await poller.poll([target], T0)
    github.state.issues = [issue(20, iso(T0 + 10_000))]
    github.state.pulls = [pull(7, iso(T0 - 1000), { updated: iso(T0 + 20_000) })]
    const first = await poller.poll([target], T0 + POLL_MS)
    expect(first.map((e) => e.kind)).toEqual(["issue_opened", "pr_updated"])
    github.state.issues = [issue(20, iso(T0 + 10_000), { closed: iso(T0 + 100_000) })]
    const second = await poller.poll([target], T0 + 4 * POLL_MS)
    expect(second.map((e) => e.kind)).toEqual(["issue_closed"])
    expect(await poller.poll([target], T0 + 20 * POLL_MS)).toEqual([])
  })

  test("a repo with issues switched off (410) is not backed off for it", async () => {
    const github = fakeGithub(REPO, T0)
    const gone = async (url: string, init: RequestInit) =>
      url.includes("/issues") ? new Response("{}", { status: 410 }) : github.fetch(url, init)
    const poller = createGithub({ fetch: gone, token: async () => "t0ken", log: quiet })
    await poller.poll([target], T0)
    github.state.commits = [...github.state.commits]
    // Due again after one base interval, not backed off.
    const calls = github.calls.length
    await poller.poll([target], T0 + 2 * POLL_MS)
    expect(github.calls.length).toBeGreaterThan(calls)
  })
})
