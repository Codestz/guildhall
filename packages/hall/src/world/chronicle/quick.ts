import { GitHubError, parseRepo } from "../gen/fetch.ts"
import type { RepoEntry } from "../gen/repo.ts"
import {
  linesWeekly,
  milestonesOf,
  tidyReleases,
  type UnitLife,
  type UnitSample,
  unitColumns,
} from "./assemble.ts"
import {
  activityChar,
  CHRONICLE_VERSION,
  type Chronicle,
  type Contributor,
  type Day,
  dayOf,
  isoOf,
  type Weekly,
} from "./format.ts"
import { hasPrivatePaths, privateTo } from "./privacy.ts"
import { languageName, percentages, tallyUnits, treeLanguages, type UnitTally } from "./units.ts"

/**
 * The quick chronicle: built live in the browser from the unauthenticated GitHub API (60 calls an
 * hour per IP) in at most QUICK_LIMIT calls, failing soft. In order of what matters most:
 *
 *   repo (1) · tree (1, or none when the caller has it) · stats/code_frequency (1, +1 on a 202)
 *   · SAMPLES historical trees (commits?until=…&per_page=1, then git/trees/<sha>: 2 each)
 *   · stats/contributors (1, +1 on a 202) · contributors (1) · languages (1) · releases (1)
 *
 * Only the repo call may fail the build (it says whether there is a repo at all); any other answer
 * that isn't there (202 twice, an error, the budget spent, the rate limit hit) leaves its section out
 * and names it in `partial`. A hit rate limit stops every later call.
 */

export const QUICK_LIMIT = 20
/** Historical trees sampled, spaced over the repo's life (denser where code_frequency says it grew). */
export const QUICK_SAMPLES = 6

export interface QuickOptions {
  fetcher?: typeof fetch
  /** The default branch's tree, when the caller already fetched it (saves a call). */
  tree?: { entries: RepoEntry[]; truncated?: boolean }
  limit?: number
  samples?: number
  /** Waits before asking a 202 again (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

interface Api {
  /** The JSON GitHub answered, or undefined (failed soft). Throws only for `required` calls. */
  get<T>(path: string, section: string, required?: boolean): Promise<T | undefined>
  /** A stats endpoint: a 202 (still computing) is asked once more after a pause. */
  stats<T>(path: string, section: string): Promise<T | undefined>
  calls: number
  partial: Set<string>
}

