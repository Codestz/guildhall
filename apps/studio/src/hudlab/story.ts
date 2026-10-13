/**
 * The story fixtures (U3): V1's told stories (public/lab/story/<name>.input.json, from main:packages/sim:
 * the Saga, the Seas, the party, the rush, the solo run) told by the sim's story port, exactly as the hall
 * will: `tellAll` → `legendOf` / `legendMarkdown` / `recapOf`, the Narrator's captions, the Saga's acts.
 * The repo's History is those five as past sessions plus Guildhall's own milestones. The place dossier's
 * fixtures are the hex island's places for this repo's packages, with the party story's heroes.
 */
import type { Change, SeaEvent } from "@guildhall/core"
import {
  type Caption,
  type Legend,
  legendMarkdown,
  legendOf,
  Narrator,
  type Recap,
  recapOf,
  type StoryMoment,
  tellAll,
} from "@guildhall/sim"
import type { ChapterView, HeroView, PlaceDeed, PlaceView, RecapView, RepoHistory } from "@guildhall/ui"
import { HISTORY_MARKERS } from "./fixtures.ts"

export const TALES = ["saga", "seas", "party", "rush", "solo"] as const
export type TaleName = (typeof TALES)[number]

interface Input {
  changes: Change[]
  sea: SeaEvent[]
  chapters: { at: number; numeral: string; title: string; tagline: string }[]
}

export interface Told {
  name: TaleName
  legend: Legend | undefined
  markdown: string | undefined
  recap: Recap | undefined
  captions: Caption[]
  chapters: (ChapterView & { at: number })[]
  /** The run time of the last moment. */
  end: number
}

const STORY_NAME: Record<TaleName, string> = {
  saga: "The Saga · Act V",
  seas: "The Seas",
  party: "A Party",
  rush: "The Rush",
  solo: "Alone",
}

export async function tell(name: TaleName): Promise<Told> {
  const input = (await (await fetch(`/lab/story/${name}.input.json`)).json()) as Input
  const teller = tellAll(input.changes, input.sea)
  const sessions = teller.party()
  const history = teller.history
  const legend = legendOf(history, sessions)
  const lookup = { session: (id: string) => teller.session(id) }
  const recap = legend
    ? recapOf({ legend, history, sessions, lookup, guild: "Codestz/guildhall", story: STORY_NAME[name] })
    : undefined
  // The narrator, hearing each moment live at its run time, asked every 50 ms: what the strip would say.
  const narrator = new Narrator(lookup)
  const captions: Caption[] = []
  const end = history.at(-1)?.at ?? 0
  const chapters = input.chapters.map((c) => ({ ...c, at: c.at - teller.start }))
  let i = 0
  let act = 0
  for (let clock = 0; clock <= end + 10_000; clock += 50) {
    while (act < chapters.length && (chapters[act]?.at ?? 0) <= clock)
      narrator.announce(chapters[act++] as ChapterView, clock)
    while (i < history.length && (history[i] as StoryMoment).at <= clock)
      narrator.hear({ ...(history[i++] as StoryMoment), live: true }, clock)
    const caption = narrator.next(clock)
    if (caption) captions.push(caption)
  }
  return {
    name,
    legend,
    markdown: legend ? legendMarkdown(legend) : undefined,
    recap,
    captions,
    chapters,
    end,
  }
}

/** The recap as the card reads it. */
export function recapView(recap: Recap): RecapView {
  return { ...recap, ...(recap.hero ? { hero: { label: recap.hero.label, at: recap.hero.at } } : {}) }
}

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 14)

/** When each told story "happened" on this repo: the History tab's shelf. */
const WHEN: Record<TaleName, number> = {
  solo: day(2025, 2, 11),
  party: day(2025, 6, 3),
  rush: day(2025, 11, 19),
  seas: day(2026, 4, 8),
  saga: day(2026, 9, 27),
}

