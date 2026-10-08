import type { CiState, SeaEvent } from "@guildhall/core"

/**
 * The hub's watch on GitHub (PROTOCOL.md §7): for each repo a recently active guild works in, it asks
 * the REST API what changed — new commits on the guild's branch, pull requests, the CI runs on the
 * branch's head, releases — and reads the answers as `SeaEvent`s.
 *
 * Gentle by design. Every request is conditional (`If-None-Match` with the last ETag: a 304 costs no
 * rate limit), a repo is polled every POLL_MS at most and less often while it is quiet or failing,
 * and the hub stops asking once `X-RateLimit-Remaining` nears its reserve, until `X-RateLimit-Reset`.
 *
 * The token is gh's (`gh auth token`, read when there is first a repo to poll, and again after a 401).
 * It is held in this closure only and goes nowhere but the Authorization header of requests to
 * api.github.com: never logged, recorded or sent to a hall. Without gh, or logged out, public repos
 * are polled without a token, every ANONYMOUS_POLL_MS (GitHub allows 60 requests an hour so).
 *
 * The first poll of a repo is its baseline: what is already there is remembered, not announced. After
 * that, an event is new when its id was never seen and it happened after the baseline.
 */

export const API = "https://api.github.com"
/** A repo with a token is polled at most this often. */
export const POLL_MS = 60_000
/** Without one. */
export const ANONYMOUS_POLL_MS = 10 * 60_000
/** A quiet repo's interval grows by half each quiet poll, up to this many times the base interval. */
const QUIET_FACTOR = 5
/** A repo whose requests fail backs off, doubling, up to this. */
export const MAX_BACKOFF_MS = 15 * 60_000
/** A repo GitHub says isn't there (a private one, without a token) is asked again after this. */
export const MISSING_POLL_MS = 60 * 60_000
/** Requests left in the hour below which polling waits for the reset. */
const RESERVE = { token: 100, anonymous: 5 }
/** After a 401 or no token, gh is asked again at most this often. */
const TOKEN_RETRY_MS = 10 * 60_000
const TIMEOUT_MS = 10_000
/** Ids remembered per repo for dedupe. */
const SEEN_MAX = 2000
/** ETags remembered in all. */
const ETAGS_MAX = 500
/** GitHub's clock and this one differ a little: an event this much before the baseline still counts. */
const SKEW_MS = 2 * 60_000
/** Longest text taken from GitHub (titles, names): it is shown, never trusted. */
const MAX_TEXT = 300

