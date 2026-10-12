/**
 * SYNTHESIZED GitHub REST payloads — not recorded from the live API. Written from GitHub's documented
 * response schemas (docs.github.com/rest, API version 2022-11-28) for:
 *   GET /repos/{o}/{r}/commits            "List commits"
 *   GET /repos/{o}/{r}/actions/runs       "List workflow runs for a repository"
 *   GET /repos/{o}/{r}/pulls              "List pull requests"
 *   GET /repos/{o}/{r}/releases           "List releases"
 *   GET /repos/{o}/{r}/issues             "List repository issues" (pull requests are listed too)
 *   GET /repos/{o}/{r}/pulls/{n}          "Get a pull request" (additions, deletions)
 * Trimmed to the fields the poller reads plus a few neighbours, so an off-shape change shows up.
 */

export const SYNTHESIZED = true

export type Fetch = (url: string, init: RequestInit) => Promise<Response>
const iso = (ms: number) => new Date(ms).toISOString()

export const sha = (n: number): string => n.toString(16).padStart(40, "0")

/** A commit as "List commits" returns it, newest first in its list. */
export function commit(n: number, date: string, login = "octocat") {
  return {
    sha: sha(n),
    node_id: `C_${n}`,
    html_url: `https://github.com/acme/shop/commit/${sha(n)}`,
    commit: {
      author: { name: "Mona Octocat", email: "mona@example.com", date },
      committer: { name: "GitHub", email: "noreply@github.com", date },
      message: `commit ${n}`,
    },
    author: { login, id: 1, type: "User" },
    committer: { login: "web-flow", id: 2, type: "User" },
    parents: n > 1 ? [{ sha: sha(n - 1) }] : [],
  }
}

/** "List workflow runs": `{ total_count, workflow_runs }`. */
export function runs(...list: ReturnType<typeof run>[]) {
  return { total_count: list.length, workflow_runs: list }
}

export function run(
  id: number,
  head: string,
  status: "queued" | "in_progress" | "completed",
  conclusion: "success" | "failure" | "cancelled" | null,
  updated: string,
) {
  return {
    id,
    name: "CI",
    head_branch: "main",
    head_sha: head,
    event: "push",
    status,
    conclusion,
    workflow_id: 7,
    run_number: id,
    html_url: `https://github.com/acme/shop/actions/runs/${id}`,
    created_at: updated,
    updated_at: updated,
    run_started_at: updated,
  }
}

/** A pull request as "List pull requests" returns it. */
export function pull(
  number: number,
  created: string,
  options: {
    merged?: string
    closed?: string
    title?: string
    draft?: boolean
    reviewers?: number
    autoMerge?: boolean
    updated?: string
  } = {},
) {
  return {
    id: 9000 + number,
    number,
    state: options.closed || options.merged ? "closed" : "open",
    title: options.title ?? `Change ${number}`,
    user: { login: "hubot", id: 3, type: "User" },
    html_url: `https://github.com/acme/shop/pull/${number}`,
    created_at: created,
    updated_at: options.updated ?? options.merged ?? options.closed ?? created,
    closed_at: options.closed ?? options.merged ?? null,
    merged_at: options.merged ?? null,
    head: { ref: `feature-${number}`, sha: sha(500 + number) },
    base: { ref: "main", sha: sha(1) },
    draft: options.draft ?? false,
    requested_reviewers: Array.from({ length: options.reviewers ?? 0 }, (_, i) => ({ login: `rev${i}` })),
    requested_teams: [],
    auto_merge: options.autoMerge ? { merge_method: "squash" } : null,
  }
}

/** "Get a pull request": the page of one, with the size of its diff. */
export function pullPage(number: number, additions: number, deletions: number) {
  return { number, additions, deletions, changed_files: 3 }
}

/** An issue as "List repository issues" returns it; with `pullRequest`, a pull request listed there. */
export function issue(
  number: number,
  created: string,
  options: { closed?: string; labels?: string[]; pullRequest?: boolean } = {},
) {
  return {
    id: 7000 + number,
    number,
    state: options.closed ? "closed" : "open",
    title: `Issue ${number}`,
    user: { login: "reporter", id: 4, type: "User" },
    html_url: `https://github.com/acme/shop/issues/${number}`,
    labels: (options.labels ?? []).map((name) => ({ id: 1, name, color: "d73a4a" })),
    created_at: created,
    updated_at: options.closed ?? created,
    closed_at: options.closed ?? null,
    ...(options.pullRequest
      ? { pull_request: { url: "https://api.github.com/repos/acme/shop/pulls/1" } }
      : {}),
  }
}

export function release(id: number, tag: string, published: string | null, draft = false) {
  return {
    id,
    tag_name: tag,
    target_commitish: "main",
    name: `Release ${tag}`,
    draft,
    prerelease: false,
    created_at: published ?? "2026-10-01T00:00:00Z",
    published_at: published,
    html_url: `https://github.com/acme/shop/releases/tag/${tag}`,
    author: { login: "octocat", id: 1 },
  }
}

/**
 * A stand-in api.github.com for one repo, from SYNTHESIZED payloads (fixtures/github.ts). Answers with
 * an ETag per body and a 304 when the request's If-None-Match matches; keeps every request.
 */
export function fakeGithub(repo: string, t0: number) {
  const state = {
    commits: [commit(1, iso(t0 - 3_600_000))] as ReturnType<typeof commit>[],
    runs: new Map<string, ReturnType<typeof run>[]>(),
    pulls: [pull(1, iso(t0 - 86_400_000), { merged: iso(t0 - 80_000_000) })] as ReturnType<typeof pull>[],
    releases: [release(1, "v1.0.0", iso(t0 - 86_400_000))] as ReturnType<typeof release>[],
    issues: [] as ReturnType<typeof issue>[],
    pages: new Map<number, ReturnType<typeof pullPage>>(),
    remaining: 4000,
    reset: Math.floor(t0 / 1000) + 3600,
    status: undefined as number | undefined,
  }
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetch: Fetch = async (url, init) => {
    const headers = init.headers as Record<string, string>
    calls.push({ url, headers })
    const rate = {
      "x-ratelimit-remaining": String(state.remaining),
      "x-ratelimit-reset": String(state.reset),
    }
    if (state.status) return new Response("{}", { status: state.status, headers: rate })
    const { pathname, searchParams } = new URL(url)
    const path = pathname.replace(`/repos/${repo}`, "")
    const body =
      path === "/commits"
        ? state.commits
        : path === "/actions/runs"
          ? runs(...(state.runs.get(searchParams.get("head_sha") ?? "") ?? []))
          : path === "/pulls"
            ? state.pulls
            : path === "/releases"
              ? state.releases
              : path === "/issues"
                ? state.issues
                : path.startsWith("/pulls/")
                  ? state.pages.get(Number(path.slice(7)))
                  : undefined
    if (body === undefined) return new Response("{}", { status: 404, headers: rate })
    const text = JSON.stringify(body)
    const etag = `"${Bun.hash(text).toString(16)}"`
    if (headers["if-none-match"] === etag)
      return new Response(null, { status: 304, headers: { ...rate, etag } })
    return new Response(text, { status: 200, headers: { ...rate, etag, "content-type": "application/json" } })
  }
  return { state, calls, fetch }
}
