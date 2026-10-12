import type { CiState, SeaEvent, SeaRecord } from "@guildhall/core"
import { HARBOUR, type MomentStream, seaHappening } from "./moments.ts"

/**
 * The sea (scene/seas): what happened on GitHub to the guild's project, dated on the run's clock,
 * and its moments. Either feed fills it: a told story knows its whole sea from the start
 * (`sightingsOf`), live it is sighted as the hub sends it (`sight`).
 */

/** Something that happened on GitHub to the guild's project (PROTOCOL.md §7), at run time `at` (ms). */
export interface Sighting {
  event: SeaEvent
  at: number
}

/** Sea events at run time from `start`, oldest first (ties keep their order). */
export function sightingsOf(events: readonly SeaEvent[], start: number): Sighting[] {
  return events.map((event) => ({ event, at: event.at - start })).sort((a, b) => a.at - b.at)
}

/** A sea event taken live, with the time (ms since the epoch) the hall dates it by. */
export interface Sighted {
  event: SeaEvent
  when: number
}

/**
 * Live: sea records from the hub, each event once (a hello repeats what was already sent), added to
 * `sighted`. History (a hello's) keeps GitHub's time; `news` (a sea message) is dated as it arrives
 * (`now`) — the hub polls, so it hears of a push a minute or more after it, and the ship should
 * still be seen sailing. Run time is reckoned from `start`, which a hello may move, so every
 * sighting is re-dated: returns the whole sea.
 */
export function sight(
  sighted: Sighted[],
  records: readonly SeaRecord[],
  news: boolean,
  now: number,
  start: number,
): Sighting[] {
  const known = new Set(sighted.map((s) => s.event.id))
  for (const { event } of records)
    if (!known.has(event.id)) {
      known.add(event.id)
      sighted.push({ event, when: news ? Math.max(event.at, now) : event.at })
    }
  return sighted
    .map(({ event, when }) => ({ event, at: when - start }))
    .sort((a, b) => a.at - b.at || a.event.at - b.event.at)
}

/** Tells the sea's moments once each: what was told since the last rebuild, each branch's last CI. */
export class SeaTeller {
  private told = new Set<string>()
  private ciFinished = new Map<string, CiState>()

  /** `master` names the party the sea's moments are told for (the one the hall is about). */
  constructor(
    private readonly moments: MomentStream,
    private readonly master: () => string,
  ) {}

  /**
   * The sea's moments (guild/moments.ts `seaHappening`) for every sighting up to run time `to` not
   * yet told: a merge, red CI, a recovery, a release.
   */
  tell(sea: readonly Sighting[], to: number, live: boolean): void {
    for (const { event, at } of sea) {
      if (at > to) break
      if (this.told.has(event.id)) continue
      this.told.add(event.id)
      const happening = seaHappening(event, this.ciFinished)
      if (!happening) continue
      this.moments.add({ ...HARBOUR, master: this.master(), ...happening, at, live })
    }
  }

  /** A rebuild: everything is told again as the history is replayed. */
  forget(): void {
    this.told.clear()
    this.ciFinished.clear()
  }
}
