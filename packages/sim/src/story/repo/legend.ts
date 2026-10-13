/**
 * Repo Legends: a repository's history as the Legends book tells it, by era (eras.ts). Each chapter has
 * a title in the hall's voice, its span, a lede, its milestones in words (the first commit, releases,
 * places founded, renamed and gone, new hands, the busiest week, the great reshapings) and the size
 * of the island at its end, which is the picture the book shows: the island at N files is exactly the
 * first N tiles of today's (stable growth), so `files` is all the hall needs to film it.
 *
 * Pure and deterministic: the words are picked by a hash of the repo and the era, never at random,
 * so the same chronicle always reads the same. Unit names are set in code marks (`packages/ui`); the
 * book draws them as code and the card strips them (words.ts `plain`).
 */
import { type Chronicle, DAY_MS, type Day, dayOf, type Release, type Unit } from "../../repo/chronicle.ts"
import { markdownText, numeral } from "../legends.ts"
import { hash, listOf, pick, spell } from "../story.ts"
import { type EraRule, erasOf } from "./eras.ts"
import { type EraFacts, factsOf, founderOf, peakOf, placesNow, reshapedFiles } from "./facts.ts"
import { ageOf, Count, code, dateOf, isRelease, majorName, monthOf, num, plural, spanOf } from "./words.ts"

export type RepoMilestoneKind =
  | "first-commit"
  | "release"
  | "founded"
  | "renamed"
  | "gone"
  | "joined"
  | "busiest"
  | "reshaped"
  /** Where a quiet chapter's work went. */
  | "grew"
  /** The chapter's close: what else rose, was renamed or sank. */
  | "besides"

export interface RepoMilestone {
  /** Epoch ms (the day, at midnight UTC). */
  at: number
  kind: RepoMilestoneKind
  text: string
  /** The unit (package) it is about, when one. */
  unit?: string
}

export interface RepoEra {
  /** `I`, `II`, … */
  numeral: string
  id: string
  title: string
  /** `May 2013 – April 2016`, `2019`, `6 October 2026`. */
  span: string
  /** The release that opened it, when eras are cut by release: `v16.0.0`. */
  release?: string
  /** First and last moment of the era, epoch ms (the end is the last day's last ms). */
  begin: number
  end: number
  /** One or two sentences: how the island changed. */
  lede: string
  /** The island at the era's end: its file count (the picture is `files(t)`). */
  files: number
  /** Commits in the era, when the era is a week or longer (the chronicle counts by the week). */
  commits?: number
  milestones: RepoMilestone[]
}

export interface RepoLegend {
  /** `react/react`. */
  repo: string
  rule: EraRule
  /** `Thirteen years · 19,117 commits · 1,952 contributors · 155 releases`. */
  meta: string
  opening: string
  eras: RepoEra[]
  closing: string
}

export interface RepoStoryOptions {
  /**
   * The place a package stands for on the island (`the Harbour`), when the hall knows it (W1's zones);
   * without it the book says "a new place".
   */
  placeOf?: (unit: string) => string | undefined
  /** Today, for "has lain quiet since": the chronicle's build day when absent. */
  today?: Day
}

const atOf = (day: Day) => day * DAY_MS

export function repoLegendOf(c: Chronicle, options: RepoStoryOptions = {}): RepoLegend {
  const { rule, spans } = erasOf(c)
  const facts = factsOf(c, spans)
  const titles = titlesOf(c, facts)
  const eras = facts.map((f, i): RepoEra => {
    const long = rule !== "day" && f.span.to - f.span.from >= 6
    return {
      numeral: numeral(i + 1),
      id: `era-${i + 1}`,
      title: titles[i] as string,
      span: spanOf(f.span.from, f.span.to, rule === "year"),
      ...(f.span.opens ? { release: f.span.opens.tag } : {}),
      begin: atOf(f.span.from),
      end: atOf(f.span.to + 1) - 1,
      lede: ledeOf(c, f, rule),
      files: f.filesTo,
      ...(long && c.weekly.commits ? { commits: Math.round(f.commits) } : {}),
      milestones: milestonesOf(c, f, options),
    }
  })
  return {
    repo: c.repo.name,
    rule,
    meta: metaOf(c),
    opening: openingOf(c, eras.length, rule),
    eras,
    closing: closingOf(c, options.today),
  }
}

// ── the book's frame ──

export interface RepoFigures {
  age: ReturnType<typeof ageOf>
  commits: number
  contributors: number
  releases: number
  places: number
  files: number
}

