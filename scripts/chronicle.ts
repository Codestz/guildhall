/**
 * Deep chronicles (packages/hall/src/world/chronicle/format.ts) from a repo's whole history.
 *
 *   bun scripts/chronicle.ts deep <owner/name> [--out file] [--keep]
 *   bun scripts/chronicle.ts bundle            every repo the hall ships one for, one after another
 *
 * Without --out it writes packages/hall/public/chronicles/<owner__name>.json.gz (GitHub's current
 * spelling, lower case), the asset world/chronicle/bundled.ts fetches.
 *
 * How: a treeless-of-blobs clone (`git clone --bare --filter=blob:none`) into the system's temp dir,
 * never inside this repo, deleted after (--keep leaves it for a re-run). Two logs, both trees-only
 * (GIT_NO_LAZY_FETCH=1 makes any blob read fail instead of downloading it): the first-parent
 * structure log (--name-status) and the non-merge author log (--name-only). Everything else comes
 * from GitHub with the local `gh` token, all optional and failing soft (named in `partial`):
 * sizes from git/trees at the ~24–40 sampled commits, releases' names, logins for the top authors'
 * emails (GraphQL, 100 commits a query), weekly PR/issue counts (GraphQL search counts, 50 a query),
 * code_frequency. Immutable answers (trees, logins, closed weeks' counts) are cached in the temp dir.
 * git runs under `nice`, and at most two API calls are in flight.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AuthorCommit,
  axisOf,
  buildDeep,
  type DeepInput,
  parseAuthorLog,
  parseStructureLog,
  pickSnapshots,
  visibleHistory,
} from "../packages/hall/src/world/chronicle/deep.ts"
import { dayOf, encodeChronicle, isoOf } from "../packages/hall/src/world/chronicle/format.ts"
import type { RepoEntry } from "../packages/hall/src/world/gen/repo.ts"

/** The repos the hall ships a chronicle for (hud/RepoDoor.tsx' examples, and this repo). */
const BUNDLE = [
  "Codestz/mcpx",
  "Codestz/claude-hindsight",
  "Codestz/Mintroot",
  "Codestz/opencode-cockpit",
  "Codestz/guildhall",
  "anomalyco/opencode",
  "react/react",
]

const ROOT = join(import.meta.dir, "..")
const OUT_DIR = join(ROOT, "packages/hall/public/chronicles")
const WORK = join(tmpdir(), "guildhall-chronicle")
const CACHE = join(WORK, "cache")
/** API concurrency: kept low, this runs on a laptop. */
const PARALLEL = 2
/** GraphQL search queries (50 weekly counts each) a repo may spend on PR/issue activity. */
const MAX_SEARCH_QUERIES = 120

let calls = 0
let token: string | undefined

async function main(): Promise<void> {
  const [command, repo, ...rest] = Bun.argv.slice(2)
  const keep = rest.includes("--keep")
  const outAt = rest.indexOf("--out")
  token = (await run(["gh", "auth", "token"], ROOT).catch(() => "")).trim() || undefined
  if (!token) console.warn("no gh token: GitHub calls are unauthenticated (60 an hour) and may fail soft")
  if (command === "deep" && repo) {
    await deep(repo, outAt >= 0 ? rest[outAt + 1] : undefined, keep)
  } else if (command === "bundle") {
    for (const one of BUNDLE) await deep(one, undefined, keep)
  } else {
    console.error("usage: bun scripts/chronicle.ts deep <owner/name> [--out file] [--keep] | bundle")
    process.exit(1)
  }
}

