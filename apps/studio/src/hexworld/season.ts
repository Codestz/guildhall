/**
 * The island's season (render season.ts), from the repo's own dates (decisions 2026-10-14): what picks it,
 * first match wins —
 *
 *   a pin       Settings' Season lever, or `?season=spring|summer|autumn|winter|<0…4>|<yyyy-mm-dd>`
 *   a source    what the screen says: a hall's timeline date (its history, so Watch it grow cycles the
 *               years), a told story's own season (`storySeason`)
 *   today       the viewer's date (live)
 *
 * `?season=auto` (or none) leaves it to the source. The drive follows a playing history day by day and
 * eases a jump (a seek, a pick) round the shortest way; the first season lands at once.
 *
 * With it come the season's particles (workfx, near the camera only): leaves falling from the trees in
 * autumn, petals off the blossoming ones in spring, smoke from the chimneys in winter (`seasonFx`).
 *
 * `window.guildhall.ext.season`: `set(pick)` (a name, a wheel value, a date, "auto"), `at()`, `stats()`.
 */
import {
  createSeasonDrive,
  type SeasonDrive,
  type SeasonName,
  type SeasonWeights,
  type Stage,
  seasonName,
  seasonOfDate,
  seasonPinOf,
} from "@guildhall/render"
import { param } from "../params.ts"

/** What the screen says the season is (a wheel value 0 … 4), or null: today's. */
export type SeasonSource = () => number | null

export interface SeasonMount {
  drive: SeasonDrive
  /** The screen's own season (a hall's date, a story's); null: today's. `now`: land on it at once. */
  setSource(source: SeasonSource | null, now?: boolean): void
  /** Settings' pick: a season's name, or "auto" (the source, else today). */
  pin(pick: SeasonName | "auto"): void
  /** The pick in force ("auto" unless pinned). */
  pinned(): SeasonName | "auto"
  /** The season shown now, by name (the nearest heart). */
  name(): SeasonName
  weights(): SeasonWeights
  dispose(): void
}

/** The season a told story is set in, by its mood (sim stories). Unknown or the demo guild: null (today's). */
const STORY_SEASONS: Readonly<Record<string, SeasonName>> = {
  saga: "autumn",
  events: "winter",
  solo: "spring",
  party: "summer",
  parties: "summer",
  rush: "autumn",
  seas: "summer",
  factions: "spring",
}

export function storySeason(story: string | null | undefined): SeasonName | null {
  return (story && STORY_SEASONS[story]) || null
}

/** The wheel value of a date (epoch ms), or null for none. */
export function timelineSeason(date: number | null): number | null {
  return date === null || !Number.isFinite(date) ? null : seasonOfDate(date)
}

export function mountSeason(parts: {
  stage: Pick<Stage, "onFrame">
  query: Pick<URLSearchParams, "get">
  /** Today, epoch ms (tests; default `Date.now`). */
  now?: () => number
}): SeasonMount {
  const now = parts.now ?? Date.now
  const asked = seasonPinOf(param(parts.query, "season"))
  let pinAt: number | null = typeof asked === "number" ? asked : null
  let source: SeasonSource | null = null
  const want = () => pinAt ?? source?.() ?? seasonOfDate(now())
  const drive = createSeasonDrive(parts.stage, want())
  // the source moves with its clock: read it each frame (a few multiplies), the drive follows or eases
  const off = parts.stage.onFrame(() => drive.set(want()))
  const ext = (globalThis as { guildhall?: { ext: Record<string, unknown> } }).guildhall?.ext
  const mount: SeasonMount = {
    drive,
    setSource(next, now = false) {
      source = next
      drive.set(want(), now)
    },
    pin(pick) {
      const v = seasonPinOf(pick)
      pinAt = typeof v === "number" ? v : null
      drive.set(want())
    },
    pinned: () => (pinAt === null ? "auto" : seasonName(pinAt)),
    name: () => seasonName(drive.at()),
    weights: () => drive.weights(),
    dispose() {
      off()
      drive.dispose()
      if (ext?.season) delete ext.season
    },
  }
  if (ext)
    ext.season = {
      /** A name, a wheel value, a date or "auto"; `now`: land at once (shots). */
      set(pick: string, now = true) {
        const v = seasonPinOf(pick)
        pinAt = typeof v === "number" ? v : null
        drive.set(want(), now)
      },
      at: () => drive.at(),
      stats: () => drive.stats(),
    }
  return mount
}