/** A repo to watch, and the branches its guilds have checked out. */
export interface SeaTarget {
  repo: string
  branches: readonly string[]
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface GithubOptions {
  /** Stands in for `fetch` (tests). */
  fetch?: Fetch
  /** Reads the token (default: `gh auth token`). Undefined means none: poll anonymously. */
  token?: () => Promise<string | undefined>
  log?: (message: string) => void
  /** Base interval per repo with a token (POLL_MS). */
  interval?: number
  /** Base interval per repo without (ANONYMOUS_POLL_MS). */
  anonymousInterval?: number
}

export type GithubMode = "idle" | "token" | "anonymous"

export interface GithubPoller {
  /** Polls each target that is due at `now`; the new events, oldest first. Never throws. */
  poll(targets: readonly SeaTarget[], now?: number): Promise<SeaEvent[]>
  /** `idle` until there was something to poll; then whether it polls with a token. */
  mode(): GithubMode
}

interface RepoState {
  due: number
  interval: number
  /** When its baseline was taken; undefined before. */
  since?: number
  /** Branch → the newest commit seen on it. */
  heads: Map<string, string>
  seen: Set<string>
}

type Answer =
  | { kind: "ok"; body: unknown }
  | { kind: "same" }
  | { kind: "missing" }
  | { kind: "limited" }
  | { kind: "error" }

export function createGithub(options: GithubOptions = {}): GithubPoller {
  const request = options.fetch ?? ((url, init) => fetch(url, init))
  const readToken = options.token ?? ghToken
  const log = options.log ?? ((message: string) => console.warn(`hub: ${message}`))
  const states = new Map<string, RepoState>()
  const etags = new Map<string, string>()
  let token: string | undefined
  let tokenRead = Number.NEGATIVE_INFINITY
  let mode: GithubMode = "idle"
  /** No request before this (the rate limit's reset). */
  let pausedUntil = 0

  async function authorize(now: number): Promise<void> {
    if (token !== undefined || now - tokenRead < TOKEN_RETRY_MS) return
    tokenRead = now
    try {
      token = (await readToken()) || undefined
    } catch {
      token = undefined
    }
    const next: GithubMode = token ? "token" : "anonymous"
    if (next !== mode)
      log(
        next === "token"
          ? "GitHub: polling with gh's token"
          : "GitHub: no gh token (gh missing or logged out); polling public repos without one, slowly",
      )
    mode = next
  }

  async function get(path: string, now: number): Promise<Answer> {
    if (now < pausedUntil) return { kind: "limited" }
    const url = `${API}${path}`
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "guildhall-hub",
    }
    const etag = etags.get(url)
    if (etag) headers["if-none-match"] = etag
    if (token) headers.authorization = `Bearer ${token}`
    let response: Response
    try {
      response = await request(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      return { kind: "error" }
    }
    const remaining = Number(response.headers.get("x-ratelimit-remaining") ?? Number.NaN)
    const reset = Number(response.headers.get("x-ratelimit-reset") ?? Number.NaN) * 1000
    const retryAfter = Number(response.headers.get("retry-after") ?? Number.NaN) * 1000
    if (
      Number.isFinite(remaining) &&
      Number.isFinite(reset) &&
      remaining <= RESERVE[token ? "token" : "anonymous"]
    )
      pause(reset, "near its rate limit")
    if (response.status === 304) return { kind: "same" }
    if (response.ok) {
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return { kind: "error" }
      }
      const tag = response.headers.get("etag")
      if (tag) remember(url, tag)
      return { kind: "ok", body }
    }
    if (response.status === 404) return { kind: "missing" }
    if (response.status === 401 && token) {
      // Revoked or expired: ask gh again later, and go on without one meanwhile.
      token = undefined
      log("GitHub refused gh's token (401); polling without one until gh has a good one")
      mode = "anonymous"
    } else if (response.status === 403 || response.status === 429) {
      if (Number.isFinite(retryAfter)) pause(now + retryAfter, "asked to slow down")
      else if (remaining === 0 && Number.isFinite(reset)) pause(reset, "at its rate limit")
    }
    return { kind: "error" }
  }

  function pause(until: number, why: string): void {
    if (until <= pausedUntil) return
    pausedUntil = until
    log(`GitHub: ${why}; polling again at ${new Date(until).toISOString()}`)
  }

  function remember(url: string, tag: string): void {
    etags.delete(url)
    etags.set(url, tag)
    if (etags.size > ETAGS_MAX) etags.delete(etags.keys().next().value as string)
  }

  /** One repo's requests: its new events, and how the poll went. */
  async function pollRepo(
    target: SeaTarget,
    state: RepoState,
    now: number,
  ): Promise<{ events: SeaEvent[]; outcome: "events" | "quiet" | "error" | "missing" | "limited" }> {
    const repo = target.repo
    const found: SeaEvent[] = []
    const answers: Answer["kind"][] = []
    const ask = async (path: string) => {
      const answer = await get(`/repos/${repo}${path}`, now)
      answers.push(answer.kind)
      return answer
    }
    for (const branch of target.branches) {
      const commits = await ask(`/commits?sha=${encodeURIComponent(branch)}&per_page=30`)
      if (commits.kind === "ok") {
        const push = pushOf(repo, branch, commits.body, state.heads.get(branch), now)
        const head = headOf(commits.body)
        if (head) state.heads.set(branch, head)
        if (push) found.push(push)
      }
      const head = state.heads.get(branch)
      if (head) {
        const runs = await ask(`/actions/runs?head_sha=${head}&per_page=20`)
        if (runs.kind === "ok") found.push(...ciOf(repo, branch, runs.body))
      }
    }
    const pulls = await ask("/pulls?state=all&sort=updated&direction=desc&per_page=20")
    if (pulls.kind === "ok") found.push(...pullsOf(repo, pulls.body))
    const releases = await ask("/releases?per_page=10")
    if (releases.kind === "ok") found.push(...releasesOf(repo, releases.body))

    const baseline = state.since === undefined
    state.since ??= now
    const since = state.since - SKEW_MS
    const fresh = found.filter((event) => !state.seen.has(event.id) && !baseline && event.at >= since)
    for (const event of found) {
      state.seen.delete(event.id)
      state.seen.add(event.id)
    }
    while (state.seen.size > SEEN_MAX) state.seen.delete(state.seen.values().next().value as string)

    const outcome = answers.includes("missing")
      ? "missing"
      : answers.includes("error")
        ? "error"
        : answers.includes("limited")
          ? "limited"
          : fresh.length > 0 || baseline
            ? "events"
            : "quiet"
    return { events: fresh, outcome }
  }

