import { type ArchetypeId, type CommitRule, castOf, commitRank, type Rank } from "@guildhall/roster"
import type { Chronicle, Contributor, Day } from "../chronicle/format.ts"
import { districtOf } from "../chronicle/reconstruct.ts"
import type { World } from "../world.ts"
import { callingOf } from "./calling.ts"
import { commitsBy, type Presence, presenceAt, STAY_DAYS, WINDOW_DAYS, weeklyTotals } from "./presence.ts"

/**
 * A repo's contributors as its townsfolk (ADR 0013): who is in town on a day, what they are, how
 * seasoned, how busy, and which district they work in. Pure and GPU-free: no three, no React, no
 * clock; the guild's town (guild/town) turns residents into the figures the cast draws.
 *
 *   who        the chronicle's listed contributors (the busiest few hundred) present that day
 *              (presence.ts), at most `cap` of them: the most commits by then, busy ones first
 *   what       the archetype of the folder they commit to most (calling.ts); a bot an Automaton,
 *              anyone with no known home (a quick chronicle) a Wanderer
 *   seasoned   by commits made so far, against the repo's own spread (roster `commitRank`)
 *   where      their home folder's district on today's island (reconstruct.ts `districtOf`), once
 *              it stands; else the first of their other folders' that does; else the harbour
 */

export interface Resident {
  /** "town:<login>": stable for as long as they are in town, never an agent session's id. */
  id: string
  /** Index into the chronicle's `contributors`. */
  index: number
  /** Their GitHub login (the name when none is known). */
  login: string
  name: string
  archetype: ArchetypeId
  bot: boolean
  rank: Rank
  /** Commits made by the day asked. */
  commits: number
  /** Commits in the window up to that day. */
  recent: number
  presence: Presence
  arriving: boolean
  /** Id of the district of today's island they work in. */
  district: string
  /** The chronicle unit they commit to most, when known. */
  home?: string
}

export interface TownOptions {
  /** At most this many residents (the quality tier's). */
  cap?: number
  /** Days that count as "now" (presence.ts). */
  window?: number
  /**
   * Does a district stand on `day` (its land is up)? By default: once the first of its folders is
   * born. The film may ask its own plan instead.
   */
  standing?: (district: string, day: Day) => boolean
}

/** Today's island and a chronicle: everyone the town can hold. */
export const MAX_RESIDENTS = 300
/** The harbour: the root's own files, and where anyone with nowhere else stands works. */
export const HARBOUR = "/"
/** Busy ones are picked over quiet ones, as if they had made this many more commits each recent one. */
const BUSY_WEIGHT = 4

/** The town on `day`: residents in the chronicle's order (the busiest overall first). */
export function townsfolkAt(c: Chronicle, world: World, day: Day, options: TownOptions = {}): Resident[] {
  const town = townOf(c, world)
  const cap = Math.min(MAX_RESIDENTS, options.cap ?? MAX_RESIDENTS)
  const window = options.window ?? WINDOW_DAYS
  const standing =
    options.standing ?? ((district: string, at: Day) => (town.born.get(district) ?? c.start) <= at)
  const present: { resident: Resident; score: number }[] = []
  for (const person of town.people) {
    const now = presenceAt(c, person.contributor, day, window)
    if (!now) continue
    const commits = commitsBy(c, person.contributor, day, person.totals)
    const district = person.districts.find((id) => standing(id, day)) ?? HARBOUR
    present.push({
      score: commits + BUSY_WEIGHT * now.recent,
      resident: {
        id: person.id,
        index: person.index,
        login: person.login,
        name: person.contributor.name,
        archetype: person.archetype,
        bot: person.bot,
        rank: town.rank(commits),
        commits,
        recent: now.recent,
        presence: now.presence,
        arriving: now.arriving,
        district,
        ...(person.contributor.home ? { home: person.contributor.home } : {}),
      },
    })
  }
  if (present.length > cap) {
    present.sort((a, b) => b.score - a.score || a.resident.index - b.resident.index)
    present.length = cap
    present.sort((a, b) => a.resident.index - b.resident.index)
  }
  return present.map((entry) => entry.resident)
}

/**
 * Days that count as "now" in a film running `daysPerSecond`: at least a month, and at least two
 * seconds of film, so nobody is sent back and forth across the island by a single quiet week.
 */
export function filmWindow(daysPerSecond: number): number {
  return Math.max(WINDOW_DAYS, Math.round(daysPerSecond * FILM_WINDOW_S))
}
const FILM_WINDOW_S = 2

/**
 * Every day someone comes or goes (their first commit; STAY_DAYS past their last), sorted: when the
 * ferry is in (presence.ts `ferryAt`).
 */
export function comingsAndGoings(c: Chronicle): Day[] {
  const days = c.contributors.flatMap((person) => [person.first, person.last + STAY_DAYS])
  return days.sort((a, b) => a - b)
}

// ---- What never changes for one chronicle on one island ---------------------------------------

interface Person {
  id: string
  index: number
  login: string
  contributor: Contributor
  archetype: ArchetypeId
  bot: boolean
  totals: Int32Array
  /** Districts they could work in, best first, ending at the harbour. */
  districts: string[]
}

interface Town {
  people: Person[]
  rank: CommitRule
  /** Each district's first day (the earliest birth of the folders it is made of). */
  born: Map<string, Day>
}

const towns = new WeakMap<Chronicle, WeakMap<World, Town>>()

function townOf(c: Chronicle, world: World): Town {
  let byWorld = towns.get(c)
  if (!byWorld) {
    byWorld = new WeakMap()
    towns.set(c, byWorld)
  }
  let town = byWorld.get(world)
  if (!town) {
    town = build(c, world)
    byWorld.set(world, town)
  }
  return town
}

/** GitHub's mark of an app account. */
const BOT = /\[bot\]$/i

function build(c: Chronicle, world: World): Town {
  const districts = new Set(world.repo?.districts.map((district) => district.id) ?? [])
  const unitTo = world.repo ? districtOf(c, { folders: world.repo.folders }) : new Map<string, string>()
  const placeOf = (unit: string): string | undefined => {
    const id = unitTo.get(unit)
    return id !== undefined && districts.has(id) ? id : undefined
  }
  const born = new Map<string, Day>([[HARBOUR, c.start]])
  for (const unit of c.units) {
    const id = placeOf(unit.name)
    if (id !== undefined) born.set(id, Math.min(born.get(id) ?? unit.born, unit.born))
  }
  const language = new Map(c.units.map((unit) => [unit.name, unit.language]))
  const seen = new Set<string>()
  const people = c.contributors.map((contributor, index): Person => {
    const login = contributor.login ?? contributor.name
    let id = `town:${login}`
    if (seen.has(id)) id = `${id}#${index}`
    seen.add(id)
    const bot = contributor.bot === true || BOT.test(login)
    const home = contributor.home
    const declared: ArchetypeId = bot ? "automaton" : home ? callingOf(home, language.get(home)) : "wanderer"
    const units = home ? [home, ...(contributor.also ?? [])] : []
    const places = units.flatMap((unit) => placeOf(unit) ?? [])
    return {
      id,
      index,
      login,
      contributor,
      archetype: castOf(login, declared).archetype.id,
      bot,
      totals: weeklyTotals(contributor),
      districts: [...new Set([...places, HARBOUR])],
    }
  })
  const rank = commitRank(people.filter((p) => !p.bot).map((p) => p.contributor.commits))
  return { people, rank, born }
}