export function figuresOf(c: Chronicle): RepoFigures {
  const weekly = (c.weekly.commits ?? []).reduce((a, b) => a + b, 0)
  return {
    age: ageOf(c.end - c.start + 1),
    commits: c.repo.commits ?? weekly,
    contributors: Math.max(c.repo.contributors, c.contributors.filter((p) => !p.bot).length),
    releases: c.releases.filter(isRelease).length,
    places: placesNow(c),
    files: c.repo.files,
  }
}

function metaOf(c: Chronicle): string {
  const f = figuresOf(c)
  return [
    f.age.text.charAt(0).toUpperCase() + f.age.text.slice(1),
    plural(f.commits, "commit"),
    plural(f.contributors, "contributor"),
    ...(f.releases ? [plural(f.releases, "release")] : []),
  ].join(" · ")
}

const RULE_WORDS: Record<EraRule, string> = {
  release: "one for each major release",
  year: "year by year",
  quarter: "season by season",
  month: "month by month",
  week: "week by week",
  day: "day by day",
}

function openingOf(c: Chronicle, chapters: number, rule: EraRule): string {
  const f = figuresOf(c)
  const founder = founderOf(c)
  const seed = hash(c.repo.name)
  const name = c.repo.name
  const began = founder
    ? `${name} began on ${dateOf(c.start)}, with ${founder}’s first commit.`
    : `${name} began on ${dateOf(c.start)}.`
  const humans = c.contributors.filter((p) => !p.bot)
  const alone = humans.length <= 1
  const who = humans[0]?.name ?? founder ?? "one hand"
  const mine = humans[0]?.commits ?? f.commits
  const laid =
    mine < f.commits
      ? `${who} has laid ${num(mine)} of its ${plural(f.commits, "commit")}, the bots the rest`
      : `${who} has laid all ${plural(f.commits, "commit")} alone`
  const since = alone
    ? `In the ${f.age.text} since, ${laid}, and the island has grown to ${num(f.files)} files.`
    : pick(
        [
          `In the ${f.age.text} since, ${num(f.contributors)} hands have laid ${plural(f.commits, "commit")}, and the island has grown to ${num(f.files)} files.`,
          `${Count(f.contributors)} hands have worked on it in the ${f.age.text} since: ${plural(f.commits, "commit")}, and an island of ${num(f.files)} files.`,
        ],
        seed,
      )
  const told = `Its story is told in ${spell(chapters)} ${chapters === 1 ? "chapter" : "chapters"}, ${RULE_WORDS[rule]}.`
  return `${began} ${since} ${told}`
}

function closingOf(c: Chronicle, today?: Day): string {
  const now = today ?? dayOf(c.generatedAt)
  const seed = hash(`${c.repo.name}:end`)
  const files = num(c.repo.files)
  const places = placesNow(c)
  const where = places > 1 ? `${files} files in ${spell(places)} places` : `${files} files`
  if (now - c.end > 180)
    return `The island has lain quiet since ${monthOf(c.end)}: ${where}, and a harbour that waits.`
  return pick(
    [
      `And the work goes on. The last commit came on ${dateOf(c.end)}, and the island stands at ${where}.`,
      `The tale is still being written: the island stands at ${where}, and the last stone was laid on ${dateOf(c.end)}.`,
    ],
    seed,
  )
}

// ── a chapter's lede ──

function lengthWord(f: EraFacts): string {
  const days = f.span.to - f.span.from + 1
  if (days === 1) return "In a single day"
  const age = ageOf(days)
  return `Across ${age.text}`
}

