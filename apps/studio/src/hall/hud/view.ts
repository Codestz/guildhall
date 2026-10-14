/**
 * The hall's HUD in history mode, as plain props (plan-hud-events H1; ui never sees the sim): a repo's
 * chronicle and the places its island was built with, read into what the Brand, the Places list, a
 * place's Dossier and the Chronicle feed draw. Pure: no React, no DOM.
 */
import {
  type Chronicle,
  DAY_MS,
  filesAt,
  isoOf,
  type RepoLegend,
  type RepoMilestone,
  type UnitAt,
  unitsAt,
} from "@guildhall/sim"
import type { ChronicleEntry, EntryKind, PlaceView, Stat } from "@guildhall/ui"
import type { PlaceSpec } from "@guildhall/world"
import type { HallRepo } from "../../hexworld/hall.ts"
import type { BuiltPlace } from "../../hexworld/job.ts"
import { kindWord } from "../../hexworld/places.ts"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const n = (v: number) => v.toLocaleString("en-US")

/** `May 2013`, from epoch ms. */
export function monthOf(at: number): string {
  const d = new Date(at)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** `12 May 2013`, from a chronicle day. */
export function dateOf(day: number): string {
  const d = new Date(day * DAY_MS)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** A figure for a narrow card: `7,252`, `19.1k`, `1.2M`. */
export function short(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`
  if (v >= 1e4) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k`
  return n(v)
}

/** `3.1 MB`. */
export function bytesOf(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`
  if (v >= 1e3) return `${Math.round(v / 1e3)} kB`
  return `${v} B`
}

/** Text with the legend's code marks (`packages/ui`) taken out, for a line that draws no code. */
export const plain = (text: string): string => text.replace(/`([^`]+)`/g, "$1")

// ── the brand ──────────────────────────────────────────────────────

export interface BrandView {
  name: string
  source: { kind: "history" | "sketch"; name?: string }
  /** After the source in the status line. */
  status: string
  stats: Stat[]
  /** The about card's lines. */
  description?: string
  /** `Chronicle built 12 Oct 2026 (the studio's copy)`. */
  built?: string
  /** A sketch: why, and what to do. */
  sketch?: { why: "not-chronicled" | "unavailable"; reason?: string }
}

/** The brand of a repo's hall: its name, history or sketch, and its figures (files, commits, hands, years, places). */
export function brandOf(
  repo: HallRepo | null,
  slug: string,
  places: number,
  chronicle?: Pick<Chronicle, "repo"> | null,
): BrandView {
  if (!repo || repo.kind === "sketch")
    return {
      name: repo?.name ?? slug,
      source: { kind: "sketch" },
      status: "no chronicle yet",
      stats: [],
      sketch:
        repo?.kind === "sketch"
          ? { why: repo.why, ...(repo.reason ? { reason: repo.reason } : {}) }
          : { why: "not-chronicled" },
    }
  const years = repo.years[0] === repo.years[1] ? String(repo.years[0]) : `${repo.years[0]}–${repo.years[1]}`
  const stats: Stat[] = [{ label: "files", value: short(repo.files) }]
  if (repo.commits !== undefined) stats.push({ label: "commits", value: short(repo.commits) })
  stats.push({ label: repo.contributors === 1 ? "hand" : "hands", value: short(repo.contributors) })
  const age = Math.max(1, repo.years[1] - repo.years[0])
  stats.push(
    repo.years[0] === repo.years[1]
      ? { label: "since", value: String(repo.years[0]) }
      : { label: age === 1 ? "year" : "years", value: age },
  )
  stats.push({ label: places === 1 ? "place" : "places", value: places })
  const day = repo.generatedAt.slice(0, 10)
  const description = chronicle?.repo.description
  // the name the visitor's link gives (facebook/react), not the one the chronicle recorded (react/react)
  return {
    name: slug,
    source: { kind: "history" },
    status: years,
    stats,
    ...(description ? { description } : {}),
    built: `Chronicle built ${day}${repo.source === "local" ? " (the studio's copy)" : ""}`,
  }
}

// ── places ─────────────────────────────────────────────────────────

/** One row of the Places list. */
export interface PlaceRow {
  /** Index in the built places (what a plate pick names). */
  index: number
  id: string
  label: string
  /** `capital`, `village`, `camp`… */
  kind: string
  files: number
  tiles: number
  /** `packages/react-dom`, or what a pool holds. */
  path: string
  /** Its share of the repo's files, 0..1 (the row's bar). */
  share: number
}

/** The specs the island was built with, by id. */
const specsById = (repo: HallRepo | null): Map<string, PlaceSpec> =>
  new Map(repo?.kind === "chronicled" ? repo.places.map((p) => [p.id, p]) : [])

/** What a place stands for, as a path: the unit, the root, or the pool. */
function pathOf(spec: PlaceSpec | undefined, id: string): string {
  if (spec?.pooled?.length)
    return `${spec.pooled.length} small ${spec.pooled.length === 1 ? "folder" : "folders"}`
  if (id === "/") return "the root's own files"
  return id
}

/** The Places list: every place, biggest first. */
export function placeRows(places: readonly BuiltPlace[], repo: HallRepo | null): PlaceRow[] {
  const specs = specsById(repo)
  const total = places.reduce((sum, p) => sum + p.files, 0) || 1
  return places
    .map((p, index) => ({
      index,
      id: p.id,
      label: p.label,
      kind: kindWord(p.kind),
      files: p.files,
      tiles: p.tiles,
      path: pathOf(specs.get(p.id), p.id),
      share: p.files / total,
    }))
    .sort((a, b) => b.files - a.files || (a.label < b.label ? -1 : 1))
}

/** How the book names a unit's place as the island built it: `the village of react-dom`, `the capital`. */
export function placeLabelOf(places: readonly BuiltPlace[]): (unit: string) => string | undefined {
  return (unit) => {
    const p = places.find((q) => q.id === unit)
    if (!p) return undefined
    const kind = kindWord(p.kind)
    return kind === "capital" ? "the capital" : `the ${kind} of ${p.label}`
  }
}

/** Which place a unit is told at: its own, or the pool it went into. */
export function placeOfUnit(places: readonly BuiltPlace[], repo: HallRepo | null): (unit: string) => number {
  const specs = specsById(repo)
  const at = new Map<string, number>()
  places.forEach((p, k) => {
    at.set(p.id, k)
    for (const u of specs.get(p.id)?.pooled ?? []) at.set(u, k)
  })
  return (unit) => at.get(unit) ?? -1
}

// ── a place's dossier ──────────────────────────────────────────────

export interface PlaceDossierView {
  place: PlaceView
  /** Its files over the history (the sparkline). */
  activity: number[]
  activityLabel: string
  /** The sparkline's peak, in words: `peak 640 files`. */
  activityNote: string
  facts: Stat[]
  /** Its paths, with their files (a pool lists what it holds). */
  files: { path: string; deeds: number }[]
  annals: { key: string; when: string; text: string }[]
}

/** The place up close: what it stands for, its size and birth, its files over time, its annals. */
export function placeDossier(
  place: BuiltPlace,
  repo: HallRepo | null,
  chronicle: Chronicle | null,
  legend: RepoLegend | null,
): PlaceDossierView {
  const spec = specsById(repo).get(place.id)
  const units = spec?.pooled?.length ? spec.pooled : [place.id]
  const alive = chronicle ? unitsAt(chronicle, chronicle.end) : []
  const mine: UnitAt[] = alive.filter((u) => units.includes(u.name))
  const kind = kindWord(place.kind)
  const born = mine.length ? Math.min(...mine.map((u) => u.born)) : undefined
  const bytes = mine.reduce((sum, u) => sum + u.bytes, 0)
  const language = [...mine].sort((a, b) => b.files - a.files)[0]?.language
  const facts: Stat[] = [
    { label: "Files", value: n(place.files) },
    ...(bytes > 0 ? [{ label: "Size", value: bytesOf(bytes) }] : []),
    ...(language ? [{ label: "Language", value: language }] : []),
    ...(born !== undefined ? [{ label: "Born", value: dateOf(born) }] : []),
    { label: "Land", value: `${place.tiles} ${place.tiles === 1 ? "tile" : "tiles"}` },
  ]
  // its files at each of the chronicle's samples, from the first that had any
  const days = chronicle?.snapshots.day ?? []
  const series = days.map((_, i) =>
    (chronicle?.units ?? [])
      .filter((u) => units.includes(u.name))
      .reduce((sum, u) => sum + (u.files[i] ?? 0), 0),
  )
  const first = Math.max(
    0,
    series.findIndex((v) => v > 0),
  )
  const activity = series.slice(first)
  const from = days[first]
  const to = days.at(-1)
  const activityLabel =
    from !== undefined && to !== undefined
      ? `Files, ${monthOf(from * DAY_MS)} – ${monthOf(to * DAY_MS)}`
      : "Files over its history"
  const told = (legend?.eras ?? []).flatMap((era) =>
    era.milestones
      .filter((m) => m.unit !== undefined && units.includes(m.unit))
      .map((m, k) => ({ key: `${era.id}-${k}`, when: monthOf(m.at), text: plain(m.text) })),
  )
  // a place the book tells only among others ("three places rose together") still has its founding
  const annals =
    told.length === 0 && born !== undefined
      ? [
          {
            key: "born",
            when: monthOf(born * DAY_MS),
            text: `${units.length > 1 ? "Its first folder was" : `${place.id} was`} founded.`,
          },
        ]
      : told
  return {
    place: {
      id: place.id,
      name: place.label,
      kind: spec?.capital
        ? "capital · by the Guildhall"
        : spec?.pooled?.length
          ? `${kind} · a pool of small folders`
          : kind,
      package:
        units.length > 1 ? `${units.length} small folders` : place.id === "/" ? "/ (the root)" : place.id,
      ...(place.id === "/" ? { about: "The repo's own files, at its root: where the ships come in." } : {}),
    },
    activity,
    activityLabel,
    activityNote: `peak ${n(Math.max(0, ...activity))} files`,
    facts,
    files: units.map((u) => ({ path: u, deeds: 0 })),
    annals,
  }
}

// ── the chronicle feed ─────────────────────────────────────────────

const KIND: Record<string, EntryKind> = {
  "first-commit": "quest",
  release: "loot",
  founded: "join",
  joined: "join",
  busiest: "deed",
  reshaped: "deed",
  renamed: "deed",
  grew: "deed",
  gone: "fail",
  besides: "thought",
}

/** The era's mark, by its place in the book: the brass of an old age to the paper of today. */
const ERA = "var(--brass)"

/** Entry ids a press can open: an era (the Legends) or a place (its dossier). */
export type FeedPick = { kind: "era"; id: string } | { kind: "place"; index: number }

export function feedPick(id: string): FeedPick | null {
  if (id.startsWith("era:")) return { kind: "era", id: id.slice(4) }
  if (id.startsWith("place:")) return { kind: "place", index: Number(id.slice(6)) }
  return null
}

/**
 * The repo's story as the chronicle feed tells it, oldest first: each era opens with its title and
 * lede, then its milestones; a milestone about a place opens that place.
 */
export function feedOf(legend: RepoLegend, placeOf: (unit: string) => number): ChronicleEntry[] {
  const out: ChronicleEntry[] = []
  for (const era of legend.eras) {
    out.push({
      key: `era-${era.id}`,
      at: era.begin,
      kind: "quest",
      who: `${era.numeral}. ${era.title}`,
      banner: ERA,
      text: `· ${era.span}`,
      hero: `era:${era.id}`,
    })
    era.milestones.forEach((m: RepoMilestone, k) => {
      const at = m.unit !== undefined ? placeOf(m.unit) : -1
      out.push({
        key: `m-${era.id}-${k}`,
        at: m.at,
        kind: KIND[m.kind] ?? "deed",
        who: "",
        banner: ERA,
        text: plain(m.text),
        ...(at >= 0 ? { hero: `place:${at}` } : {}),
      })
    })
  }
  return out.sort((a, b) => a.at - b.at)
}

// ── the growth line ───────────────────────────────────────────────

/** A contributor counts as in town for this many days after a commit (V1 town/presence.ts, a month). */
export const IN_TOWN_DAYS = 30

/**
 * The history bar's line under the date (V1 TimelineGrowth): the contributors so far, those in town
 * (a commit in the last `IN_TOWN_DAYS`, of the chronicle's listed contributors) and the files, on `day`.
 * The contributors so far are the listed ones' share scaled to the repo's total (V1 `contributorsAt`);
 * today, the total.
 */
export function growthLine(
  c: Pick<Chronicle, "contributors" | "repo" | "snapshots" | "weekly" | "start" | "end">,
  day: number,
): string {
  const listed = c.contributors.filter((p) => !p.bot)
  const firsts = listed.filter((p) => p.first <= day).length
  const total = c.repo.contributors
  const so = day >= c.end ? total : listed.length === 0 ? 0 : Math.round((firsts / listed.length) * total)
  const town = listed.filter((p) => p.first <= day && day <= p.last + IN_TOWN_DAYS).length
  const files = day >= c.end ? c.repo.files : filesAt(c, Math.floor(day))
  return `${n(so)} ${so === 1 ? "contributor" : "contributors"} · ${n(town)} in town · ${n(files)} files`
}

/** The feed's stamp: the history's span. */
export function feedStamp(chronicle: Pick<Chronicle, "start" | "end">): string {
  const a = isoOf(chronicle.start).slice(0, 4)
  const b = isoOf(chronicle.end).slice(0, 4)
  return a === b ? a : `${a}–${b}`
}