export async function quickChronicle(ownerRepo: string, options: QuickOptions = {}): Promise<Chronicle> {
  const repo = parseRepo(ownerRepo)
  const limit = options.limit ?? QUICK_LIMIT
  const api = client(
    repo,
    options.fetcher ?? fetch,
    limit,
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  )
  const now = (options.now ?? (() => new Date()))()
  const hidden = privateTo(repo)

  const meta = (await api.get<RepoJson>("", "repo", true)) as RepoJson
  const name = meta.full_name ?? repo
  const branch = meta.default_branch ?? "main"
  const final = options.tree ?? (await treeAt(encodeURIComponent(branch)))
  const finalEntries = (final?.entries ?? []).filter((entry) => !hidden(entry.path))
  const frequency = await api.stats<[number, number, number][]>("/stats/code_frequency", "growth")

  const end = dayOf(meta.pushed_at ?? now.toISOString())
  const firstWeek = frequency?.find(([, added]) => added > 0)?.[0]
  const created = meta.created_at ? dayOf(meta.created_at) : end
  const start = Math.min(created, firstWeek !== undefined ? dayOf(firstWeek * 1000) : created, end)
  const weeks = Math.floor((end - start) / 7) + 1
  const weekOf = (day: Day): number => Math.max(0, Math.min(weeks - 1, Math.floor((day - start) / 7)))

  // Historical samples: the commit before each chosen day, then its tree.
  const history: { day: Day; sha: string; entries: RepoEntry[]; truncated: boolean }[] = []
  for (const day of sampleDays(start, end, options.samples ?? QUICK_SAMPLES, frequency)) {
    const commits = await api.get<CommitJson[]>(
      `/commits?sha=${encodeURIComponent(branch)}&until=${isoOf(day)}T23:59:59Z&per_page=1`,
      "history",
    )
    const commit = commits?.[0]
    if (!commit?.sha) continue
    const at = dayOf(commit.commit?.committer?.date ?? `${isoOf(day)}T00:00:00Z`)
    if (history.some((known) => known.sha === commit.sha)) continue
    const tree = await treeAt(commit.sha)
    if (tree) history.push({ day: at, sha: commit.sha, entries: tree.entries, truncated: tree.truncated })
  }
  history.sort((a, b) => a.day - b.day)
  const samples = [
    ...history.map((sample) => ({
      ...sample,
      entries: sample.entries.filter((entry) => !hidden(entry.path)),
    })),
    { day: end, sha: "", entries: finalEntries, truncated: !!final?.truncated },
  ]

  const stats = await api.stats<StatsJson[]>("/stats/contributors", "activity")
  const listed = await api.get<ContributorJson[]>("/contributors?per_page=100", "contributors")
  const languages = hasPrivatePaths(repo)
    ? undefined
    : await api.get<Record<string, number>>("/languages", "languages")
  const releases = await api.get<ReleaseJson[]>("/releases?per_page=100", "releases")

  const tallies = samples.map((sample) => tallyUnits(sample.entries))
  const lives = new Map<string, UnitLife>()
  tallies.forEach((units, i) => {
    for (const [unitName, tally] of units) {
      const known = lives.get(unitName)
      if (!known)
        lives.set(unitName, {
          born: samples[i]?.day ?? start,
          language: languageName(tally),
          ...(tally.group ? { group: tally.group } : {}),
        })
      else known.language = languageName(tally)
    }
  })
  for (const [unitName, life] of lives) {
    const last = tallies.findLastIndex((units) => units.has(unitName))
    if (last < tallies.length - 1) life.died = samples[last + 1]?.day ?? end
  }
  const columns = tallies.map(
    (units) =>
      new Map<string, UnitSample>(
        [...units].map(([unitName, tally]: [string, UnitTally]) => [
          unitName,
          { files: tally.files, bytes: tally.bytes },
        ]),
      ),
  )

  const weekly: Weekly = {}
  if (frequency) Object.assign(weekly, linesWeekly(frequency, weeks, weekOf))
  if (stats) {
    const commits = new Array<number>(weeks).fill(0)
    for (const author of stats)
      for (const week of author.weeks ?? []) {
        const i = weekOf(dayOf(week.w * 1000))
        commits[i] = (commits[i] ?? 0) + week.c
      }
    weekly.commits = commits
  }

  const contributors = contributorsOf(stats, listed, weekOf, start, end)
  const body: Omit<Chronicle, "milestones"> = {
    v: CHRONICLE_VERSION,
    depth: "quick",
    generatedAt: now.toISOString(),
    repo: {
      name,
      branch,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.stargazers_count !== undefined ? { stars: meta.stargazers_count } : {}),
      ...(meta.forks_count !== undefined ? { forks: meta.forks_count } : {}),
      ...(meta.created_at ? { created: created } : {}),
      languages:
        languages && Object.keys(languages).length > 0
          ? percentages(new Map(Object.entries(languages)))
          : percentages(treeLanguages(finalEntries)),
      files: finalEntries.filter((entry) => entry.type !== "tree").length,
      bytes: finalEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
      contributors: listed?.length ?? contributors.length,
    },
    start,
    end,
    snapshots: {
      day: samples.map((sample) => sample.day),
      sha: samples.map((sample) => sample.sha.slice(0, 8)),
      files: samples.map((sample) => sample.entries.filter((entry) => entry.type !== "tree").length),
      bytes: samples.map((sample) => sample.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0)),
      ...(samples.some((sample) => sample.truncated)
        ? { truncated: samples.flatMap((sample, i) => (sample.truncated ? [i] : [])) }
        : {}),
    },
    units: unitColumns(columns, lives),
    weekly,
    contributors,
    releases: tidyReleases(
      (releases ?? [])
        .filter((release) => !release.draft && release.tag_name)
        .map((release) => ({
          tag: release.tag_name as string,
          day: dayOf(release.published_at ?? release.created_at ?? now.toISOString()),
          ...(release.name && release.name !== release.tag_name ? { name: release.name } : {}),
          ...(release.prerelease ? { prerelease: true as const } : {}),
        })),
    ),
    budget: { calls: api.calls, limit },
  }
  const out: Chronicle = { ...body, milestones: milestonesOf(body) }
  if (api.partial.size > 0) out.partial = [...api.partial].sort()
  return out

  async function treeAt(ref: string): Promise<{ entries: RepoEntry[]; truncated: boolean } | undefined> {
    const listing = await api.get<TreeJson>(`/git/trees/${ref}?recursive=1`, "history")
    if (!listing) return undefined
    const entries = (listing.tree ?? [])
      .filter((entry) => entry.type === "blob" || entry.type === "tree" || entry.type === "commit")
      .map(
        ({ path, type, size }): RepoEntry =>
          type === "blob" ? { path, type, size: size ?? 0 } : { path, type: type as RepoEntry["type"] },
      )
    return { entries, truncated: !!listing.truncated }
  }
}

/**
 * Days to sample between `start` and `end` (both left out: the end is today's tree). Spaced half by
 * time and half by churn (code_frequency's added + deleted lines), when GitHub gave it.
 */
export function sampleDays(
  start: Day,
  end: Day,
  count: number,
  frequency: readonly [number, number, number][] | undefined,
): Day[] {
  const span = Math.max(1, end - start)
  const weeks = (frequency ?? []).map(([week, added, deleted]) => ({
    day: dayOf(week * 1000),
    churn: Math.abs(added) + Math.abs(deleted),
  }))
  const total = weeks.reduce((sum, week) => sum + week.churn, 0)
  const out: Day[] = []
  for (let i = 1; i <= count; i++) {
    const target = i / (count + 1)
    if (total <= 0) {
      out.push(Math.round(start + span * target))
      continue
    }
    // The first day the blend of elapsed time and done churn reaches the target.
    let churn = 0
    let day = end
    for (const week of weeks) {
      churn += week.churn
      if (0.5 * ((week.day - start) / span) + 0.5 * (churn / total) >= target) {
        day = week.day + 6
        break
      }
    }
    out.push(Math.max(start, Math.min(end - 1, day)))
  }
  return [...new Set(out)]
}

