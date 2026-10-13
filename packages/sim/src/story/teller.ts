// From V1 hall (main:packages/hall/src/guild/intake.ts `take`/`actorOf`, moments.ts `Moment`/`HARBOUR`,
// casting.ts `namedOf`, ordinals.ts, parties.ts `byJoin`, sea.ts `SeaTeller`): what the story tells
// is a moment with a name on it.
import type { Change, CiState, SeaEvent } from "@guildhall/core"
import { apply, emptyModel, type Model, type Session } from "../guild/model.ts"
import { glance, type Happening, momentsOf, type SeaMomentKind, seaMomentOf } from "../guild/moments.ts"
import { rootOf } from "../guild/views.ts"
import { ARCHETYPES, type Archetype } from "../roster/archetypes.ts"
import { castOf } from "../roster/cast.ts"

/**
 * The told moment: the sim's moment (guild/moments.ts) with who it is about, named as the hall names
 * them at that moment (`Implementer II`, in the role's colour), the party it belongs to, and the
 * session's run time. Captions, the Legends book and the Chronicle card read these.
 */

/** Who a moment is about, as the hall names them at that moment. */
export interface Actor {
  /** Session id. */
  id: string
  /** The source's agent name (`guild-implementer`). */
  agent: string
  /** The hall's name for them, numbered when the role repeats (`Implementer II`). */
  title: string
  /** The role's colour. */
  color: string
  /** The session that sent them; absent for a guildmaster. */
  parent?: string
  /** The guildmaster at the top of their party (themselves, for a guildmaster). */
  master: string
}

/** What happened: the sim's happenings, plus V1's `leave` and the sea's news. */
export type StoryHappening = Happening | { kind: "leave" } | { kind: SeaMomentKind; event: SeaEvent }

/** One told moment. */
export type StoryMoment = Actor & {
  /** Grows by one for every moment the teller ever makes: a cursor never repeats. */
  seq: number
  /** Run time, ms (from the session's first change). */
  at: number
  /** Happened as the hall watched (true), or rebuilt from history (a seek, a replay): only live is news. */
  live: boolean
} & StoryHappening

/** Who a sea moment is about: the harbour, in the guild's own gold. */
export const HARBOUR: Omit<Actor, "master"> = { id: "sea", agent: "", title: "Harbour", color: "#dcb662" }

/** Two ways to name the cast: the world's archetypes (`Warden`), or the source's own names (`Verifier`). */
export type Names = "world" | "source"

/** A party's root is its Guildmaster, whatever agent runs it; anyone else is cast by the roster. */
export function namedOf(
  s: Pick<Session, "agent" | "archetype" | "parentID">,
  names: Names = "world",
): { archetype: Archetype; name: string } {
  const cast = castOf(s.agent, s.archetype)
  const archetype = s.parentID ? cast.archetype : ARCHETYPES.guildmaster
  return { archetype, name: names === "source" && s.parentID ? cast.sourceTitle : archetype.name }
}

/** Join order: who started first, then by id. */
export function byJoin(a: Session, b: Session): number {
  return a.started - b.started || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
]

function roman(n: number): string {
  let rest = Math.max(1, Math.floor(n))
  let out = ""
  for (const [value, letters] of ROMAN)
    while (rest >= value) {
      out += letters
      rest -= value
    }
  return out
}

/** `Implementer`, `Implementer II`: the first of a role keeps its plain name. */
export function numbered(title: string, ordinal: number): string {
  return ordinal > 1 ? `${title} ${roman(ordinal)}` : title
}

/**
 * Which of its role `s` is in its party, by join order (1-based). V1 kept these counted (ordinals.ts)
 * for 300-adventurer runs; the count here is the same number, asked per moment.
 */
export function ordinalOf(model: Model, s: Session, names: Names = "world"): number {
  const root = rootOf(model, s.id)
  const title = namedOf(s, names).name
  let n = 1
  for (const other of model.sessions.values()) {
    if (other === s || rootOf(model, other.id) !== root) continue
    if (namedOf(other, names).name === title && byJoin(other, s) < 0) n++
  }
  return n
}

/** Who a moment is about, named as the log names them. */
export function actorOf(model: Model, s: Session, names: Names = "world"): Actor {
  const named = namedOf(s, names)
  return {
    id: s.id,
    agent: s.agent,
    title: s.parentID ? numbered(named.name, ordinalOf(model, s, names)) : named.name,
    color: named.archetype.color,
    ...(s.parentID ? { parent: s.parentID } : {}),
    master: rootOf(model, s.id),
  }
}

/** Something that happened on GitHub to the guild's project, at run time `at` (ms). */
export interface Sighting {
  event: SeaEvent
  at: number
}

/**
 * The teller: changes in, told moments out, the way V1's hall made them (intake.ts `take` and the
 * sea teller). Pure but for its own state: the same changes and sightings in the same order always
 * tell the same moments. `start` is the run's origin (its first change's `at`).
 */
export class Teller {
  readonly model: Model = emptyModel()
  readonly history: StoryMoment[] = []
  private seq = 1
  private readonly finished = new Map<string, CiState>()

  constructor(
    readonly start: number,
    private readonly names: Names = "world",
  ) {}

  /** One change, applied to the model, and the moments it made. */
  take(change: Change, live = false): StoryMoment[] {
    const before = glance(this.model, change)
    apply(this.model, change)
    const out: StoryMoment[] = []
    for (const m of momentsOf(before, this.model)) {
      const s = this.model.sessions.get(m.id)
      if (!s) continue
      const { id: _, at: __, ...happening } = m
      out.push(this.add({ ...actorOf(this.model, s, this.names), ...happening, at: m.at - this.start, live }))
    }
    return out
  }

  /** A sea event reached at run time `at`: its moment, if it makes one (a push sails quietly). */
  sight({ event, at }: Sighting, live = false): StoryMoment | undefined {
    const sea = seaMomentOf(event, this.finished)
    if (!sea) return undefined
    return this.add({ ...HARBOUR, master: this.root() ?? "", kind: sea.kind, event, at, live })
  }

  /** The guildmaster: the first session without a parent. */
  root(): string | undefined {
    for (const s of this.model.sessions.values()) if (!s.parentID) return s.id
    return undefined
  }

  /** The party under `master` (the guildmaster by default), in join order. */
  party(master = this.root()): Session[] {
    if (master === undefined) return []
    return [...this.model.sessions.values()].filter((s) => rootOf(this.model, s.id) === master).sort(byJoin)
  }

  session(id: string): Session | undefined {
    return this.model.sessions.get(id)
  }

  private add(moment: Actor & { at: number; live: boolean } & StoryHappening): StoryMoment {
    const made = { ...moment, seq: this.seq++ } as StoryMoment
    this.history.push(made)
    return made
  }
}

/**
 * A whole session told at once: its changes in order, the sea sighted as run time reaches it. What a
 * seek, a replay or a fixture gives the book and the card.
 */
export function tellAll(
  changes: readonly Change[],
  sea: readonly SeaEvent[] = [],
  names: Names = "world",
): Teller {
  const start = changes[0]?.at ?? 0
  const teller = new Teller(start, names)
  const sightings = sea.map((event) => ({ event, at: event.at - start })).sort((a, b) => a.at - b.at)
  let next = 0
  const reach = (to: number) => {
    while (next < sightings.length && (sightings[next] as Sighting).at <= to)
      teller.sight(sightings[next++] as Sighting)
  }
  for (const change of changes) {
    reach(change.at - start)
    teller.take(change)
  }
  reach(Number.POSITIVE_INFINITY)
  return teller
}