function ledeOf(c: Chronicle, f: EraFacts, rule: EraRule): string {
  const seed = hash(`${c.repo.name}:${f.index}`)
  const a = f.filesFrom
  const b = f.filesTo
  const days = f.span.to - f.span.from + 1
  const commits = rule !== "day" && days >= 7 && c.weekly.commits ? Math.round(f.commits) : undefined
  const over = commits ? `, over ${plural(commits, "commit")}` : ""
  if (f.index === 0) {
    const firstFiles = c.snapshots.files[0] ?? 0
    if (days === 1)
      return `On its first day the island rose from the sea with ${num(firstFiles)} files, and by nightfall it held ${num(b)}.`
    return pick(
      [
        `The island rose from the sea with ${num(firstFiles)} files and grew to ${num(b)}${over}.`,
        `It began as ${num(firstFiles)} files. ${lengthWord(f)} it grew to ${num(b)}${over}.`,
      ],
      seed,
    )
  }
  const change = b - a
  if (Math.abs(change) <= Math.max(2, a * 0.02))
    return `${lengthWord(f)} the island held at about ${num(b)} files${over}: the work went into what was already there.`
  if (change < 0)
    return `${lengthWord(f)} the island shrank from ${num(a)} files to ${num(b)}${over}, as old ground was cleared.`
  const ratio = a > 0 ? b / a : 0
  if (ratio >= 2)
    return pick(
      [
        `${lengthWord(f)} the island more than ${ratio >= 3 ? "tripled" : "doubled"}, from ${num(a)} files to ${num(b)}${over}.`,
        `The island ${ratio >= 3 ? "tripled" : "doubled"} in size, from ${num(a)} files to ${num(b)}${over}.`,
      ],
      seed,
    )
  return pick(
    [
      `${lengthWord(f)} the island grew from ${num(a)} files to ${num(b)}${over}.`,
      `The island grew from ${num(a)} files to ${num(b)}${over}${rule === "release" ? ", release by release" : ""}.`,
    ],
    seed,
  )
}

// ── a chapter's milestones ──

/**
 * A chapter's milestones, as annals in date order: the first commit, new hands, places founded,
 * renamed, reshaped and gone, releases, the busiest week. The biggest of each kind is told by name;
 * the rest close the chapter in one "besides" line, and the minor releases in one more.
 */
