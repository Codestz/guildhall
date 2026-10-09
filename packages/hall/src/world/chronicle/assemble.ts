import {
  type Chronicle,
  type Contributor,
  type Day,
  MAX_MILESTONES,
  type Milestone,
  type MilestoneKind,
  type Release,
  type Unit,
  type Weekly,
} from "./format.ts"

/**
 * What both builders share once they have their samples: units as columns (capped, the smallest
 * pooled), releases tidied, and milestones picked out of the rest.
 */

/** Units kept at most; past this the smallest (by peak files) pool into "<container>/*" or "*". */
export const MAX_UNITS = 64
/** Releases kept at most: past this prereleases go, then all but each major and minor's first. */
export const MAX_RELEASES = 200

export interface UnitSample {
  files: number
  bytes: number
  group?: string
}

export interface UnitLife {
  born: Day
  died?: Day
  language: string
  group?: string
}

/** Unit columns from per-sample sizes and each unit's life; biggest (peak files) first, then name. */
export function unitColumns(
  samples: readonly ReadonlyMap<string, UnitSample>[],
  lives: ReadonlyMap<string, UnitLife>,
): Unit[] {
  const units: Unit[] = [...lives].map(([name, life]) => ({
    name,
    ...(life.group ? { group: life.group } : {}),
    born: life.born,
    ...(life.died !== undefined ? { died: life.died } : {}),
    language: life.language,
    files: samples.map((sample) => sample.get(name)?.files ?? 0),
    bytes: samples.map((sample) => sample.get(name)?.bytes ?? 0),
  }))
  const peak = (unit: Unit): number => Math.max(0, ...unit.files)
  units.sort((a, b) => peak(b) - peak(a) || (a.name < b.name ? -1 : 1))
  if (units.length <= MAX_UNITS) return units
  const kept = units.filter((unit) => unit.name === "/").concat(units.filter((unit) => unit.name !== "/"))
  const keep = kept.slice(0, MAX_UNITS - 1)
  const pools = new Map<string, Unit[]>()
  for (const unit of kept.slice(MAX_UNITS - 1)) {
    const pool = pools.get(unit.group ?? "") ?? []
    pool.push(unit)
    pools.set(unit.group ?? "", pool)
  }
  const pooled = [...pools].map(([group, members]) => pool(group, members))
  return [...keep, ...pooled].sort((a, b) => peak(b) - peak(a) || (a.name < b.name ? -1 : 1))
}

function pool(group: string, members: readonly Unit[]): Unit {
  const sum = (column: "files" | "bytes") =>
    (members[0]?.[column] ?? []).map((_, i) =>
      members.reduce((total, unit) => total + (unit[column][i] ?? 0), 0),
    )
  const deaths = members.map((unit) => unit.died)
  const allDied = deaths.every((died) => died !== undefined)
  return {
    name: group ? `${group}/*` : "*",
    ...(group ? { group } : {}),
    born: Math.min(...members.map((unit) => unit.born)),
    ...(allDied ? { died: Math.max(...(deaths as number[])) } : {}),
    language: members[0]?.language ?? "Other",
    files: sum("files"),
    bytes: sum("bytes"),
    pooled: true,
  }
}

/** GitHub's stats/code_frequency ([week (unix seconds), added, deleted]) as weekly series. */
export function linesWeekly(
  frequency: readonly [number, number, number][],
  weeks: number,
  weekOf: (day: Day) => number,
): Pick<Weekly, "additions" | "deletions"> {
  const additions = new Array<number>(weeks).fill(0)
  const deletions = new Array<number>(weeks).fill(0)
  for (const [week, added, deleted] of frequency) {
    const i = weekOf(Math.floor(week / 86_400))
    additions[i] = (additions[i] ?? 0) + added
    deletions[i] = (deletions[i] ?? 0) + Math.abs(deleted)
  }
  return { additions, deletions }
}

const SEMVER = /^([\w.-]*?[@/-])?v?(\d+)\.(\d+)(?:\.(\d+))?(.*)$/

/**
 * Releases oldest first, capped, majors marked: the first, a new major, or a new minor under 1.0 —
 * on the main line only (a monorepo's "sdk-v1.0.0" is a side package's, not the repo's).
 */