function client(
  repo: string,
  fetcher: typeof fetch,
  limit: number,
  sleep: (ms: number) => Promise<void>,
): Api {
  let limited = false
  const api: Api = {
    calls: 0,
    partial: new Set(),
    async get<T>(path: string, section: string, required = false): Promise<T | undefined> {
      const answer = await ask(path, section, required)
      return answer?.status === 200 ? (answer.body as T) : undefined
    },
    async stats<T>(path: string, section: string): Promise<T | undefined> {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await sleep(1500)
        const answer = await ask(path, section)
        if (!answer) return undefined
        if (answer.status === 200)
          return Array.isArray(answer.body) && answer.body.length > 0 ? (answer.body as T) : undefined
        if (answer.status !== 202) return undefined
      }
      api.partial.add(section)
      return undefined
    },
  }
  return api

  async function ask(
    path: string,
    section: string,
    required = false,
  ): Promise<{ status: number; body: unknown } | undefined> {
    if (limited || api.calls >= limit) {
      api.partial.add(limited ? "rate" : "budget")
      api.partial.add(section)
      if (required)
        throw new GitHubError("GitHub's rate limit for unauthenticated calls (60 an hour) is used up", 403)
      return undefined
    }
    api.calls++
    let response: Response
    try {
      response = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
        headers: { Accept: "application/vnd.github+json" },
      })
    } catch (error) {
      if (required) throw error
      api.partial.add(section)
      return undefined
    }
    if (response.status === 202) return { status: 202, body: undefined }
    if (response.ok) return { status: 200, body: await response.json() }
    if (
      (response.status === 403 || response.status === 429) &&
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      limited = true
      api.partial.add("rate")
    }
    api.partial.add(section)
    if (required)
      throw new GitHubError(
        response.status === 404
          ? `no public repo "${repo}" on GitHub`
          : `GitHub answered ${response.status} for ${repo}`,
        response.status,
      )
    return undefined
  }
}

/** stats/contributors (activity) joined with the contributor list (commit totals), by login. */
function contributorsOf(
  stats: readonly StatsJson[] | undefined,
  listed: readonly ContributorJson[] | undefined,
  weekOf: (day: Day) => number,
  start: Day,
  end: Day,
): Contributor[] {
  const out = new Map<string, Contributor>()
  for (const author of stats ?? []) {
    const login = author.author?.login
    if (!login) continue
    const active = (author.weeks ?? []).filter((week) => week.c > 0)
    const first = active[0]
    const last = active[active.length - 1]
    if (!first || !last) continue
    const perWeek = new Map<number, number>()
    for (const week of active) {
      const i = weekOf(dayOf(week.w * 1000))
      perWeek.set(i, (perWeek.get(i) ?? 0) + week.c)
    }
    const from = Math.min(...perWeek.keys())
    const to = Math.max(...perWeek.keys())
    let weeks = ""
    for (let w = from; w <= to; w++) weeks += activityChar(perWeek.get(w) ?? 0)
    out.set(login.toLowerCase(), {
      name: login,
      login,
      ...(isBot(login, author.author?.type) ? { bot: true as const } : {}),
      first: dayOf(first.w * 1000),
      last: dayOf(last.w * 1000) + 6,
      commits: author.total ?? active.reduce((sum, week) => sum + week.c, 0),
      from,
      weeks,
    })
  }
  for (const person of listed ?? []) {
    if (!person.login) continue
    const known = out.get(person.login.toLowerCase())
    if (known) {
      known.commits = Math.max(known.commits, person.contributions ?? 0)
      continue
    }
    // Not in the stats: no weekly activity known, so their span is the whole history.
    out.set(person.login.toLowerCase(), {
      name: person.login,
      login: person.login,
      ...(isBot(person.login, person.type) ? { bot: true as const } : {}),
      first: start,
      last: end,
      commits: person.contributions ?? 0,
      from: 0,
      weeks: "",
    })
  }
  return [...out.values()].sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1)).slice(0, 100)
}

const isBot = (login: string, type?: string): boolean => type === "Bot" || /\[bot\]$/i.test(login)

interface RepoJson {
  full_name?: string
  default_branch?: string
  description?: string | null
  stargazers_count?: number
  forks_count?: number
  created_at?: string
  pushed_at?: string
}
interface TreeJson {
  tree?: { path: string; type: string; size?: number }[]
  truncated?: boolean
}
interface CommitJson {
  sha?: string
  commit?: { committer?: { date?: string } }
}
interface StatsJson {
  author?: { login?: string; type?: string } | null
  total?: number
  weeks?: { w: number; a: number; d: number; c: number }[]
}
interface ContributorJson {
  login?: string
  type?: string
  contributions?: number
}
interface ReleaseJson {
  tag_name?: string
  name?: string | null
  published_at?: string | null
  created_at?: string
  prerelease?: boolean
  draft?: boolean
}