function milestonesOf(c: Chronicle, f: EraFacts, options: RepoStoryOptions): RepoMilestone[] {
  const out: RepoMilestone[] = []
  const add = (day: Day, kind: RepoMilestoneKind, text: string, unit?: string) =>
    out.push({ at: atOf(day), kind, text, ...(unit ? { unit } : {}) })
  const seed = (key: string) => hash(`${c.repo.name}:${key}`)

  if (f.firstCommit) {
    const founder = founderOf(c)
    const named = f.original.slice(0, 3).map((u) => code(u.name))
    const more = f.original.length - named.length
    const where = named.length
      ? `, in ${more > 0 ? `${named.join(", ")} and ${spell(more)} more ${more === 1 ? "place" : "places"}` : listOf(named)}`
      : ""
    add(
      f.firstCommit.day,
      "first-commit",
      `${founder ? `${founder} laid the first stone` : "The first stone was laid"}: a first commit of ${num(c.snapshots.files[0] ?? 0)} files${where}.`,
    )
  }

  // New hands.
  const j = f.joined
  if (j.length > 0) {
    const day = Math.min(...j.map((p) => p.first))
    const solo = c.contributors.filter((p) => !p.bot).length === 1
    const names = j.slice(0, 2).map((p) => nameOf(p.name))
    add(
      day,
      "joined",
      solo
        ? c.contributors.some((p) => p.bot)
          ? `No other hand has joined ${names[0]}; only the bots.`
          : `No other hand has joined ${names[0]} at the work.`
        : j.length === 1
          ? `${names[0]} joined the guild.`
          : j.length === 2
            ? `${names[0]} and ${names[1]} joined the guild.`
            : pick(
                [
                  `${Count(j.length)} new hands joined the guild, ${listOf(names)} among them.`,
                  `The guild grew by ${spell(j.length)} hands; ${listOf(names)} would do the most.`,
                ],
                seed(`joined:${f.index}`),
              ),
    )
  }

  // Places founded: the two biggest by name (a day's births together).
  const named: Unit[][] = []
  for (const u of f.founded.slice(0, 2)) {
    const day = named.find((g) => (g[0] as Unit).born === u.born)
    if (day) day.push(u)
    else named.push([u])
  }
  let turn = 0
  for (const group of named) {
    const u = group[0] as Unit
    if (group.length > 1) {
      add(
        u.born,
        "founded",
        `${Count(group.length)} places rose from the sea together: ${listOf(group.map((g) => code(g.name)))}.`,
        u.name,
      )
      continue
    }
    const place = options.placeOf?.(u.name)
    const peak = peakOf(u)
    const grows = peak >= 100 ? `; in time it would hold ${num(peak)} files` : ""
    add(
      u.born,
      "founded",
      place
        ? `${code(u.name)} was founded, and ${place} rose${grows}.`
        : pick(
            [
              `${code(u.name)} was founded, and a new place rose from the sea${grows}.`,
              `A new place rose from the sea: ${code(u.name)}${grows}.`,
              `${code(u.name)} broke new ground${grows}.`,
              `The first stones of ${code(u.name)} were laid${grows}.`,
            ],
            seed(u.name) + turn++,
          ),
      u.name,
    )
  }

  // The first renaming, the great reshapings, the clearing, the biggest place gone.
  const rename = f.renamed[0]
  if (rename)
    add(
      rename.day,
      "renamed",
      pick(
        [
          `${code(rename.from)} took a new name: ${code(rename.to)}.`,
          `${code(rename.from)} became ${code(rename.to)}.`,
        ],
        seed(`${rename.from}>${rename.to}`),
      ),
      rename.to,
    )
  const [great, next] = [...f.reshaped].sort((a, b) => reshapedFiles(b) - reshapedFiles(a))
  if (great && next)
    add(
      great.day,
      "reshaped",
      `${Count(f.reshaped.length)} great reshapings: one commit moved and remade ${num(reshapedFiles(great))} files, another ${num(reshapedFiles(next))}.`,
    )
  else if (great)
    add(
      great.day,
      "reshaped",
      pick(
        [
          `A single commit reshaped ${num(reshapedFiles(great))} files.`,
          `${num(reshapedFiles(great))} files were moved and remade in one commit.`,
        ],
        seed(`refactor:${great.day}`),
      ),
    )
  if (f.shrink)
    add(
      f.shrink.day,
      "reshaped",
      `The island shrank from ${num(f.shrink.from)} files to ${num(f.shrink.to)} as old ground was cleared.`,
    )
  const gone = f.gone[0]
  if (gone) {
    const died = gone.died as Day
    const age = ageOf(died - gone.born).text
    add(
      died,
      "gone",
      pick(
        [
          `${code(gone.name)} sank back into the sea after ${age}.`,
          `${code(gone.name)} was cleared away, ${age} after it was founded.`,
        ],
        seed(`gone:${gone.name}`),
      ),
      gone.name,
    )
  }

  // Releases: the first ever and the majors by name.
  const told = new Set<Release>()
  if (f.firstRelease) {
    told.add(f.firstRelease)
    add(
      f.firstRelease.day,
      "release",
      pick(
        [
          `The first release, ${code(f.firstRelease.tag)}, set sail.`,
          `${code(f.firstRelease.tag)} went out: the first galleon left the harbour.`,
        ],
        seed(f.firstRelease.tag),
      ),
    )
  }
  for (const r of f.majors) {
    if (told.has(r)) continue
    told.add(r)
    add(
      r.day,
      "release",
      pick(
        [
          `${code(r.tag)} set sail, a new major, and the harbour hung out its bunting.`,
          `A new major, ${code(r.tag)}: the town turned out to see the galleon off.`,
          `${code(r.tag)} went out under full sail: the age of ${majorName(r.tag)} began.`,
        ],
        seed(r.tag),
      ),
    )
  }

  if (f.busiest) {
    const b = f.busiest
    add(
      b.day,
      "busiest",
      pick(
        [
          `The busiest week began on ${dateOf(b.day)}: ${plural(b.commits, "commit")}.`,
          `In the week of ${dateOf(b.day)} the hammers never stopped: ${plural(b.commits, "commit")}.`,
        ],
        seed(`busy:${b.day}`),
      ),
    )
  }

  // A quiet chapter still says where the work went: the place that grew the most, when it carried a
  // real share of the growth, else that the work went into the places already standing.
  if (out.length < 2) {
    const g = f.grew
    const growth = f.filesTo - f.filesFrom
    if (g && g.unit !== f.founded[0]?.name && g.to - g.from >= Math.max(3, 0.25 * growth))
      add(
        f.span.to,
        "grew",
        g.from > 0
          ? `${code(g.unit)} grew the most, from ${num(g.from)} files to ${num(g.to)}.`
          : `${code(g.unit)} grew the most: ${plural(g.to, "file")} where there were none.`,
        g.unit,
      )
    else if (f.founded.length === 0)
      add(f.span.to, "grew", "No new place rose; the work went into the ones already standing.")
  }

  out.sort((a, b) => a.at - b.at || ORDER[a.kind] - ORDER[b.kind])

  // The rest, closing the chapter: what else rose, changed its name or sank, and the other releases.
  const end = atOf(f.span.to)
  const others = [
    besidesOf(f.founded.length - named.flat().length, "smaller place", "smaller places", "rose"),
    besidesOf(
      f.renamed.length - (rename ? 1 : 0),
      "more place",
      "more places",
      "took a new name",
      "took new names",
    ),
    besidesOf(f.gone.length - (gone ? 1 : 0), "more place", "more places", "sank", "sank"),
  ].filter(Boolean)
  if (others.length)
    out.push({
      at: end,
      kind: "besides",
      text: `Besides, ${listOf(others)}.`,
    })
  const rest = f.releases.filter((r) => !told.has(r))
  if (rest.length > 0) {
    const first = rest[0] as Release
    const last = rest.at(-1) as Release
    const [more, verb] = told.size > 0 ? [" more", "followed"] : ["", "went out"]
    out.push({
      at: atOf(last.day),
      kind: "release",
      text:
        rest.length === 1
          ? `One${more} release ${verb}: ${code(first.tag)}.`
          : rest.length <= 3
            ? `${Count(rest.length)}${more} releases ${verb}: ${listOf(rest.map((r) => code(r.tag)))}.`
            : `${Count(rest.length)}${more} releases ${verb}, from ${code(first.tag)} to ${code(last.tag)}.`,
    })
  }
  return out
}