export function tidyReleases(all: readonly Omit<Release, "major">[]): Release[] {
  const sorted = [...all].sort((a, b) => a.day - b.day || (a.tag < b.tag ? -1 : 1))
  const lines = new Map<string, number>()
  for (const release of sorted) {
    const prefix = SEMVER.exec(release.tag)?.[1] ?? ""
    lines.set(prefix, (lines.get(prefix) ?? 0) + 1)
  }
  const main = [...lines].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? ""
  let last: [number, number] | undefined
  const marked = sorted.map((release): Release => {
    const match = SEMVER.exec(release.tag)
    const pre =
      release.prerelease ||
      (match ? /[-+]|alpha|beta|rc|canary|next|experimental/i.test(match[5] ?? "") : false)
    const out: Release = { ...release, ...(pre ? { prerelease: true as const } : {}) }
    if (!match || pre || (match[1] ?? "") !== main) return out
    const version: [number, number] = [Number(match[2]), Number(match[3])]
    const major = !last || version[0] > last[0] || (version[0] === 0 && last[0] === 0 && version[1] > last[1])
    if (!last || version[0] > last[0] || (version[0] === last[0] && version[1] > last[1])) last = version
    return major ? { ...out, major: true } : out
  })
  if (marked.length <= MAX_RELEASES) return marked
  const stable = marked.filter((release) => !release.prerelease)
  if (stable.length <= MAX_RELEASES) return stable
  // Each major and minor's first stable release, the newest kept when still too many.
  const seen = new Set<string>()
  const firsts = stable.filter((release) => {
    const match = SEMVER.exec(release.tag)
    const minor = match ? `${match[1] ?? ""}${match[2]}.${match[3]}` : release.tag
    if (seen.has(minor)) return false
    seen.add(minor)
    return true
  })
  return firsts.slice(-MAX_RELEASES)
}

/** Deep-only moments found in the history: a unit renamed, or one commit reshaping many files. */
export interface Moments {
  renames?: { day: Day; from: string; to: string; files: number }[]
  refactors?: { day: Day; files: number }[]
}

const KIND_ORDER: readonly MilestoneKind[] = [
  "first-commit",
  "release",
  "rename",
  "refactor",
  "born",
  "surge",
]

/** Milestones picked from a chronicle's sections: oldest first, at most MAX_MILESTONES. */
export function milestonesOf(c: Omit<Chronicle, "milestones">, moments: Moments = {}): Milestone[] {
  const picked: Milestone[] = []
  const founder = [...c.contributors].sort((a, b) => a.first - b.first || b.commits - a.commits)[0]
  picked.push({
    day: c.start,
    kind: "first-commit",
    text: founder && founder.first <= c.start + 7 ? `First commit, by ${founder.name}` : "First commit",
  })
  for (const release of c.releases)
    if (release.major) picked.push({ day: release.day, kind: "release", text: `${release.tag} released` })
  for (const rename of top(moments.renames ?? [], 6, (r) => r.files))
    picked.push({
      day: rename.day,
      kind: "rename",
      text: `${rename.from}/ becomes ${rename.to}/`,
      unit: rename.to,
    })
  for (const refactor of top(moments.refactors ?? [], 4, (r) => r.files))
    picked.push({
      day: refactor.day,
      kind: "refactor",
      text: `${refactor.files} files reshaped in one commit`,
    })
  const peak = (unit: Unit): number => Math.max(0, ...unit.files)
  const renamedTo = new Set((moments.renames ?? []).map((rename) => rename.to))
  const born = c.units.filter(
    (unit) => !unit.pooled && unit.name !== "/" && unit.born > c.start && !renamedTo.has(unit.name),
  )
  for (const unit of top(born, 12, peak))
    picked.push({ day: unit.born, kind: "born", text: `${unit.name}/ appears`, unit: unit.name })
  for (const surge of surges(c.contributors, c.start))
    picked.push({ day: surge.day, kind: "surge", text: `${surge.joined} new contributors join` })

  const rank = (m: Milestone): number => KIND_ORDER.indexOf(m.kind)
  const kept = [...picked].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_MILESTONES)
  return kept.sort((a, b) => a.day - b.day || rank(a) - rank(b) || (a.text < b.text ? -1 : 1))
}

/** Quarters (13 weeks from the start) where at least max(5, twice the usual) newcomers joined: the 5 biggest. */
function surges(contributors: readonly Contributor[], start: Day): { day: Day; joined: number }[] {
  const quarters = new Map<number, number>()
  for (const person of contributors) {
    if (person.bot) continue
    const quarter = Math.floor((person.first - start) / 91)
    quarters.set(quarter, (quarters.get(quarter) ?? 0) + 1)
  }
  const counts = [...quarters.values()].sort((a, b) => a - b)
  const median = counts[Math.floor(counts.length / 2)] ?? 0
  const bar = Math.max(5, median * 2)
  const big = [...quarters]
    .filter(([, joined]) => joined >= bar)
    .map(([quarter, joined]) => ({ day: start + quarter * 91, joined }))
  return top(big, 5, (s) => s.joined)
}

/** The `n` biggest by `size`, ties to the earlier. */
function top<T extends { day?: Day; born?: Day }>(
  list: readonly T[],
  n: number,
  size: (item: T) => number,
): T[] {
  return [...list]
    .sort((a, b) => size(b) - size(a) || (a.day ?? a.born ?? 0) - (b.day ?? b.born ?? 0))
    .slice(0, n)
}
