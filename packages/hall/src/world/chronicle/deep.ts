import { languageOf } from "../gen/biomes.ts"
import type { RepoEntry } from "../gen/repo.ts"
import {
  linesWeekly,
  type Moments,
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
  MAX_CONTRIBUTORS,
  type Release,
  type Weekly,
} from "./format.ts"
import { hasPrivatePaths, privateTo } from "./privacy.ts"
import { languageName, percentages, tallyUnits, treeLanguages, type UnitTally, unitOf } from "./units.ts"

/**
 * The deep chronicle, pure: built from a clone's two logs (scripts/chronicle.ts runs git and the
 * API, then hands everything here), so the same inputs always make the same chronicle.
 *
 * - The structure log (`git log --first-parent --diff-merges=first-parent --no-renames --name-status`)
 *   is replayed path by path: exact file counts per unit at every commit, so births, deaths, renames
 *   and the weekly file count are exact to the day. It needs trees only, never blobs.
 * - The author log (`git log --no-merges --name-only`) gives who touched what, when.
 * - Sizes come from the API's git/trees at the sampled commits (`pickSnapshots`); a sample without
 *   one is estimated from its neighbours' bytes per file, and "bytes" is marked partial.
 */

export interface StructureCommit {
  sha: string
  /** Committer day: when it landed on the default branch. */
  day: Day
  changes: [status: string, path: string][]
}

export interface AuthorCommit {
  sha: string
  /** Author day. */
  day: Day
  email: string
  name: string
  paths: string[]
}

/** The `--format=@%H %ct` structure log, with --name-status lines. */
export function parseStructureLog(text: string): StructureCommit[] {
  const out: StructureCommit[] = []
  let current: StructureCommit | undefined
  for (const line of text.split("\n")) {
    if (line.startsWith("@")) {
      const [sha = "", seconds = "0"] = line.slice(1).split(" ")
      current = { sha, day: dayOf(Number(seconds) * 1000), changes: [] }
      out.push(current)
    } else if (current && line.includes("\t")) {
      const [status = "", ...rest] = line.split("\t")
      current.changes.push([status.slice(0, 1), unquote(rest[rest.length - 1] ?? "")])
    }
  }
  return out
}

/** The `--format=@%H %at %aE%x09%aN` author log, with --name-only lines. */
export function parseAuthorLog(text: string): AuthorCommit[] {
  const out: AuthorCommit[] = []
  let current: AuthorCommit | undefined
  for (const line of text.split("\n")) {
    if (line.startsWith("@")) {
      const space = line.indexOf(" ")
      const second = line.indexOf(" ", space + 1)
      const [email = "", name = ""] = line.slice(second + 1).split("\t")
      current = {
        sha: line.slice(1, space),
        day: dayOf(Number(line.slice(space + 1, second)) * 1000),
        email: email.toLowerCase(),
        name: name.trim(),
        paths: [],
      }
      out.push(current)
    } else if (current && line.length > 0) current.paths.push(unquote(line))
  }
  return out
}

