import { join } from "node:path"
import type { Change, SeaEvent } from "@guildhall/core"
import {
  type Caption,
  legendOf,
  Narrator,
  recapOf,
  type StoryMoment,
  type Teller,
  tellAll,
} from "../src/index.ts"

/**
 * V1's told stories as fixtures (fixtures/story/<name>.input.json: main:packages/sim's party, saga,
 * seas, rush and solo, as their changes and GitHub sea), told whole: what V1's tests got from
 * `GuildStore.load(story)` and playing it through.
 */
export type StoryName = "party" | "saga" | "seas" | "rush" | "solo"

export const STORY_DIR = join(import.meta.dir, "fixtures", "story")

export interface StoryInput {
  changes: Change[]
  sea: SeaEvent[]
  chapters: { at: number; numeral: string; title: string; tagline: string; hour: number }[]
}

export async function storyInput(name: StoryName): Promise<StoryInput> {
  return (await Bun.file(join(STORY_DIR, `${name}.input.json`)).json()) as StoryInput
}

export async function played(name: StoryName): Promise<Teller> {
  const input = await storyInput(name)
  return tellAll(input.changes, input.sea)
}

/** The book and the card at the story's end. */
export async function bookOf(name: StoryName) {
  const teller = await played(name)
  const sessions = teller.party()
  const legend = legendOf(teller.history, sessions)
  if (!legend) throw new Error(`${name}: no legend`)
  const recap = recapOf({
    legend,
    history: teller.history,
    sessions,
    lookup: { session: (id) => teller.session(id) },
    guild: "acme/shop",
    story: name,
  })
  return { teller, sessions, legend, recap }
}

/**
 * Every caption a narrator tells while the story plays, hearing each moment live at its run time
 * and asked every 50 ms, up to run time `ms` (all of it, and 30 s more, by default).
 */
export function captionsOf(teller: Teller, ms?: number): { at: number; caption: Caption }[] {
  const narrator = new Narrator({ session: (id) => teller.session(id) })
  const history = teller.history
  const end = ms ?? (history.at(-1)?.at ?? 0) + 30_000
  const out: { at: number; caption: Caption }[] = []
  let i = 0
  for (let clock = 0; clock <= end; clock += 50) {
    while (i < history.length && (history[i] as StoryMoment).at <= clock) {
      narrator.hear({ ...(history[i] as StoryMoment), live: true }, clock)
      i++
    }
    const caption = narrator.next(clock)
    if (caption) out.push({ at: clock, caption })
  }
  return out
}
