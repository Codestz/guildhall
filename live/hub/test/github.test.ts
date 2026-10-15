import { describe, expect, test } from "bun:test"
import {
  ANONYMOUS_POLL_MS,
  ciOf,
  ciState,
  createGithub,
  POLL_MS,
  pullsOf,
  pushOf,
  releasesOf,
} from "../src/github.ts"
import { commit, fakeGithub, pull, release, run, runs, sha } from "./fixtures/github.ts"

const REPO = "acme/shop"
const T0 = Date.parse("2026-10-08T12:00:00Z")
const iso = (ms: number) => new Date(ms).toISOString()

const target = { repo: REPO, branches: ["main"] }
const quiet = () => {}

describe("reading GitHub's answers (SYNTHESIZED payloads)", () => {
  test("a moved head is a push of the commits above the old head, by the newest's author", () => {
    const list = [commit(4, iso(T0), "mona"), commit(3, iso(T0 - 1)), commit(2, iso(T0 - 2))]
    const push = pushOf(REPO, "main", list, sha(2), 0)
    expect(push).toMatchObject({
      kind: "push",
      commits: 2,
      author: "mona",
      branch: "main",
      sha: sha(4),
      at: T0,
    })
    expect(push?.id).toBe(`push:${REPO}:main:${sha(4)}`)
  })

  test("no push without an old head, or when the head didn't move", () => {
    const list = [commit(4, iso(T0))]
    expect(pushOf(REPO, "main", list, undefined, 0)).toBeUndefined()
    expect(pushOf(REPO, "main", list, sha(4), 0)).toBeUndefined()
  })

  test("an old head not in the page (force push) counts the whole page", () => {
    expect(pushOf(REPO, "main", [commit(9, iso(T0)), commit(8, iso(T0))], sha(1), 0)?.commits).toBe(2)
  })

  test("workflow runs map to queued, running, passed and failed; cancelled says nothing", () => {
    expect(ciState("queued", null)).toBe("queued")
    expect(ciState("in_progress", null)).toBe("running")
    expect(ciState("completed", "success")).toBe("passed")
    expect(ciState("completed", "failure")).toBe("failed")
    expect(ciState("completed", "timed_out")).toBe("failed")
    expect(ciState("completed", "cancelled")).toBeUndefined()
    const events = ciOf(REPO, "main", runs(run(5, sha(4), "completed", "failure", iso(T0))))
    expect(events).toEqual([
      {
        kind: "ci",
        id: `ci:${REPO}:5:failed`,
        at: T0,
        repo: REPO,
        state: "failed",
        name: "CI",
        branch: "main",
        sha: sha(4),
        url: "https://github.com/acme/shop/actions/runs/5",
      },
    ])
  })

  test("a pull request is opened, then merged or closed", () => {
    const kinds = pullsOf(REPO, [
      pull(7, iso(T0)),
      pull(8, iso(T0), { merged: iso(T0 + 1) }),
      pull(9, iso(T0), { closed: iso(T0 + 2) }),
    ]).map((e) => `${e.kind}#${"number" in e ? e.number : ""}`)
    expect(kinds).toEqual(["pr_opened#7", "pr_opened#8", "pr_merged#8", "pr_opened#9", "pr_closed#9"])
  })

  test("drafts aren't releases yet", () => {
    const events = releasesOf(REPO, [release(1, "v1", iso(T0)), release(2, "v2", null, true)])
    expect(events.map((e) => e.kind === "release" && e.tag)).toEqual(["v1"])
  })

  test("off-shape answers are skipped, not thrown on", () => {
    expect(pullsOf(REPO, { message: "Not Found" })).toEqual([])
    expect(ciOf(REPO, "main", [1, 2])).toEqual([])
    expect(releasesOf(REPO, [null, { id: "x" }])).toEqual([])
    expect(pushOf(REPO, "main", "nope", sha(1), 0)).toBeUndefined()
  })
})

