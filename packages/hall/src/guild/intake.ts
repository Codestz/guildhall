import { apply, type Change, emptyModel, type Model, rootOf, type Session } from "@guildhall/core"
import { interestOf } from "@guildhall/roster"
import { type Names, namedOf } from "./casting.ts"
import { LOG_SIZE, type LogEntry, lineOf, redCheck } from "./log.ts"
import { type Actor, before, happenings, type MomentStream } from "./moments.ts"
import { numbered, Ordinals } from "./ordinals.ts"

/**
 * The intake: every change, from whichever feed (guild/feeds), goes through `take` — applied to the
 * model, numbered (guild/ordinals.ts), written to the log, and told as moments (ADR 0008).
 */

/** Who the calm Bard is looking at, how interesting it was, and when (ms since the epoch). */
export interface Focus {
  id: string
  score: number
  at: number
}

/** A new focus is not taken over by a duller change for this long. */
const HOLD_MS = 4000
/** A focus nothing has renewed for this long is let go. */
export const FOCUS_TTL_MS = 9000

export class Intake {
  model: Model = emptyModel()
  /** The log (newest last, at most LOG_SIZE): a new array on every reset. */
  log: LogEntry[] = []
  /** Live: the guild (project) each session was heard from: one island shows one project. */
  readonly guilds = new Map<string, string>()
  /** How the cast is named (guild/casting.ts). */
  names: Names = "world"
  /** Each session's number within its kind and party, for the log and moments (guild/ordinals.ts). */
  private ordinals = new Ordinals()
  /** Tool calls already written to the log: OpenCode 1 re-sends a running call as its output streams. */
  private logged = new Set<string>()

  constructor(private readonly moments: MomentStream) {}

  /** Start over: an empty model and log (the moment stream is rebuilt by the store). */
  reset(): void {
    this.model = emptyModel()
    this.log = []
    this.logged.clear()
    this.guilds.clear()
    this.ordinals.forget()
  }

  rename(names: Names): void {
    this.names = names
    this.ordinals.rename(names)
  }

  /**
   * Take one change, dated on the run's clock from `start`. Returns whether it is a red check
   * (tests, lint, typecheck exiting non-zero): a failure too, though it completed.
   */
  take(change: Change, live: boolean, start: number, guild?: string): boolean {
    if (guild !== undefined && !this.guilds.has(change.id)) this.guilds.set(change.id, guild)
    const was = before(this.model, change)
    const mark = this.ordinals.mark(this.model, change.id)
    apply(this.model, change)
    this.ordinals.took(this.model, change.id, mark)
    this.record(change, start)
    for (const happening of happenings(this.model, change, was)) {
      const s = this.model.sessions.get(happening.id)
      if (!s) continue
      const actor = this.actorOf(s)
      this.moments.add({ ...actor, ...happening, at: change.at - start, live })
      // The fallen keep vigil in the graveyard (guild/undead.ts): the chronicle says so.
      if (happening.kind === "fail" && s.parentID)
        this.write(
          {
            at: change.at - start,
            id: s.id,
            title: actor.title,
            color: actor.color,
            party: actor.master,
          },
          {
            kind: "fail",
            text: "☠ rises in the graveyard",
          },
        )
    }
    return redCheck(change, this.model)
  }

  /** Who a moment is about, named as the log names them. */
  actorOf(s: Session): Actor {
    const named = namedOf(s, this.names)
    return {
      id: s.id,
      agent: s.agent,
      title: s.parentID ? numbered(named.name, this.ordinals.of(this.model, s)) : named.name,
      color: named.archetype.color,
      ...(s.parentID ? { parent: s.parentID } : {}),
      master: rootOf(this.model, s.id),
    }
  }

  private record(change: Change, start: number): void {
    const s = this.model.sessions.get(change.id)
    if (!s) return
    if (change.type === "tool" && change.state === "running") {
      if (this.logged.has(change.call)) return
      this.logged.add(change.call)
    }
    const line = lineOf(change, s)
    if (!line) return
    const named = namedOf(s, this.names)
    const title = s.parentID ? numbered(named.name, this.ordinals.of(this.model, s)) : named.name
    this.write(
      {
        at: change.at - start,
        id: s.id,
        title,
        color: named.archetype.color,
        party: rootOf(this.model, s.id),
      },
      line,
    )
  }

  /** One line onto the log (newest last, at most LOG_SIZE). */
  private write(
    who: Pick<LogEntry, "at" | "id" | "title" | "color" | "party">,
    line: Pick<LogEntry, "kind" | "text">,
  ): void {
    this.log.push({ key: this.log.length ? (this.log.at(-1)?.key ?? 0) + 1 : 1, ...who, ...line })
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE)
  }
}

/**
 * The calm Bard's focus after a live change: the most interesting change wins, but a new focus is
 * held HOLD_MS against duller ones. Following one party, it looks only at that party.
 */
export function focusAfter(
  focus: Focus | null,
  change: Change,
  red: boolean,
  model: Model,
  following: string | null,
): Focus | null {
  const score = red ? 4 : interestOf(change)
  if (score === 0) return focus
  if (following !== null && rootOf(model, change.id) !== following) return focus
  const held = focus && change.at - focus.at < HOLD_MS
  return !focus || !held || score > focus.score ? { id: change.id, score, at: change.at } : focus
}