/** `24 smaller places rose`, `one more place took a new name`; empty for none. */
function besidesOf(n: number, one: string, many: string, verb: string, verbs = verb): string {
  if (n <= 0) return ""
  return `${spell(n)} ${n === 1 ? one : many} ${n === 1 ? verb : verbs}`
}

const ORDER: Record<RepoMilestoneKind, number> = {
  "first-commit": 0,
  joined: 1,
  founded: 2,
  renamed: 3,
  reshaped: 4,
  gone: 5,
  release: 6,
  busiest: 7,
  grew: 8,
  besides: 9,
}

// ── titles ──

/**
 * Each chapter's title, from what most marks it: the founding, the first release, a great reshaping, a
 * place that rose big, a swelling of the guild, the busiest or quietest stretch, the present. Each
 * kind belongs to the era it fits best, strongest claims first; when that era already has a stronger
 * title, the kind passes to another era only if it has nearly as much of it there (80%: files
 * reshaped, hands joined…), so a lesser era never inherits a title another earned. What is left takes a plain title.
 */
function titlesOf(c: Chronicle, facts: readonly EraFacts[]): string[] {
  const n = facts.length
  const rates = facts.map((f) => f.commits / (f.span.to - f.span.from + 1))
  const sorted = [...rates].sort((a, b) => a - b)
  const median = sorted[Math.floor(n / 2)] ?? 0
  const top = Math.max(...rates)
  const joins = facts.map((f) => f.joined.length)
  const meanJoins = joins.reduce((a, b) => a + b, 0) / Math.max(1, n)
  const daily = facts.every((f) => f.span.to === f.span.from)

  interface Claim {
    era: number
    kind: string
    score: number
    /** How much of the thing it has (files reshaped, hands joined…), to compare eras of one kind. */
    weight: number
    title: string
  }
  const claims: Claim[] = []
  facts.forEach((f, i) => {
    const time = timeWord(f)
    const claim = (kind: string, score: number, title: string, weight = score) =>
      claims.push({ era: i, kind, score, weight, title })
    if (i === 0) claim("first", 100, "The First Stones")
    if (f.firstRelease && i > 0) claim("first-release", 60, "The First Galleon")
    const big = f.founded[0]
    if (big && (peakOf(big) >= 1000 || (peakOf(big) >= 50 && peakOf(big) >= 0.5 * f.filesTo)))
      claim("rise", 45 + Math.log10(peakOf(big)), `The Rise of ${code(shortName(big.name))}`, peakOf(big))
    const reshaped = f.reshaped.reduce((m, r) => Math.max(m, reshapedFiles(r)), 0)
    if (reshaped >= 500 || (reshaped >= 100 && reshaped >= 0.3 * f.filesTo))
      claim("reshaping", 40 + Math.log10(reshaped), "The Great Reshaping", reshaped)
    const major = f.majors.find((r) => r.tag !== f.span.opens?.tag)
    if (major) claim(`sails:${major.tag}`, 33, `${majorName(major.tag)} Sets Sail`)
    if (f.shrink || f.gone.length >= 2) {
      const cleared = f.gone.length + (f.shrink ? 10 : 0)
      claim(
        "clearing",
        38 + Math.min(5, f.gone.length) + (f.shrink ? 10 : 0),
        "The Old Ground Cleared",
        cleared,
      )
    }
    const ratio = f.filesFrom > 0 ? f.filesTo / f.filesFrom : 0
    if (i > 0 && ratio >= 2)
      claim("growing", 34 + ratio, `The Growing ${time === "Months" ? "Season" : time}`, ratio)
    if (f.founded.length >= 3)
      claim("builders", 25 + Math.min(10, f.founded.length), `The ${time} of Building`, f.founded.length)
    if (n > 2 && f.joined.length >= 10 && f.joined.length >= 1.5 * meanJoins)
      claim("surge", 28 + f.joined.length / 10, "The Guild Swells", f.joined.length)
    if (f.span.opens) claim(`major:${f.span.opens.tag}`, 30, `The Age of ${majorName(f.span.opens.tag)}`)
    if (n > 2 && rates[i] === top && top >= 1.3 * median) claim("busy", 26, `The Busy ${time}`)
    if (n > 2 && i > 0 && (rates[i] ?? 0) < 0.5 * median) claim("quiet", 24, `The Quiet ${time}`)
    if (i === n - 1 && i > 0) claim("present", 10, daily ? "The Day Before Today" : "The Present Age")
  })
  claims.sort((a, b) => b.score - a.score || a.era - b.era)
  const out: (string | undefined)[] = facts.map(() => undefined)
  const used = new Set<string>()
  const most = new Map<string, number>()
  for (const c of claims) most.set(c.kind, Math.max(most.get(c.kind) ?? 0, c.weight))
  for (const claim of claims) {
    if (used.has(claim.kind) || out[claim.era] !== undefined) continue
    // a lesser era inherits a kind only when it has nearly as much of it as the era that earned it
    if (claim.weight < 0.8 * (most.get(claim.kind) ?? 0)) continue
    out[claim.era] = claim.title
    used.add(claim.kind)
  }
  // The rest: plain titles, never the same twice.
  let k = hash(c.repo.name)
  const taken = new Set(out.filter(Boolean))
  return out.map((title, i) => {
    if (title) return title
    if (daily) return `The ${ORDINALS[i] ?? `${i + 1}th`} Day`
    const f = facts[i] as EraFacts
    const pool = [
      "Steady Hands",
      "Stone on Stone",
      "Building On",
      "The Work Goes On",
      "Fair Winds",
      `The Middle ${timeWord(f)}`,
    ]
    for (let tries = 0; tries < pool.length; tries++) {
      const t = pool[k++ % pool.length] as string
      if (!taken.has(t)) {
        taken.add(t)
        return t
      }
    }
    return `Chapter ${numeral(i + 1)}`
  })
}

