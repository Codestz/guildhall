import type { Change } from "@guildhall/core"
import { apply, type Model, type Session } from "./model.ts"
import { glance, type Moment, momentsOf } from "./moments.ts"

/**
 * A guild's sessions, built change by change: the model (model.ts) and its moments (moments.ts) in
 * one step, as V1's intake took them. `apply` changes the model in place and returns what the change
 * made happen, so a feed that only wants the moments never has to glance before it applies.
 */
export class GuildModel implements Model {
  readonly sessions = new Map<string, Session>()

  /** Applies one change and returns its moments, in order (none for a repeat). */
  apply(change: Change): Moment[] {
    const before = glance(this, change)
    apply(this, change)
    return momentsOf(before, this)
  }

  /** Applies changes in order and returns every moment they made, in order. */
  applyAll(changes: Iterable<Change>): Moment[] {
    const out: Moment[] = []
    for (const change of changes) out.push(...this.apply(change))
    return out
  }
}