async function deep(wanted: string, out: string | undefined, keep: boolean): Promise<void> {
  const began = performance.now()
  const callsBefore = calls
  const lap = timer()
  const meta = (await rest(`repos/${wanted}`)) as MetaJson | undefined
  if (!meta) throw new Error(`GitHub doesn't know ${wanted}`)
  const repo = meta.full_name
  const branch = meta.default_branch
  const slug = repo.toLowerCase().replace("/", "__")
  const clone = join(WORK, `${slug}.git`)
  const partial: string[] = []

  if (!(await exists(clone))) {
    await mkdir(WORK, { recursive: true })
    await git(
      ["clone", "--quiet", "--bare", "--filter=blob:none", `https://github.com/${repo}.git`, clone],
      WORK,
    )
  } else
    await git(
      [
        "fetch",
        "--quiet",
        "--filter=blob:none",
        "origin",
        `+refs/heads/${branch}:refs/heads/${branch}`,
        "--tags",
      ],
      clone,
    )
  const cloned = lap()

  const history = visibleHistory(
    repo,
    parseStructureLog(
      await git(
        [
          "-c",
          "core.quotepath=false",
          "log",
          "--reverse",
          "--first-parent",
          "--diff-merges=first-parent",
          "--no-renames",
          "--name-status",
          "--format=@%H %ct",
          branch,
        ],
        clone,
      ),
    ),
    parseAuthorLog(
      await git(
        [
          "-c",
          "core.quotepath=false",
          "log",
          "--reverse",
          "--no-merges",
          "--no-renames",
          "--name-only",
          "--format=@%H %at %aE%x09%aN",
          branch,
        ],
        clone,
      ),
    ),
  )
  const { structure, authors } = history
  const tags = (
    await git(
      ["for-each-ref", "--sort=creatordate", "--format=%(refname:short)%09%(creatordate:unix)", "refs/tags"],
      clone,
    )
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [tag = "", seconds = "0"] = line.split("\t")
      return { tag, day: dayOf(Number(seconds) * 1000) }
    })
  const logged = lap()

  // Trees at the sampled commits (sizes), two at a time.
  const picks = pickSnapshots(structure).map((k) => structure[k]?.sha ?? "")
  const trees: NonNullable<DeepInput["trees"]> = {}
  await parallel(picks, async (sha) => {
    const tree = await treeOf(repo, sha)
    if (tree) trees[sha] = tree
  })
  const soft =
    <T>(section: string, fallback: T) =>
    (): T => {
      partial.push(section)
      return fallback
    }
  const names = await releaseNames(repo).catch(soft("releases", {} as Record<string, string>))
  const logins = await loginsOf(repo, authors).catch(soft("logins", {} as Record<string, string>))
  const { start, end } = axisOf(structure, authors)
  const activity = await activityOf(repo, start, end).catch((error) => {
    console.warn(`  PR/issue counts skipped: ${(error as Error).message}`)
    return undefined
  })
  const codeFrequency = await codeFrequencyOf(repo)
  const languages = (await rest(`repos/${repo}/languages`)) as Record<string, number> | undefined
  const fetched = lap()

  const chronicle = buildDeep({
    repo,
    branch,
    generatedAt: new Date().toISOString(),
    meta: {
      ...(meta.description ? { description: meta.description } : {}),
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      created: meta.created_at,
      ...(languages ? { languages } : {}),
    },
    structure,
    authors,
    trees,
    tags: tags.map((tag) => ({ ...tag, ...(names[tag.tag] ? { name: names[tag.tag] } : {}) })),
    logins,
    ...(activity ? { activity } : {}),
    ...(codeFrequency ? { codeFrequency } : {}),
    partial,
  })
  const json = encodeChronicle(chronicle)
  const gz = Bun.gzipSync(new TextEncoder().encode(json), { level: 9 })
  const file = out ?? join(OUT_DIR, `${slug}.json.gz`)
  await mkdir(join(file, ".."), { recursive: true })
  await writeFile(file, gz)
  if (!keep) await rm(clone, { recursive: true, force: true })

  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`
  console.log(
    [
      `${repo}  →  ${file.replace(`${ROOT}/`, "")}`,
      `  ${structure.length} mainline / ${authors.length} authored commits, ${chronicle.units.length} units, ${chronicle.snapshots.day.length} samples, ${chronicle.contributors.length}/${chronicle.repo.contributors} contributors, ${chronicle.releases.length} releases, ${chronicle.milestones.length} milestones`,
      `  ${isoOf(chronicle.start)} → ${isoOf(chronicle.end)}  ·  ${chronicle.repo.files} files, ${(chronicle.repo.bytes / 1e6).toFixed(1)} MB today`,
      `  size ${(json.length / 1024).toFixed(1)} KB raw, ${(gz.length / 1024).toFixed(1)} KB gz`,
      `  time ${s(performance.now() - began)} (clone ${s(cloned)}, logs ${s(logged)}, GitHub ${s(fetched)}), ${calls - callsBefore} API calls`,
      chronicle.partial ? `  partial: ${chronicle.partial.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  )
}