const ORDINALS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
]

function timeWord(f: EraFacts): string {
  const days = f.span.to - f.span.from + 1
  if (days >= 540) return "Years"
  if (days >= 60) return "Months"
  if (days >= 14) return "Weeks"
  return days === 1 ? "Day" : "Days"
}

/** A contributor's name as the book sets it: `Sebastian "Sebbie" Silbermann` with curly quotes. */
export function nameOf(name: string): string {
  return name.replace(/"([^"]+)"/g, "“$1”")
}

/** `packages/react-dom` → `react-dom`, `compiler` → `compiler`. */
export function shortName(unit: string): string {
  return unit.replace(/\/$/, "").split("/").at(-1) ?? unit
}

// ── as text ──

/** The repo legend as Markdown (the book's "Copy as text"); code marks kept, the rest escaped. */
export function repoLegendMarkdown(legend: RepoLegend): string {
  const md = (text: string) =>
    text
      .split(/(`[^`]*`)/)
      .map((part) => (part.startsWith("`") ? part : markdownText(part)))
      .join("")
  const out = [
    `# The Chronicle of ${md(legend.repo)}`,
    "",
    `*${md(legend.meta)}*`,
    "",
    md(legend.opening),
    "",
  ]
  for (const era of legend.eras) {
    out.push(`## ${era.numeral}. ${md(era.title)}`, "")
    const facts = [era.span, era.release ?? "", `${num(era.files)} files at its end`].filter(Boolean)
    out.push(`*${md(facts.join(" · "))}*`, "", md(era.lede), "")
    for (const m of era.milestones) out.push(`- ${md(m.text)}`)
    out.push("")
  }
  out.push("---", "", `*${md(legend.closing)}*`, "")
  return out.join("\n")
}