export function historyOf(told: readonly Told[]): RepoHistory {
  return {
    repo: "Codestz/guildhall",
    sessions: told.flatMap((t) =>
      t.legend
        ? [
            {
              id: t.name,
              title: t.legend.title,
              at: WHEN[t.name],
              outcome: t.legend.outcome,
              party: t.legend.party,
              span: t.legend.span,
              deeds: t.legend.chapters.reduce((n, c) => n + c.deeds.reduce((m, d) => m + d.count, 0), 0),
              tokens: t.legend.tokens,
              cost: t.legend.cost,
              ...(t.recap?.hero ? { hero: t.recap.hero.label } : {}),
            },
          ]
        : [],
    ),
    milestones: HISTORY_MARKERS.map((m) => ({
      at: m.at,
      kind: m.kind === "release" ? ("release" as const) : ("born" as const),
      title: m.label ?? "",
      ...(m.label?.includes("guildhall.codestz.dev") ? { text: "The hall opens to the world." } : {}),
    })),
  }
}

// ── places ─────────────────────────────────────────────────────────

export interface PlaceFixture {
  place: PlaceView
  activity: number[]
  activityLabel: string
  heroes: string[]
  deeds: PlaceDeed[]
  files: { path: string; deeds: number }[]
}

const s = (n: number) => n * 1000
const deed = (
  key: string,
  t: number,
  who: string,
  banner: string,
  text: string,
  hero?: string,
  failed?: boolean,
) => ({
  key,
  at: s(t),
  who,
  banner,
  text,
  ...(hero ? { hero } : {}),
  ...(failed ? { failed } : {}),
})

export const PLACES: Record<string, PlaceFixture> = {
  world: {
    place: {
      id: "world",
      name: "The Capital",
      kind: "Capital district",
      package: "packages/world",
      about: "The island's maker: tiles, sites, the castle's walls and the roads between them.",
    },
    activity: [0, 0, 1, 2, 4, 3, 1, 0, 2, 5, 6, 3, 2, 1, 0, 1, 3, 2],
    activityLabel: "This session, 0:00–1:07",
    heroes: ["query", "gm"],
    deeds: [
      deed("w1", 8, "Scout", "#2fa7a0", "read · hex/sites.ts", "explorer"),
      deed("w2", 14, "Scout", "#2fa7a0", "grep · castleSite", "explorer"),
      deed("w3", 22, "Artisan II", "#e0702f", "edit · hex/collide.ts  +31 −6", "query"),
      deed("w4", 27, "Artisan II", "#e0702f", "bash · bun test packages/world", "query", true),
      deed("w5", 33, "Artisan II", "#e0702f", "edit · hex/collide.ts  +4 −2", "query"),
      deed("w6", 38, "Artisan II", "#e0702f", "bash · bun test packages/world", "query"),
      deed("w7", 44, "Guildmaster", "#d4ad3a", "read · hex/castle.ts", "gm"),
      deed("w8", 51, "Artisan II", "#e0702f", "write · hex/plinth.ts", "query"),
    ],
    files: [
      { path: "packages/world/src/hex/collide.ts", deeds: 3 },
      { path: "packages/world/src/hex/sites.ts", deeds: 1 },
      { path: "packages/world/src/hex/castle.ts", deeds: 1 },
      { path: "packages/world/src/hex/plinth.ts", deeds: 1 },
    ],
  },
  ui: {
    place: { id: "ui", name: "The Market", kind: "Town · market", package: "packages/ui" },
    activity: [0, 1, 0, 0, 2, 1, 0, 0, 0, 1, 0, 0],
    activityLabel: "This session, 0:00–1:07",
    heroes: [],
    deeds: [deed("u1", 30, "Artisan", "#e0702f", "edit · hud/Roster.tsx  +12 −3", "api")],
    files: [{ path: "packages/ui/src/hud/Roster.tsx", deeds: 1 }],
  },
}

/** The place's heroes from the lab's cast. */
export function heroesAt(fixture: PlaceFixture, cast: readonly HeroView[]): HeroView[] {
  return fixture.heroes.flatMap((id) => cast.filter((h) => h.id === id))
}

/** A caption of a kind (or a long one) from a told story, for the strip's still shots. */
export function captionOf(told: Told, kind: string): Caption | undefined {
  if (kind === "long") return [...told.captions].sort((a, b) => b.text.length - a.text.length)[0]
  return told.captions.find((c) => c.kind === kind) ?? told.captions[0]
}