  return {
    mode: () => mode,
    async poll(targets, now = Date.now()) {
      const wanted = new Set(targets.map((target) => target.repo))
      for (const repo of states.keys())
        if (!wanted.has(repo)) {
          // Forgotten whole: watched again later, it takes a fresh baseline, so its ETags must go too
          // (a 304 would hide the heads that baseline needs).
          states.delete(repo)
          for (const url of etags.keys()) if (url.startsWith(`${API}/repos/${repo}/`)) etags.delete(url)
        }
      if (targets.length === 0) return []
      await authorize(now)
      const base = token ? (options.interval ?? POLL_MS) : (options.anonymousInterval ?? ANONYMOUS_POLL_MS)
      const out: SeaEvent[] = []
      for (const target of targets) {
        let state = states.get(target.repo)
        if (!state) {
          state = { due: 0, interval: base, heads: new Map(), seen: new Set() }
          states.set(target.repo, state)
        }
        if (now < state.due) continue
        try {
          const { events, outcome } = await pollRepo(target, state, now)
          out.push(...events)
          if (outcome === "events") state.interval = base
          else if (outcome === "quiet")
            state.interval = Math.min(Math.round(state.interval * 1.5), base * QUIET_FACTOR)
          else if (outcome === "error")
            state.interval = Math.min(Math.max(state.interval, base) * 2, MAX_BACKOFF_MS)
          else if (outcome === "missing") state.interval = MISSING_POLL_MS
          state.interval = Math.max(state.interval, base)
          state.due = outcome === "limited" ? Math.max(pausedUntil, now + base) : now + state.interval
        } catch (error) {
          state.due = now + MAX_BACKOFF_MS
          log(`GitHub: polling ${target.repo} failed: ${String(error)}`)
        }
      }
      return out.sort((a, b) => a.at - b.at)
    },
  }
}

