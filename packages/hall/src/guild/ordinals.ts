import { type Model, rootOf, type Session } from "@guildhall/core"
import { type Names, namedOf } from "./casting.ts"
import { byJoin } from "./parties.ts"

/**
 * Which of its kind each session is in its party (`Artisan II`), for lines written as events
 * arrive: the same numbers `viewsOf` gives. Counted for the whole model at once and kept — asking
 * one session at a time walked every session's root per log line, which at 300 adventurers was
 * most of a rebuild (docs/perf-budget.md, Chapter 2).
 *
 * Only a session's parent, agent or start time can renumber anyone. A newcomer that joins after
 * everyone of its role in its party (nearly always) just takes the next number; anything else — a
 * session's identity changing, a newcomer out of order, a parent heard of after its children —
 * counts everyone again on the next ask.
 */
export class Ordinals {
  private known = new Map<string, number>()
  private groups = new Map<string, Session[]>()
  /** Every parent id named so far: a newcomer in it adopts sessions already counted. */
  private parents = new Set<string>()
  private size = -1

  /** Counted by the names shown (guild/casting.ts): two source names under one archetype count apart. */
  constructor(private names: Names = "world") {}

  /** Count by other names from the next ask. */
  rename(names: Names): void {
    this.names = names
    this.forget()
  }

  forget(): void {
    this.size = -1
  }

  /** Before a change to `id` is applied: what of it could renumber anyone (undefined: unheard of). */
  mark(model: Model, id: string): string | undefined {
    const s = model.sessions.get(id)
    return s && identityOf(s)
  }

  /** After it is applied, with its `mark`: a newcomer takes the next number; a changed identity recounts. */
  took(model: Model, id: string, mark: string | undefined): void {
    const s = model.sessions.get(id)
    if (!s) return
    if (mark === undefined) this.joined(model, s)
    else if (mark !== identityOf(s)) this.forget()
  }

  private joined(model: Model, s: Session): void {
    const key = keyOf(model, s, this.names)
    const group = this.groups.get(key)
    const last = group?.at(-1)
    if (this.size !== model.sessions.size - 1 || this.parents.has(s.id) || (last && byJoin(last, s) > 0)) {
      this.forget()
      return
    }
    if (group) group.push(s)
    else this.groups.set(key, [s])
    if (s.parentID) this.parents.add(s.parentID)
    this.known.set(s.id, group ? group.length : 1)
    this.size++
  }

  of(model: Model, s: Session): number {
    if (model.sessions.size !== this.size) this.count(model)
    return this.known.get(s.id) ?? 1
  }

  private count(model: Model): void {
    this.known.clear()
    this.groups.clear()
    this.parents.clear()
    this.size = model.sessions.size
    for (const s of model.sessions.values()) {
      const key = keyOf(model, s, this.names)
      const group = this.groups.get(key)
      if (group) group.push(s)
      else this.groups.set(key, [s])
      if (s.parentID) this.parents.add(s.parentID)
    }
    for (const group of this.groups.values()) {
      group.sort(byJoin)
      for (let i = 0; i < group.length; i++) this.known.set((group[i] as Session).id, i + 1)
    }
  }
}

const identityOf = (s: Session): string =>
  `${s.parentID}\u0000${s.agent}\u0000${s.archetype}\u0000${s.started}`

/** Party and name: the root session is the guildmaster whatever agent runs it (guild/casting.ts). */
const keyOf = (model: Model, s: Session, names: Names): string =>
  `${rootOf(model, s.id)}\u0000${namedOf(s, names).name}`