/** A sampled commit's tree with sizes (cached: a commit's tree never changes). */
async function treeOf(
  repo: string,
  sha: string,
): Promise<{ entries: RepoEntry[]; truncated?: boolean } | undefined> {
  return cached(`tree-${sha}`, async () => {
    const listing = (await rest(`repos/${repo}/git/trees/${sha}?recursive=1`)) as TreeJson | undefined
    if (!listing) return undefined
    const entries = (listing.tree ?? [])
      .filter((entry) => entry.type === "blob" || entry.type === "commit")
      .map(
        ({ path, type, size }): RepoEntry =>
          type === "blob" ? { path, type, size: size ?? 0 } : { path, type: "commit" },
      )
    return { entries, ...(listing.truncated ? { truncated: true } : {}) }
  })
}

/** Release names by tag, from GitHub's releases (up to 300). */
async function releaseNames(repo: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (let page = 1; page <= 3; page++) {
    const list = (await rest(`repos/${repo}/releases?per_page=100&page=${page}`)) as
      | { tag_name: string; name?: string | null }[]
      | undefined
    for (const release of list ?? [])
      if (release.name && release.name !== release.tag_name) out[release.tag_name] = release.name
    if (!list || list.length < 100) break
  }
  return out
}

/** GitHub logins for the busiest authors' emails: one of their commits each, 100 a GraphQL query. */
async function loginsOf(repo: string, authors: readonly AuthorCommit[]): Promise<Record<string, string>> {
  const byEmail = new Map<string, { sha: string; commits: number }>()
  for (const commit of authors) {
    if (!commit.email || commit.email.endsWith("@users.noreply.github.com")) continue
    const known = byEmail.get(commit.email)
    if (known) known.commits++
    else byEmail.set(commit.email, { sha: commit.sha, commits: 1 })
  }
  const busiest = [...byEmail].sort((a, b) => b[1].commits - a[1].commits).slice(0, 400)
  const [owner, name] = repo.split("/")
  const out: Record<string, string> = {}
  const batches: (typeof busiest)[] = []
  for (let i = 0; i < busiest.length; i += 100) batches.push(busiest.slice(i, i + 100))
  await parallel(batches, async (batch) => {
    const key = `logins-${Bun.hash(batch.map(([, { sha }]) => sha).join(",")).toString(16)}`
    const found = await cached(key, async () => {
      const fields = batch
        .map(
          ([, { sha }], i) => `c${i}: object(oid: "${sha}") { ... on Commit { author { user { login } } } }`,
        )
        .join(" ")
      const data = (await graphql(
        `query { repository(owner: "${owner}", name: "${name}") { ${fields} } }`,
      )) as {
        repository?: Record<string, { author?: { user?: { login?: string } | null } } | null>
      }
      return batch.map((_, i) => data.repository?.[`c${i}`]?.author?.user?.login ?? "")
    })
    batch.forEach(([email], i) => {
      if (found?.[i]) out[email] = found[i]
    })
  })
  return out
}

const SERIES = {
  prsOpened: (r: string, a: string, b: string) => `repo:${r} is:pr created:${a}..${b}`,
  prsMerged: (r: string, a: string, b: string) => `repo:${r} is:pr is:merged merged:${a}..${b}`,
  prsClosed: (r: string, a: string, b: string) => `repo:${r} is:pr is:unmerged closed:${a}..${b}`,
  issuesOpened: (r: string, a: string, b: string) => `repo:${r} is:issue created:${a}..${b}`,
  issuesClosed: (r: string, a: string, b: string) => `repo:${r} is:issue closed:${a}..${b}`,
} as const