describe("the poller", () => {
  test("the first poll is a baseline: what is already there is not announced", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    expect(await poller.poll([target], T0)).toEqual([])
    expect(poller.mode()).toBe("token")
  })

  test("then announces a push, a PR, CI and a release, once each, oldest first", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    await poller.poll([target], T0)
    github.state.commits = [
      commit(3, iso(T0 + 10_000), "mona"),
      commit(2, iso(T0 + 5_000)),
      ...github.state.commits,
    ]
    github.state.runs.set(sha(3), [run(11, sha(3), "in_progress", null, iso(T0 + 20_000))])
    github.state.pulls = [pull(2, iso(T0 + 1_000)), ...github.state.pulls]
    github.state.releases = [release(2, "v1.1.0", iso(T0 + 30_000)), ...github.state.releases]
    const later = T0 + POLL_MS
    const events = await poller.poll([target], later)
    expect(events.map((e) => e.kind)).toEqual(["pr_opened", "push", "ci", "release"])
    expect(events.find((e) => e.kind === "push")).toMatchObject({ commits: 2, author: "mona" })
    expect(events.find((e) => e.kind === "ci")).toMatchObject({ state: "running" })
    // Nothing changed: 304s, and nothing announced twice.
    expect(await poller.poll([target], later + 10 * POLL_MS)).toEqual([])
  })

  test("a CI run is announced again as its state moves, and a PR when it is merged", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    github.state.pulls = [pull(2, iso(T0 - 1000))]
    await poller.poll([target], T0)
    github.state.runs.set(sha(1), [run(12, sha(1), "completed", "failure", iso(T0 + 1000))])
    github.state.pulls = [pull(2, iso(T0 - 1000), { merged: iso(T0 + 2000) })]
    const first = await poller.poll([target], T0 + POLL_MS)
    expect(first.map((e) => e.id)).toEqual([`ci:${REPO}:12:failed`, `pr_merged:${REPO}#2`])
    github.state.runs.set(sha(1), [run(13, sha(1), "completed", "success", iso(T0 + 90_000))])
    const second = await poller.poll([target], T0 + 10 * POLL_MS)
    expect(second.map((e) => e.kind === "ci" && e.state)).toEqual(["passed"])
  })

  test("asks conditionally: the ETag it was given goes back as If-None-Match", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    await poller.poll([target], T0)
    const before = github.calls.length
    await poller.poll([target], T0 + 10 * POLL_MS)
    const again = github.calls.slice(before)
    expect(again.length).toBeGreaterThan(0)
    for (const call of again) expect(call.headers["if-none-match"]).toMatch(/^".+"$/)
  })

  test("a repo is not asked again before its interval, and a quiet one is asked less often", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    await poller.poll([target], T0)
    const after = github.calls.length
    await poller.poll([target], T0 + POLL_MS - 1)
    expect(github.calls.length).toBe(after)
    await poller.poll([target], T0 + POLL_MS)
    const quietAt = github.calls.length
    // Quiet: the next interval is 1.5× (90 s), so 60 s later it is not due yet.
    await poller.poll([target], T0 + 2 * POLL_MS)
    expect(github.calls.length).toBe(quietAt)
  })

  test("near the rate limit it stops until the reset", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({ fetch: github.fetch, token: async () => "t0ken", log: quiet })
    github.state.remaining = 3
    await poller.poll([target], T0)
    const made = github.calls.length
    expect(made).toBe(1)
    await poller.poll([target], T0 + 30 * POLL_MS)
    expect(github.calls.length).toBe(made)
    github.state.remaining = 4000
    await poller.poll([target], github.state.reset * 1000 + 1)
    expect(github.calls.length).toBeGreaterThan(made)
  })

  test("without a token it polls anonymously, slowly, and sends no Authorization", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({ fetch: github.fetch, token: async () => undefined, log: quiet })
    await poller.poll([target], T0)
    expect(poller.mode()).toBe("anonymous")
    for (const call of github.calls) expect(call.headers.authorization).toBeUndefined()
    const made = github.calls.length
    await poller.poll([target], T0 + ANONYMOUS_POLL_MS - 1)
    expect(github.calls.length).toBe(made)
  })

  test("a token GitHub refuses (401) is dropped and gh asked again later", async () => {
    const github = fakeGithub(REPO, T0)
    let reads = 0
    const poller = createGithub({
      fetch: github.fetch,
      token: async () => {
        reads++
        return "t0ken"
      },
      log: quiet,
    })
    github.state.status = 401
    await poller.poll([target], T0)
    expect(poller.mode()).toBe("anonymous")
    const unauthorized = github.calls.findIndex((call) => call.headers.authorization === undefined)
    expect(unauthorized).toBeGreaterThan(0)
    github.state.status = undefined
    await poller.poll([target], T0 + 60 * 60_000)
    expect(reads).toBe(2)
    expect(poller.mode()).toBe("token")
  })

  test("a reader that throws, or gh's absence, never breaks polling", async () => {
    const github = fakeGithub(REPO, T0)
    const poller = createGithub({
      fetch: github.fetch,
      token: async () => {
        throw new Error("no gh")
      },
      log: quiet,
    })
    expect(await poller.poll([target], T0)).toEqual([])
    expect(poller.mode()).toBe("anonymous")
  })

  test("a fetch that throws is an error, backed off, never thrown", async () => {
    const poller = createGithub({
      fetch: async () => {
        throw new TypeError("network down")
      },
      token: async () => "t0ken",
      log: quiet,
    })
    expect(await poller.poll([target], T0)).toEqual([])
  })

  test("idle and asks gh nothing while there is no repo to poll", async () => {
    let reads = 0
    const poller = createGithub({
      fetch: fakeGithub(REPO, T0).fetch,
      token: async () => {
        reads++
        return "t0ken"
      },
      log: quiet,
    })
    expect(await poller.poll([], T0)).toEqual([])
    expect(poller.mode()).toBe("idle")
    expect(reads).toBe(0)
  })
})
