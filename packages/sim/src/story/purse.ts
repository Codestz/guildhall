import type { Change } from "@guildhall/core"

/**
 * A party's purse over time (the raid's treasury rule, story/worldEvents.ts): every session's running
 * totals (`usage` changes) as they came, and who sent whom (`session` changes), so `at(master, t)` says
 * what the party under `master` had spent by run time `t`. A live hall, a replay and a told story read
 * it alike, and causally: a seek back reads the purse as it stood then, never the head's.
 */
export class PurseBook {
  private readonly parents = new Map<string, string | undefined>()
  /** Per session, its totals in time order: [at, tokens, cost]. */
  private readonly spent = new Map<string, [number, number, number][]>()

  /** Takes a change (anything but `session` and `usage` is ignored). */
  take(change: Change): void {
    if (change.type === "session") {
      if (!this.parents.has(change.id)) this.parents.set(change.id, change.parentID)
      return
    }
    if (change.type !== "usage") return
    const list = this.spent.get(change.id) ?? []
    const last = list.at(-1)
    const row: [number, number, number] = [
      Math.max(change.at, last?.[0] ?? Number.NEGATIVE_INFINITY),
      change.tokens ?? last?.[1] ?? 0,
      change.cost ?? last?.[2] ?? 0,
    ]
    list.push(row)
    this.spent.set(change.id, list)
  }

  private rootOf(id: string): string {
    let at = id
    for (let k = 0; k < 64; k++) {
      const up = this.parents.get(at)
      if (up === undefined) return at
      at = up
    }
    return at
  }

  /** What the party under `master` had spent by `t` (undefined: nothing known of it). */
  at(master: string, t: number): { tokens: number; cost: number } | undefined {
    let tokens = 0
    let cost = 0
    let any = false
    for (const [id, list] of this.spent) {
      if (this.rootOf(id) !== master) continue
      // the last row at or before t
      let lo = 0
      let hi = list.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if ((list[mid] as [number, number, number])[0] <= t) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      if (found < 0) continue
      const row = list[found] as [number, number, number]
      tokens += row[1]
      cost += row[2]
      any = true
    }
    return any ? { tokens, cost } : undefined
  }
}
