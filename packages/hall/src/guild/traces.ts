import type { Session } from "@guildhall/core"
import { SITE_DEFS, siteOf } from "../world/sites.ts"

/**
 * Work leaves traces (ADR 0007, Life): every deed that finishes at a job site leaves something
 * behind there, so a glance at the island says how much work each site has seen this run.
 * Pure: a function of the sessions, so live runs, replays and seeks all agree.
 *
 *   forest   grep / glob / list completed (the deeds an explorer chops for)  → a log on the pile
 *   quarry   any deed completed (the quarry pickaxes for every deed)         → a stone on the heap
 *   river    webfetch / websearch completed (the deeds a researcher reels in) → a fish on the rack
 *   tower    any deed completed (the librarian casts for every deed)         → a book on the stacks
 *   proving  bash / shell completed → an arrow in a target; any failed deed → a missed arrow
 *
 * A site is the session's role site (`siteOf`), as the store assigns it: the guildmaster and the
 * keep's roles leave nothing. Which pile each site fills is its registry entry's `trace`
 * (world/sites.ts). The yard is not here: its building already grows (`progress`).
 */
export interface Traces {
  logs: number
  stones: number
  fish: number
  books: number
  hits: number
  misses: number
}

export const NO_TRACES: Traces = { logs: 0, stones: 0, fish: 0, books: 0, hits: 0, misses: 0 }

/** The traces a set of sessions has left. Root sessions (the guildmaster) never count. */
export function tracesOf(sessions: Iterable<Session>): Traces {
  const out = { ...NO_TRACES }
  for (const session of sessions) {
    if (!session.parentID) continue
    const site = siteOf(session.agent, session.archetype)
    const rule = site && SITE_DEFS[site].trace
    if (!rule) continue
    for (const entry of session.entries) {
      if (entry.kind !== "tool") continue
      if (entry.state === "failed") {
        if (rule.missed) out[rule.missed]++
        continue
      }
      if (entry.state !== "completed") continue
      if (rule.tools === true || rule.tools.has(entry.name)) out[rule.pile]++
    }
  }
  return out
}

/** How many of each trace a pile shows at most: past this, the pile is full. */
export const CAPACITY: Traces = { logs: 21, stones: 29, fish: 12, books: 24, hits: 18, misses: 9 }

/** Same counts, capped to what the piles can hold. */
export function shown(traces: Traces): Traces {
  return {
    logs: Math.min(traces.logs, CAPACITY.logs),
    stones: Math.min(traces.stones, CAPACITY.stones),
    fish: Math.min(traces.fish, CAPACITY.fish),
    books: Math.min(traces.books, CAPACITY.books),
    hits: Math.min(traces.hits, CAPACITY.hits),
    misses: Math.min(traces.misses, CAPACITY.misses),
  }
}

/**
 * Remembers every session the cast has shown, so traces outlive the adventurers who left them
 * (a done adventurer drops out of `views` after a while; their logs stay on the pile). A session
 * whose object the store no longer returns (a seek or a new scenario rebuilt the model) is
 * forgotten. Used until the store exposes traces itself.
 */
export class TraceLedger {
  private seen = new Map<string, Session>()

  update(ids: Iterable<string>, sessionOf: (id: string) => Session | undefined): Traces {
    for (const [id, session] of this.seen) if (sessionOf(id) !== session) this.seen.delete(id)
    for (const id of ids) {
      const session = sessionOf(id)
      if (session) this.seen.set(id, session)
    }
    return tracesOf(this.seen.values())
  }
}

// ---- Pile layouts: where the n-th trace goes, in the pile's own space (x right, y up, z out) ----

export type Slot = readonly [x: number, y: number, z: number, turn: number]

/** Integer → [0, 1), stable: piles look the same every run. */
export function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** Logs stacked as a pyramid, rows of 6, 5, 4, 3, 2, 1 (21), each lying along z. */
export function logSlot(i: number, radius = 0.32): Slot {
  let row = 0
  let start = 0
  while (row < 6 && i >= start + (6 - row)) {
    start += 6 - row
    row++
  }
  const across = i - start
  const width = 6 - row
  const x = (across - (width - 1) / 2) * radius * 2
  const y = radius + row * radius * Math.sqrt(3)
  return [x, y, (hash(i) - 0.5) * 0.3, 0]
}

/** A heap of stones: each layer a centre stone and rings round it, smaller as it rises. */
const HEAP: readonly (readonly [count: number, radius: number, layer: number])[] = [
  [1, 0, 0],
  [6, 0.8, 0],
  [10, 1.55, 0],
  [1, 0, 1],
  [6, 0.75, 1],
  [4, 0.4, 2],
  [1, 0, 3],
]
export const HEAP_SIZE = HEAP.reduce((sum, [count]) => sum + count, 0)

export function heapSlot(i: number, size = 0.5): Slot {
  let start = 0
  for (const [count, radius, layer] of HEAP) {
    if (i < start + count) {
      const k = i - start
      const angle = (k / count) * Math.PI * 2 + layer * 0.6 + hash(i) * 0.2
      const r = radius * size * 2
      return [
        Math.cos(angle) * r,
        size * 0.5 + layer * size * 0.95,
        Math.sin(angle) * r,
        hash(i) * Math.PI * 2,
      ]
    }
    start += count
  }
  return [0, size * 0.5 + 4 * size, 0, 0]
}

/** Fish laid side by side in rows of 4 on a rack. */
export function rackSlot(i: number, spacing = 0.42): Slot {
  const row = Math.floor(i / 4)
  const k = i % 4
  return [(k - 1.5) * spacing, 0, (row - 1) * spacing * 1.9, (hash(i) - 0.5) * 0.25]
}

/** Books in stacks of 6, three stacks side by side, then a second row. */
export function stackSlot(i: number, thickness = 0.16): Slot {
  const stack = Math.floor(i / 6)
  const level = i % 6
  const x = ((stack % 3) - 1) * 1.05
  const z = Math.floor(stack / 3) * 1.1
  return [x + (hash(i) - 0.5) * 0.12, thickness / 2 + level * thickness, z, (hash(i + 99) - 0.5) * 0.6]
}

/**
 * An arrow in a target's face, spread round the bullseye: (x, y) on the face from its centre, a
 * small tilt as `turn`. Later arrows land a little further out, like a real round of shooting.
 */
export function hitSlot(i: number, radius = 0.55): Slot {
  const angle = i * 2.39996 + hash(i) * 0.5
  const r = radius * Math.sqrt((i % 6) / 6 + hash(i + 7) * 0.15)
  return [Math.cos(angle) * r, Math.sin(angle) * r, 0, (hash(i + 3) - 0.5) * 0.3]
}

/** A missed arrow, stuck in the ground short of the target: (x, z) in front of it, a lean as `turn`. */
export function missSlot(i: number): Slot {
  const side = (hash(i + 11) - 0.5) * 2.6
  return [side, 0, 0.8 + hash(i + 5) * 1.6, 0.35 + hash(i + 13) * 0.35]
}