/** `gh auth token`'s answer, or undefined when gh is missing, logged out, or slow. Never throws. */
export async function ghToken(): Promise<string | undefined> {
  try {
    const gh = Bun.which("gh", { PATH: process.env.PATH ?? "" })
    if (!gh) return undefined
    const child = Bun.spawn([gh, "auth", "token"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const timer = setTimeout(() => child.kill(), 5000)
    const text = (await new Response(child.stdout).text()).trim()
    clearTimeout(timer)
    return (await child.exited) === 0 && /^[A-Za-z0-9_.-]{20,255}$/.test(text) ? text : undefined
  } catch {
    return undefined
  }
}

// The answers, read as sea events. GitHub's shapes are documented
// (docs.github.com/rest: commits, actions/workflow-runs, pulls, releases); anything off-shape is skipped.

type Json = Record<string, unknown>

const object = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined
const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.flatMap((item) => (object(item) ? [item as Json] : [])) : []
const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.slice(0, MAX_TEXT) : fallback
const time = (value: unknown): number | undefined => {
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? at : undefined
}
const page = (value: unknown): { url?: string } =>
  typeof value === "string" && value.startsWith("https://github.com/") ? { url: value.slice(0, 1000) } : {}

function headOf(commits: unknown): string | undefined {
  const sha = list(commits)[0]?.sha
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}

/**
 * A push, when the branch's head moved since `before`: the commits above `before` in the newest-first
 * list (all of the list when `before` isn't in it: a force push, or more than a page), by the newest
 * commit's author. None without a `before` (the baseline).
 */
export function pushOf(
  repo: string,
  branch: string,
  commits: unknown,
  before: string | undefined,
  now: number,
): SeaEvent | undefined {
  const all = list(commits)
  const head = headOf(commits)
  const newest = all[0]
  if (!before || !head || !newest || head === before) return undefined
  const index = all.findIndex((commit) => commit.sha === before)
  const detail = object(newest.commit)
  const author = text(object(newest.author)?.login) || text(object(detail?.author)?.name) || "someone"
  return {
    kind: "push",
    id: `push:${repo}:${branch}:${head}`,
    at: time(object(detail?.committer)?.date) ?? time(object(detail?.author)?.date) ?? now,
    repo,
    branch,
    commits: index === -1 ? all.length : index,
    author,
    sha: head,
    ...page(newest.html_url),
  }
}

/** A workflow run's state; undefined for one cancelled or gone stale, which says nothing either way. */
export function ciState(status: unknown, conclusion: unknown): CiState | undefined {
  if (status === "in_progress") return "running"
  if (status === "queued" || status === "waiting" || status === "requested" || status === "pending")
    return "queued"
  if (status !== "completed") return undefined
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") return "passed"
  if (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "startup_failure" ||
    conclusion === "action_required"
  )
    return "failed"
  return undefined
}

/** Each workflow run on the head, in the state it is in now (one id per run and state). */
export function ciOf(repo: string, branch: string, body: unknown): SeaEvent[] {
  return list(object(body)?.workflow_runs).flatMap((run): SeaEvent[] => {
    const state = ciState(run.status, run.conclusion)
    const at = time(run.updated_at) ?? time(run.run_started_at) ?? time(run.created_at)
    if (!state || at === undefined || typeof run.id !== "number" || typeof run.head_sha !== "string")
      return []
    return [
      {
        kind: "ci",
        id: `ci:${repo}:${run.id}:${state}`,
        at,
        repo,
        state,
        name: text(run.name, "CI") || "CI",
        branch,
        sha: run.head_sha.slice(0, 40),
        ...page(run.html_url),
      },
    ]
  })
}

/** Each pull request's opening, and its merge or close once it has one. */
export function pullsOf(repo: string, body: unknown): SeaEvent[] {
  return list(body).flatMap((pull): SeaEvent[] => {
    const number = pull.number
    const opened = time(pull.created_at)
    if (typeof number !== "number" || opened === undefined) return []
    const base = {
      repo,
      number,
      title: text(pull.title),
      author: text(object(pull.user)?.login, "someone"),
      branch: text(object(pull.head)?.ref),
      ...page(pull.html_url),
    }
    const out: SeaEvent[] = [{ kind: "pr_opened", id: `pr_opened:${repo}#${number}`, at: opened, ...base }]
    const merged = time(pull.merged_at)
    const closed = time(pull.closed_at)
    if (merged !== undefined)
      out.push({ kind: "pr_merged", id: `pr_merged:${repo}#${number}`, at: merged, ...base })
    else if (closed !== undefined && pull.state === "closed")
      out.push({ kind: "pr_closed", id: `pr_closed:${repo}#${number}`, at: closed, ...base })
    return out
  })
}

/** Each published release (drafts aren't news yet). */
export function releasesOf(repo: string, body: unknown): SeaEvent[] {
  return list(body).flatMap((release): SeaEvent[] => {
    const at = time(release.published_at)
    if (release.draft === true || at === undefined || typeof release.id !== "number") return []
    const tag = text(release.tag_name)
    if (!tag) return []
    const name = text(release.name)
    return [
      {
        kind: "release",
        id: `release:${repo}:${release.id}`,
        at,
        repo,
        tag,
        ...(name ? { name } : {}),
        ...page(release.html_url),
      },
    ]
  })
}