/** A path git quoted (special characters), back to itself. */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path
  return path
    .slice(1, -1)
    .replace(/\\(["\\])/g, "$1")
    .replace(/\\t/g, "\t")
}

/** Sampled commits (indices into the structure log): ~24–40, denser where the tree changed fast. */
export function pickSnapshots(structure: readonly StructureCommit[]): number[] {
  if (structure.length === 0) return []
  const first = structure[0]?.day ?? 0
  const last = structure[structure.length - 1]?.day ?? first
  const years = (last - first) / 365
  const n = Math.min(structure.length, Math.max(24, Math.min(40, Math.round(24 + 1.5 * years))))
  if (structure.length <= n) return structure.map((_, k) => k)
  const total = structure.reduce((sum, commit) => sum + commit.changes.length, 0) || 1
  const span = last - first || 1
  // Half time, half churn: a quiet year gets few samples, a rewrite gets several.
  const picks = new Set<number>([0, structure.length - 1])
  let churn = 0
  let target = 0
  // The last target is the last commit, already kept.
  for (let k = 0; k < structure.length && target < n - 1; k++) {
    const commit = structure[k] as StructureCommit
    churn += commit.changes.length
    const u = 0.5 * ((commit.day - first) / span) + 0.5 * (churn / total)
    while (target < n - 1 && u >= target / Math.max(1, n - 1)) {
      picks.add(k)
      target++
    }
  }
  // A commit that met several targets at once leaves the count short: top it up evenly by time.
  for (let i = 1; picks.size < n && i < n; i++) {
    const day = first + (span * i) / n
    const k = structure.findIndex((commit, j) => commit.day >= day && !picks.has(j))
    if (k >= 0) picks.add(k)
  }
  // History bunched into a few days: then evenly by commit.
  for (let i = 1; picks.size < n && i < n; i++) picks.add(Math.round((i * (structure.length - 1)) / n))
  return [...picks].sort((a, b) => a - b)
}

/** The days a deep chronicle spans, from its structure log (week 0 starts at `start`). */
export function axisOf(
  structure: readonly StructureCommit[],
  authors: readonly AuthorCommit[] = [],
): {
  start: Day
  end: Day
} {
  const start = structure[0]?.day ?? authors[0]?.day ?? 0
  const lastAuthor = authors.reduce((most, commit) => Math.max(most, commit.day), start)
  return { start, end: Math.max(structure[structure.length - 1]?.day ?? start, lastAuthor) }
}

/**
 * The history with `repo`'s private paths taken out (privacy.ts), and the commits that touched
 * nothing else dropped. buildDeep applies it itself; a caller picking samples or weeks first
 * (pickSnapshots, axisOf) must pick from this, so the two agree.
 */
export function visibleHistory(
  repo: string,
  structure: readonly StructureCommit[],
  authors: readonly AuthorCommit[],
): { structure: StructureCommit[]; authors: AuthorCommit[] } {
  const hidden = privateTo(repo)
  return {
    structure: structure
      .map((commit) => ({ ...commit, changes: commit.changes.filter(([, path]) => !hidden(path)) }))
      .filter((commit, i) => commit.changes.length > 0 || (structure[i]?.changes.length ?? 0) === 0),
    authors: authors
      .map((commit) => ({ ...commit, paths: commit.paths.filter((path) => !hidden(path)) }))
      .filter((commit, i) => commit.paths.length > 0 || (authors[i]?.paths.length ?? 0) === 0),
  }
}

export interface DeepInput {
  repo: string
  branch: string
  generatedAt: string
  meta?: {
    description?: string
    stars?: number
    forks?: number
    /** ISO. */
    created?: string
    /** GitHub's languages: bytes per language. */
    languages?: Record<string, number>
  }
  /** Oldest first. */
  structure: StructureCommit[]
  /** Oldest first. */
  authors: AuthorCommit[]
  /** Trees (with sizes) at the sampled commits, by full sha. */
  trees?: Record<string, { entries: RepoEntry[]; truncated?: boolean }>
  tags?: Omit<Release, "major">[]
  /** Email (lower case) → GitHub login. */
  logins?: Record<string, string>
  /** PR and issue counts per week, aligned to axisOf's weeks. */
  activity?: Pick<Weekly, "prsOpened" | "prsMerged" | "prsClosed" | "issuesOpened" | "issuesClosed">
  /** GitHub's stats/code_frequency: [week (unix seconds), additions, deletions]. */
  codeFrequency?: [number, number, number][]
  partial?: string[]
}

export function buildDeep(input: DeepInput): Chronicle {
  const hidden = privateTo(input.repo)
  const partial = new Set(input.partial ?? [])
  const { structure, authors } = visibleHistory(input.repo, input.structure, input.authors)
  const { start, end } = axisOf(structure, authors)
  const weeks = Math.floor((end - start) / 7) + 1
  const weekOf = (day: Day): number => Math.max(0, Math.min(weeks - 1, Math.floor((day - start) / 7)))

  const picks = pickSnapshots(structure)
  const replay = replayStructure(structure, picks, weekOf, weeks)

  // Sizes at each sample, from its tree.
  const trees = picks.map((k) => {
    const tree = input.trees?.[structure[k]?.sha ?? ""]
    if (!tree) return undefined
    const entries = tree.entries.filter((entry) => !hidden(entry.path))
    return { tallies: tallyUnits(entries), entries, truncated: !!tree.truncated }
  })
  if (trees.some((tree) => !tree)) partial.add("bytes")
  const samples = replay.samples.map((counts, i): Map<string, UnitSample> => {
    const out = new Map<string, UnitSample>()
    for (const [name, files] of counts) {
      const group = unitGroup(name)
      out.set(name, { files, bytes: bytesOf(name, files, i), ...(group ? { group } : {}) })
    }
    return out
  })
  function bytesOf(name: string, files: number, i: number): number {
    const own = trees[i]?.tallies.get(name)
    if (own) return own.bytes
    if (trees[i] || files === 0) return 0
    // No tree here: the nearest sample's bytes per file.
    for (let d = 1; d < trees.length; d++)
      for (const j of [i - d, i + d]) {
        const near = trees[j]?.tallies.get(name)
        if (near && near.files > 0) return Math.round((near.bytes / near.files) * files)
      }
    return 0
  }

  const lives = new Map<string, UnitLife>()
  for (const [name, life] of replay.lives) {
    if (!samples.some((sample) => (sample.get(name)?.files ?? 0) > 0)) continue
    const lastTree = [...trees]
      .reverse()
      .find((tree) => tree?.tallies.has(name))
      ?.tallies.get(name)
    lives.set(name, {
      born: life.born,
      ...(life.died !== undefined ? { died: life.died } : {}),
      language: languageName(lastTree ?? (replay.languages.get(name) as UnitTally)),
      ...(unitGroup(name) ? { group: unitGroup(name) as string } : {}),
    })
  }
  const units = unitColumns(samples, lives)

  const finalTree = trees[trees.length - 1]
  const snapshots = {
    day: picks.map((k) => structure[k]?.day ?? start),
    sha: picks.map((k) => (structure[k]?.sha ?? "").slice(0, 8)),
    files: replay.totals,
    bytes: samples.map((sample) => [...sample.values()].reduce((sum, unit) => sum + unit.bytes, 0)),
    ...(trees.some((tree) => tree?.truncated)
      ? { truncated: trees.flatMap((tree, i) => (tree?.truncated ? [i] : [])) }
      : {}),
  }

  const people = contributorsOf(authors, input.logins ?? {}, weekOf)
  const weekly: Weekly = {
    commits: tally(
      authors.map((commit) => weekOf(commit.day)),
      weeks,
    ),
    files: replay.weeklyFiles,
  }
  if (input.codeFrequency) Object.assign(weekly, linesWeekly(input.codeFrequency, weeks, weekOf))
  for (const [key, series] of Object.entries(input.activity ?? {}))
    if (series?.length === weeks) weekly[key as keyof Weekly] = series
    else partial.add("prs")

  const languages =
    !hasPrivatePaths(input.repo) && input.meta?.languages && Object.keys(input.meta.languages).length > 0
      ? percentages(new Map(Object.entries(input.meta.languages)))
      : percentages(treeLanguages(finalTree?.entries ?? []))
  const body: Omit<Chronicle, "milestones"> = {
    v: CHRONICLE_VERSION,
    depth: "deep",
    generatedAt: input.generatedAt,
    repo: {
      name: input.repo,
      branch: input.branch,
      ...(input.meta?.description ? { description: input.meta.description } : {}),
      ...(input.meta?.stars !== undefined ? { stars: input.meta.stars } : {}),
      ...(input.meta?.forks !== undefined ? { forks: input.meta.forks } : {}),
      ...(input.meta?.created ? { created: dayOf(input.meta.created) } : {}),
      languages,
      files: snapshots.files[snapshots.files.length - 1] ?? 0,
      bytes: snapshots.bytes[snapshots.bytes.length - 1] ?? 0,
      commits: authors.length,
      contributors: people.total,
    },
    start,
    end,
    snapshots,
    units,
    weekly,
    contributors: people.top,
    releases: tidyReleases((input.tags ?? []).filter((tag) => tag.day >= start - 1)),
  }
  const out: Chronicle = { ...body, milestones: milestonesOf(body, replay.moments) }
  if (partial.size > 0) out.partial = [...partial].sort()
  return out
}

/** A unit name's container ("packages" for "packages/react"), if it is a package. */
const unitGroup = (name: string): string | undefined => (name.includes("/") ? name.split("/")[0] : undefined)

/** Which unit a path's file is in (a log can't tell a submodule from a file: both are files here). */
const unitKey = (path: string): string => unitOf(path).name

interface Replay {
  /** Files per unit at each sample. */
  samples: Map<string, number>[]
  totals: number[]
  weeklyFiles: number[]
  lives: Map<string, { born: Day; died?: Day }>
  languages: Map<string, Pick<UnitTally, "languages">>
  moments: Moments
}

/** The structure log played forward: exact files per unit, births, deaths, renames, big reshapes. */
function replayStructure(
  structure: readonly StructureCommit[],
  picks: readonly number[],
  weekOf: (day: Day) => number,
  weeks: number,
): Replay {
  const live = new Set<string>()
  const counts = new Map<string, number>()
  const lives = new Map<string, { born: Day; died?: Day }>()
  const languages = new Map<string, Pick<UnitTally, "languages">>()
  const samples: Map<string, number>[] = []
  const totals: number[] = []
  const weeklyFiles = new Array<number>(weeks).fill(-1)
  const renames: NonNullable<Moments["renames"]> = []
  const refactors: NonNullable<Moments["refactors"]> = []
  const pickSet = new Set(picks)

  structure.forEach((commit, k) => {
    const before = live.size
    const adds = new Map<string, number>()
    const deletes = new Map<string, number>()
    for (const [status, path] of commit.changes) {
      const unit = unitKey(path)
      if (status === "A" && !live.has(path)) {
        live.add(path)
        counts.set(unit, (counts.get(unit) ?? 0) + 1)
        adds.set(unit, (adds.get(unit) ?? 0) + 1)
        countLanguage(unit, path, 1)
      } else if (status === "D" && live.delete(path)) {
        counts.set(unit, (counts.get(unit) ?? 1) - 1)
        deletes.set(unit, (deletes.get(unit) ?? 0) + 1)
        countLanguage(unit, path, -1)
      }
    }
    const born: string[] = []
    const died: string[] = []
    for (const unit of new Set([...adds.keys(), ...deletes.keys()])) {
      const now = counts.get(unit) ?? 0
      const was = now - (adds.get(unit) ?? 0) + (deletes.get(unit) ?? 0)
      const life = lives.get(unit)
      if (was === 0 && now > 0) {
        if (!life) {
          lives.set(unit, { born: commit.day })
          born.push(unit)
        } else delete life.died
      } else if (was > 0 && now === 0 && life) {
        life.died = commit.day
        died.push(unit)
      }
    }
    // A unit that empties as another is born from as many files: a rename.
    const gone = died.sort((a, b) => (deletes.get(b) ?? 0) - (deletes.get(a) ?? 0))[0]
    const fresh = born.sort((a, b) => (adds.get(b) ?? 0) - (adds.get(a) ?? 0))[0]
    const moved = gone && fresh ? (deletes.get(gone) ?? 0) : 0
    if (gone && fresh && moved >= 5 && (adds.get(fresh) ?? 0) >= moved / 2)
      renames.push({ day: commit.day, from: gone, to: fresh, files: moved })
    else if (k > 0 && commit.changes.length >= Math.max(200, before * 0.1))
      refactors.push({ day: commit.day, files: commit.changes.length })

    weeklyFiles[weekOf(commit.day)] = live.size
    if (pickSet.has(k)) {
      samples.push(new Map([...counts].filter(([, files]) => files > 0)))
      totals.push(live.size)
    }
  })
  // Weeks with no commit keep the last count.
  let last = 0
  for (let i = 0; i < weeks; i++)
    last = weeklyFiles[i] = (weeklyFiles[i] ?? -1) < 0 ? last : (weeklyFiles[i] as number)
  return { samples, totals, weeklyFiles, lives, languages, moments: { renames, refactors } }

  function countLanguage(unit: string, path: string, delta: number): void {
    const known = languages.get(unit) ?? { languages: new Map() }
    languages.set(unit, known)
    const language = languageOf(path)
    const sum = known.languages.get(language.name) ?? { language, bytes: 0 }
    sum.bytes += delta
    known.languages.set(language.name, sum)
  }
}

/** Per-week counts of `weeksOf` items. */
function tally(indices: readonly number[], weeks: number): number[] {
  const out = new Array<number>(weeks).fill(0)
  for (const i of indices) out[i] = (out[i] ?? 0) + 1
  return out
}

const NOREPLY = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/
const BOT = /\[bot\]|^dependabot|^renovate|-bot$|^github-actions?\b|^actions-user$/i

interface Person {
  key: string
  login?: string
  names: Map<string, number>
  commits: number
  first: Day
  last: Day
  weeks: Map<number, number>
  touches: Map<string, number>
}

/**
 * Authors as people: one per email, joined by GitHub login (a noreply address or the API's map)
 * and by an identical full name of two words or more. The top MAX_CONTRIBUTORS by commits.
 */
function contributorsOf(
  authors: readonly AuthorCommit[],
  logins: Record<string, string>,
  weekOf: (day: Day) => number,
): { top: Contributor[]; total: number } {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    let root = key
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    parent.set(key, root)
    return root
  }
  const join = (a: string, b: string): void => {
    const [x, y] = [find(a), find(b)].sort()
    if (x && y && x !== y) parent.set(y, x)
  }
  const byLogin = new Map<string, string>()
  const byName = new Map<string, string>()
  const loginOf = (email: string): string | undefined => logins[email] ?? NOREPLY.exec(email)?.[1]
  for (const commit of authors) {
    const key = commit.email || `name:${commit.name}`
    if (!parent.has(key)) parent.set(key, key)
    const login = loginOf(commit.email)?.toLowerCase()
    if (login) {
      const known = byLogin.get(login)
      if (known) join(known, key)
      else byLogin.set(login, key)
    }
    const name = commit.name.toLowerCase()
    if (name.split(/\s+/).length >= 2) {
      const known = byName.get(name)
      if (known) join(known, key)
      else byName.set(name, key)
    }
  }

  const people = new Map<string, Person>()
  for (const commit of authors) {
    const key = find(commit.email || `name:${commit.name}`)
    let person = people.get(key)
    if (!person) {
      person = {
        key,
        names: new Map(),
        commits: 0,
        first: commit.day,
        last: commit.day,
        weeks: new Map(),
        touches: new Map(),
      }
      people.set(key, person)
    }
    const login = loginOf(commit.email)
    if (login && !person.login) person.login = login
    person.names.set(commit.name, (person.names.get(commit.name) ?? 0) + 1)
    person.commits++
    person.first = Math.min(person.first, commit.day)
    person.last = Math.max(person.last, commit.day)
    const week = weekOf(commit.day)
    person.weeks.set(week, (person.weeks.get(week) ?? 0) + 1)
    for (const unit of new Set(commit.paths.map(unitKey)))
      person.touches.set(unit, (person.touches.get(unit) ?? 0) + 1)
  }

  const ranked = [...people.values()].map((person) => ({ person, name: nameOf(person) }))
  ranked.sort(
    (a, b) => b.person.commits - a.person.commits || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
  const top = ranked.slice(0, MAX_CONTRIBUTORS).map(({ person, name }): Contributor => {
    const active = [...person.weeks.keys()]
    const from = Math.min(...active)
    const to = Math.max(...active)
    let weeks = ""
    for (let w = from; w <= to; w++) weeks += activityChar(person.weeks.get(w) ?? 0)
    const touched = [...person.touches].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    const home = touched[0]
    const also = touched
      .slice(1, 3)
      .filter(([, n]) => home && n >= home[1] * 0.15)
      .map(([unit]) => unit)
    const bot = BOT.test(name) || BOT.test(person.login ?? "") || BOT.test(person.key)
    return {
      name,
      ...(person.login ? { login: person.login } : {}),
      ...(bot ? { bot: true as const } : {}),
      first: person.first,
      last: person.last,
      commits: person.commits,
      from,
      weeks,
      ...(home ? { home: home[0] } : {}),
      ...(also.length > 0 ? { also } : {}),
    }
  })
  return { top, total: people.size }
}

/** A person's most used name (ties: the first alphabetically). */
function nameOf(person: Person): string {
  return (
    [...person.names].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ||
    person.login ||
    "unknown"
  )
}
