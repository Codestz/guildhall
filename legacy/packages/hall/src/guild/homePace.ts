import { dayAt, EPILOGUE_S, PROLOGUE_S } from "../world/chronicle/growth.ts"
import type { GrowthFilm } from "../world/chronicle/growthControl.ts"
import { dateLabel, type GrowthCaption } from "../world/chronicle/growthStory.ts"

/**
 * The home page's cut of a repo's growth film (guild/homeShow.ts): the whole film in about CUT_S of
 * play. It lingers (SLOW× film speed) on the beats worth seeing, the first commit, the first
 * districts rising and the castle raised, each told by a caption, and hurries through the years
 * between at whatever speed makes the total come out. Pure: a function of the film.
 */

/** About how long the cut plays, seconds. */
export const CUT_S = 20
/** Film speed through a beat. */
const SLOW = 2
/** Film seconds a beat lingers (and its caption stays up). */
const BEAT_S = 4
/** The districts told after the first commit. */
const DISTRICTS = 2
/** The fastest the years go by, whatever the budget says. */
const FAST_MAX = 9

export interface Beat {
  /** Film time the beat starts and ends. */
  from: number
  to: number
  caption: GrowthCaption
}

export interface Cut {
  beats: Beat[]
  /** Film seconds per second of play at film time `t` (growth.pace). */
  pace: (t: number) => number
}

export function cutOf(film: GrowthFilm): Cut {
  const { plan, story } = film
  const span = film.end - film.start
  const beats: Beat[] = []
  const add = (caption: GrowthCaption, at = caption.t): void => {
    const from = Math.max(0, at - 0.5)
    if (!beats.some((beat) => from < beat.to && from + BEAT_S > beat.from))
      beats.push({ from, to: from + BEAT_S, caption })
  }
  const first = story.captions.find((caption) => caption.kind === "first-commit")
  if (first) add(first)
  for (const born of story.captions.filter((caption) => caption.kind === "born").slice(0, DISTRICTS))
    add(born)
  const castle = [...story.moments].reverse().find((moment) => /castle is raised/i.test(moment.text))
  if (castle)
    add(
      {
        t: castle.t,
        kind: "built",
        when: dateLabel(dayAt(plan, castle.t), span),
        text: castle.text,
        tagline: "Raised by the repo's own hands",
      },
      castle.t - 1,
    )
  beats.sort((a, b) => a.from - b.from)

  // The opening (the harbour rising) and the closing hold are slow too: the island is whole at the end.
  const slow: Array<[number, number]> = [
    [0, PROLOGUE_S + 1.5],
    ...beats.map((beat): [number, number] => [beat.from, beat.to]),
    [plan.duration - EPILOGUE_S - 0.5, plan.duration],
  ]
  const merged: Array<[number, number]> = []
  for (const [from, to] of slow.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1]
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  const slowFilm = merged.reduce((sum, [from, to]) => sum + (to - from), 0)
  const budget = Math.max(2, CUT_S - slowFilm / SLOW)
  const fast = Math.min(FAST_MAX, Math.max(SLOW, (plan.duration - slowFilm) / budget))
  return {
    beats,
    pace: (t) => (merged.some(([from, to]) => t >= from && t < to) ? SLOW : fast),
  }
}

/** The beat being told at film time `t`, if any. */
export function beatAt(cut: Cut, t: number): Beat | undefined {
  return cut.beats.find((beat) => t >= beat.from && t < beat.to)
}
