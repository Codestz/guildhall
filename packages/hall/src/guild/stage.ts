import type { Model, Session } from "@guildhall/core"
import { FATES } from "../world/sites.ts"
import type { Names } from "./casting.ts"
import { type Director, MIN_SHOT_MS } from "./director.ts"
import type { Actor, MomentStream } from "./moments.ts"
import { PARTY_IDLE_MS, type Party } from "./parties.ts"
import { RISE_MS, type Undead } from "./undead.ts"
import { type AdventurerView, GONE_MS, viewsOf } from "./views.ts"

/**
 * The stage's bookkeeping between refreshes: who came on (an entrance), which parties arrived (the
 * director looks), who went out of the gate (a `leave` moment), and the graveyard's last rise.
 * `news(when, now)` is the feed's word on whether something that happened at `when` is news or
 * backlog (guild/feeds/feed.ts).
 */
/** What a refresh of the stage reads: the model and clocks, and how the store names and dates. */
export interface StageInput {
  model: Model
  now: number
  origin: number
  news: (when: number, now: number) => boolean
  previous: readonly AdventurerView[]
  names: Names
  /** Real time the hall has run (ms): the graveyard's animations keep it. */
  realTime: number
  actorOf: (s: Session) => Actor
}

export class Stage {
  /** Set by a reset, cleared by the next refresh: departures found meanwhile are history, not news. */
  rebuilding = false
  /** Subagents already gone out of the gate (a `leave` moment made), until they work again. */
  private left = new Set<string>()
  /** Parties already on the island (root ids), to notice a new one arriving. */
  private arrived = new Set<string>()
  /** Ids on stage at the last refresh, and those who came on since as the hall watched. */
  private present = new Set<string>()
  private entering = new Set<string>()
  /** The graveyard rise last handed to the director as a hint. */
  private glanced = -1

  constructor(
    private readonly director: Director,
    private readonly moments: MomentStream,
    private readonly undead: Undead,
  ) {}

  /** A history rebuild (a seek, a restart, a load): who left or arrived is forgotten. */
  forget(): void {
    this.left.clear()
    this.arrived.clear()
    this.rebuilding = true
  }

  /**
   * One refresh of the stage: the views (with entrances), the graveyard synced to the fallen and its
   * newest rise glanced at, then the parties that arrived and whoever departed. Departures are dated
   * on the run's clock from `origin`.
   */
  refresh(parties: readonly Party[], at: StageInput): AdventurerView[] {
    const views = this.cast(parties, at.model, at.now, at.news, at.previous, at.names)
    this.undead.sync(
      views.filter((view) => view.phase === "failed"),
      at.realTime,
    )
    this.glance()
    this.arrivals(parties)
    this.departures(parties, at.now, at.origin, at.news, at.actorOf)
    this.rebuilding = false
    return views
  }

  /** A new party walks in beside the others: the director looks at its guildmaster (live only). */
  private arrivals(parties: readonly Party[]): void {
    for (const party of parties) {
      if (this.arrived.has(party.id)) continue
      this.arrived.add(party.id)
      if (!this.rebuilding && parties.length > 1 && party.root && party.arriving)
        this.director.hint(party.root.id, 6, 6000, { shot: "follow" })
    }
    if (this.arrived.size > parties.length * 4) {
      const here = new Set(parties.map((p) => p.id))
      for (const id of this.arrived) if (!here.has(id)) this.arrived.delete(id)
    }
  }

  /**
   * The views, with an entrance for whoever came on stage since the last refresh while the hall
   * watched. Nobody walks in on a rebuild (a seek, a load, a loop, a live hello), nor for a session
   * last heard of too long ago to be news (live backlog): they simply stand at their posts.
   */
  private cast(
    parties: readonly Party[],
    model: Model,
    now: number,
    news: (when: number, now: number) => boolean,
    previous: readonly AdventurerView[],
    names: Names,
  ): AdventurerView[] {
    if (this.rebuilding) this.entering.clear()
    else
      for (const party of parties)
        for (const s of party.sessions)
          if (!this.present.has(s.id) && news(s.seen, now)) this.entering.add(s.id)
    const views = viewsOf(model, now, FATES, parties, this.entering, previous, names)
    this.present.clear()
    for (const view of views) this.present.add(view.id)
    for (const id of this.entering) if (!this.present.has(id)) this.entering.delete(id)
    return views
  }

  /**
   * `leave` moments: a finished subagent leaves the stage `GONE_MS` after it ended (see `viewsOf`),
   * and a party's guildmaster when the party goes home (guild/parties.ts PARTY_IDLE_MS). Dated on
   * the run's clock from `start`.
   */
  private departures(
    parties: readonly Party[],
    now: number,
    start: number,
    news: (when: number, now: number) => boolean,
    actorOf: (s: Session) => Actor,
  ): void {
    // News only while it happens: live, a departure found long after its time is backlog (#10).
    const told = (when: number) => !this.rebuilding && news(when, now)
    for (const party of parties) {
      const root = party.root
      if (!root) continue
      if (!party.leaving) this.left.delete(root.id)
      else if (!this.left.has(root.id) && party.idleSince !== undefined) {
        this.left.add(root.id)
        const when = party.idleSince + PARTY_IDLE_MS
        this.moments.add({ ...actorOf(root), kind: "leave", at: when - start, live: told(when) })
      }
    }
    for (const s of parties.flatMap((p) => p.sessions)) {
      if (!s.parentID) continue
      const gone =
        s.parentID !== undefined && s.status === "done" && s.ended !== undefined && now - s.ended > GONE_MS
      if (!gone) {
        this.left.delete(s.id)
        continue
      }
      if (this.left.has(s.id) || s.ended === undefined) continue
      this.left.add(s.id)
      const when = s.ended + GONE_MS
      this.moments.add({ ...actorOf(s), kind: "leave", at: when - start, live: told(when) })
    }
  }

  /** A live rise in the graveyard: the director looks (it used to be the Bard's only glance). */
  private glance(): void {
    const undead = this.undead
    const glance = undead.glance
    if (!glance || glance.at === this.glanced) return
    this.glanced = glance.at
    // The fall is told by the rise: the fallen's interest goes with it to the grave.
    const riser = undead.risers.find((r) => r.state === "rising" && r.since === glance.at)
    this.director.hint(
      { key: "graveyard", x: glance.x, z: glance.z, radius: 3.5 },
      8,
      RISE_MS + MIN_SHOT_MS,
      {
        shot: "close",
        ...(riser ? { absorbs: riser.id } : {}),
      },
    )
  }
}

/** Every session of the island's guild (live: the stage's project; a replay: the whole run). */
export function islandSessions(
  model: Model,
  parties: readonly Party[],
  guilds: ReadonlyMap<string, string>,
): Session[] {
  if (parties.length === 0) return []
  const root = parties.find((p) => p.root)?.root
  const guild = root ? guilds.get(root.id) : undefined
  const sessions = [...model.sessions.values()]
  return guild === undefined ? sessions : sessions.filter((s) => guilds.get(s.id) === guild)
}
