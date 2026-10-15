/**
 * A repo's hall (`/hall/<owner>/<repo>`): what the island is built from once its chronicle is read, pure.
 * The chronicle comes first (the loading cover's "Chronicle" step), and only then is the world built from
 * it: the island's size is the repo's file count today, its places are the repo's units (sim
 * `placeSpecs`), its title the repo's name and its subtitle the repo's figures. A repo with no chronicle
 * gets a sketch: the generator's own island at the default size, marked as such on the card.
 */
import {
  bindPlaces,
  type Chronicle,
  filesAt,
  isoOf,
  type PlaceBinding,
  placeSpecs,
  unitsAt,
} from "@guildhall/sim"
import { type HexZones, landTiles, type PlaceSpec } from "@guildhall/world"

/** A repo as the hall builds it: read from its chronicle, or a sketch when it has none. */
export type HallRepo =
  | {
      kind: "chronicled"
      /** "owner/name", as the chronicle spells it. */
      name: string
      files: number
      commits?: number
      contributors: number
      /** First and last year of its history. */
      years: [number, number]
      /** The day the chronicle was read at (its last). */
      day: number
      places: PlaceSpec[]
      /** Where the chronicle came from. */
      source: "cdn" | "local"
      generatedAt: string
      /** Its busiest hands (bots aside), busiest first: the hall's resident guild (residents.ts). */
      hands?: RepoHand[]
    }
  | {
      kind: "sketch"
      name: string
      /** Why there is no chronicle: it was never built, or it could not be fetched (`reason`). */
      why: "not-chronicled" | "unavailable"
      reason?: string
    }

/** One of a repo's busiest hands, as its resident guild draws them (residents.ts). */
export interface RepoHand {
  name: string
  commits: number
  /** The units they touch most, their own first (the chronicle's `home` and `also`). */
  units: string[]
}

/** How many hands a hall keeps for its residents. */
export const HANDS_KEPT = 5
/** A name a machine goes by that the chronicle did not mark a bot. */
const MACHINE = /bot\b|\[bot\]|script$|^github-actions/i

/** The chronicle's busiest people (bots aside), busiest first, at most `HANDS_KEPT`. Pure. */
export function handsOf(c: Pick<Chronicle, "contributors">): RepoHand[] {
  return c.contributors
    .filter((p) => !p.bot && !MACHINE.test(p.name) && !MACHINE.test(p.login ?? ""))
    .sort((a, b) => b.commits - a.commits || a.first - b.first || (a.name < b.name ? -1 : 1))
    .slice(0, HANDS_KEPT)
    .map((p) => ({
      name: p.name,
      commits: p.commits,
      units: [...(p.home ? [p.home] : []), ...(p.also ?? [])],
    }))
}

/**
 * The hall's read of a chronicle at its last day: the repo's figures and its units as places. The size is
 * `filesAt(c, end)`, the same count a history replay builds the island at (hall/history.ts), so a hall and its
 * replay are one island; each place is ranked under the land the island had when its unit was born.
 */
export function repoOf(c: Chronicle, source: "cdn" | "local"): HallRepo {
  const day = c.end
  const files = Math.max(1, filesAt(c, day))
  const units = unitsAt(c, day)
  return {
    kind: "chronicled",
    name: c.repo.name,
    files,
    ...(c.repo.commits !== undefined ? { commits: c.repo.commits } : {}),
    contributors: c.repo.contributors,
    years: [Number(isoOf(c.start).slice(0, 4)), Number(isoOf(c.end).slice(0, 4))],
    day,
    places: placeSpecs(units, landTiles(files), (born) => landTiles(filesAt(c, born)), c.repo.name),
    source,
    generatedAt: c.generatedAt,
    hands: handsOf(c),
  }
}

/** What the island is built with: the chronicle's size and places; a sketch keeps the query's own (`?files=`, default 4,000). */
export function hallBuild(
  repo: HallRepo | null,
  queryFiles: number,
): { files: number; places?: PlaceSpec[]; sketch: boolean } {
  if (repo?.kind === "chronicled") return { files: repo.files, places: repo.places, sketch: false }
  return { files: queryFiles, sketch: repo !== null }
}

const n = (v: number) => v.toLocaleString("en-US")

/** The line under the island's name: the repo's figures, or what a sketch is. */
export function hallSubtitle(repo: HallRepo): string {
  if (repo.kind === "sketch")
    return repo.why === "not-chronicled"
      ? "A sketch: no chronicle for this repo yet, so this is not its island"
      : "A sketch: the chronicle could not be read, so this is not its island"
  const parts = [`${n(repo.files)} files`]
  if (repo.commits !== undefined) parts.push(`${n(repo.commits)} commits`)
  parts.push(`${n(repo.contributors)} contributor${repo.contributors === 1 ? "" : "s"}`)
  parts.push(repo.years[0] === repo.years[1] ? String(repo.years[0]) : `${repo.years[0]} – ${repo.years[1]}`)
  return parts.join(" · ")
}

/** The repo's places bound to the zones built for them (sim `bindPlaces`), for whoever asks where a path lives. */
export function hallBinding(repo: HallRepo, zones: Pick<HexZones, "zones">): PlaceBinding | null {
  return repo.kind === "chronicled" ? bindPlaces(repo.places, zones) : null
}

/** One line per place, biggest first, for the readout and the dossier. */
export function placeRows(places: readonly { label: string; files: number; tiles: number; kind: string }[]) {
  return [...places]
    .sort((a, b) => b.files - a.files || (a.label < b.label ? -1 : 1))
    .map((p) => ({ label: p.label, value: `${n(p.files)} files · ${p.tiles} tiles · ${p.kind}` }))
}
