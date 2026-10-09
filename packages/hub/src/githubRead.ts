import type { CiState, PrStatus, SeaEvent } from "@guildhall/core"

/** Longest text taken from GitHub (titles, names): it is shown, never trusted. */
const MAX_TEXT = 300

// The answers, read as sea events. GitHub's shapes are documented
// (docs.github.com/rest: commits, actions/workflow-runs, pulls, releases); anything off-shape is skipped.

export type Json = Record<string, unknown>

export const object = (value: unknown): Json | undefined =>
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

export function headOf(commits: unknown): string | undefined {
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

/**
 * Where an open pull request stands, from the list's own fields: a draft; armed to auto-merge
 * (ready); with reviewers requested (review); or open and waiting for anyone.
 */
export function prStatus(pull: Record<string, unknown>): PrStatus {
  if (pull.draft === true) return "draft"
  if (object(pull.auto_merge)) return "ready"
  return list(pull.requested_reviewers).length + list(pull.requested_teams).length > 0 ? "review" : "open"
}

const pullBase = (repo: string, number: number, pull: Json) => ({
  repo,
  number,
  title: text(pull.title),
  author: text(object(pull.user)?.login, "someone"),
  branch: text(object(pull.head)?.ref),
  ...page(pull.html_url),
})

/** Each pull request's opening, and its merge or close once it has one. */
export function pullsOf(repo: string, body: unknown): SeaEvent[] {
  return list(body).flatMap((pull): SeaEvent[] => {
    const number = pull.number
    const opened = time(pull.created_at)
    if (typeof number !== "number" || opened === undefined) return []
    const base = pullBase(repo, number, pull)
    const out: SeaEvent[] = [
      { kind: "pr_opened", id: `pr_opened:${repo}#${number}`, at: opened, ...base, status: prStatus(pull) },
    ]
    const merged = time(pull.merged_at)
    const closed = time(pull.closed_at)
    if (merged !== undefined)
      out.push({ kind: "pr_merged", id: `pr_merged:${repo}#${number}`, at: merged, ...base })
    else if (closed !== undefined && pull.state === "closed")
      out.push({ kind: "pr_closed", id: `pr_closed:${repo}#${number}`, at: closed, ...base })
    return out
  })
}

/**
 * An open pull request whose status moved since `known` last saw it (a draft marked ready, a review
 * asked for). `known` is updated to what the list says now; a pull request not in it yet (the
 * baseline, or just opened: its opening says its status) is only learned.
 */
export function statusMoves(repo: string, body: unknown, known: Map<number, PrStatus>): SeaEvent[] {
  const out: SeaEvent[] = []
  for (const pull of list(body)) {
    const number = pull.number
    if (typeof number !== "number") continue
    if (pull.state !== "open") {
      known.delete(number)
      continue
    }
    const status = prStatus(pull)
    const before = known.get(number)
    known.set(number, status)
    const at = time(pull.updated_at)
    if (before === undefined || before === status || at === undefined) continue
    out.push({
      kind: "pr_updated",
      id: `pr_updated:${repo}#${number}:${status}:${at}`,
      at,
      ...pullBase(repo, number, pull),
      status,
    })
  }
  return out
}

/** Each issue's opening, and its closing once it has one. Pull requests, which the endpoint also lists, are not issues. */
export function issuesOf(repo: string, body: unknown): SeaEvent[] {
  return list(body).flatMap((issue): SeaEvent[] => {
    const number = issue.number
    const opened = time(issue.created_at)
    if (typeof number !== "number" || opened === undefined || "pull_request" in issue) return []
    const labels = list(issue.labels)
      .map((label) => text(label.name))
      .filter(Boolean)
      .slice(0, 8)
    const base = {
      repo,
      number,
      title: text(issue.title),
      author: text(object(issue.user)?.login, "someone"),
      ...(labels.length > 0 ? { labels } : {}),
      ...page(issue.html_url),
    }
    const out: SeaEvent[] = [
      { kind: "issue_opened", id: `issue_opened:${repo}#${number}`, at: opened, ...base },
    ]
    const closed = time(issue.closed_at)
    if (closed !== undefined && issue.state === "closed")
      out.push({ kind: "issue_closed", id: `issue_closed:${repo}#${number}`, at: closed, ...base })
    return out
  })
}

/** The baseline's announcements: the pull requests and issues still open, not their history. */
export function standing(events: readonly SeaEvent[]): SeaEvent[] {
  const ended = new Set<string>()
  for (const event of events)
    if (event.kind === "pr_merged" || event.kind === "pr_closed" || event.kind === "issue_closed")
      ended.add(`${event.kind.split("_")[0]}:${event.repo}#${event.number}`)
  return events.filter(
    (event) =>
      (event.kind === "pr_opened" && !ended.has(`pr:${event.repo}#${event.number}`)) ||
      (event.kind === "issue_opened" && !ended.has(`issue:${event.repo}#${event.number}`)),
  )
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