/** PR and issue counts per week (GraphQL search counts, 50 a query; finished weeks cached). */
async function activityOf(
  repo: string,
  start: number,
  end: number,
): Promise<NonNullable<DeepInput["activity"]>> {
  const weeks = Math.floor((end - start) / 7) + 1
  const today = dayOf(Date.now())
  const asks: { series: keyof typeof SERIES; week: number; query: string; final: boolean }[] = []
  for (const series of Object.keys(SERIES) as (keyof typeof SERIES)[])
    for (let week = 0; week < weeks; week++) {
      const from = start + week * 7
      asks.push({
        series,
        week,
        query: SERIES[series](repo, isoOf(from), isoOf(from + 6)),
        final: from + 6 < today - 1,
      })
    }
  const batches: (typeof asks)[] = []
  for (let i = 0; i < asks.length; i += 50) batches.push(asks.slice(i, i + 50))
  if (batches.length > MAX_SEARCH_QUERIES)
    throw new Error(`${batches.length} search queries is over the budget`)
  const out = Object.fromEntries(
    Object.keys(SERIES).map((series) => [series, new Array<number>(weeks).fill(0)]),
  )
  await parallel(batches, async (batch) => {
    const key = `search-${Bun.hash(batch.map((ask) => ask.query).join("|")).toString(16)}`
    const fetch = async (): Promise<number[]> => {
      const fields = batch
        .map(
          (ask, i) =>
            `w${i}: search(type: ISSUE, query: ${JSON.stringify(ask.query)}, first: 0) { issueCount }`,
        )
        .join(" ")
      const data = (await graphql(`query { ${fields} }`)) as Record<string, { issueCount: number }>
      return batch.map((_, i) => data[`w${i}`]?.issueCount ?? 0)
    }
    const counts = batch.every((ask) => ask.final) ? await cached(key, fetch) : await fetch()
    batch.forEach((ask, i) => {
      ;(out[ask.series] as number[])[ask.week] = counts?.[i] ?? 0
    })
  })
  return out
}

/** stats/code_frequency, asked again while GitHub is still computing it (202); none for huge repos (422). */
async function codeFrequencyOf(repo: string): Promise<[number, number, number][] | undefined> {
  for (let attempt = 0; attempt < 4; attempt++) {
    calls++
    const response = await fetch(`https://api.github.com/repos/${repo}/stats/code_frequency`, {
      headers: headers(),
    })
    if (response.status === 200) {
      const body = (await response.json()) as [number, number, number][]
      return Array.isArray(body) && body.length > 0 ? body : undefined
    }
    if (response.status !== 202) return undefined
    await Bun.sleep(3000)
  }
  return undefined
}

function headers(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/** A REST answer, or undefined when GitHub didn't give one. */
async function rest(path: string): Promise<unknown> {
  calls++
  const response = await fetch(`https://api.github.com/${path}`, { headers: headers() })
  if (!response.ok) {
    console.warn(`  GitHub ${response.status} for ${path}`)
    return undefined
  }
  return response.json()
}

async function graphql(query: string): Promise<unknown> {
  calls++
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query }),
  })
  const body = (await response.json()) as { data?: unknown; errors?: { message: string }[] }
  if (!response.ok || !body.data)
    throw new Error(body.errors?.[0]?.message ?? `GraphQL answered ${response.status}`)
  return body.data
}

/** `make()`'s answer, kept on disk under `key` (undefined answers are not kept). */
async function cached<T>(key: string, make: () => Promise<T | undefined>): Promise<T | undefined> {
  const file = join(CACHE, `${key}.json`)
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    const made = await make()
    if (made !== undefined) {
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, JSON.stringify(made))
    }
    return made
  }
}

/** Runs `work` over `items`, PARALLEL at a time. */
async function parallel<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) await work(items[next++] as T)
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, lane))
}

/** git, niced, never fetching a blob (a blob read fails instead). */
function git(args: string[], cwd: string): Promise<string> {
  return run(["nice", "-n", "10", "git", ...args], cwd, { GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" })
}

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}): ${err.trim()}`)
  return out
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** Milliseconds since the last lap. */
function timer(): () => number {
  let last = performance.now()
  return () => {
    const now = performance.now()
    const lap = now - last
    last = now
    return lap
  }
}

interface MetaJson {
  full_name: string
  default_branch: string
  description?: string | null
  stargazers_count?: number
  forks_count?: number
  created_at?: string
}
interface TreeJson {
  tree?: { path: string; type: string; size?: number }[]
  truncated?: boolean
}

await main()
