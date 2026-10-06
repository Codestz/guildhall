import type { GuildStore } from "../../guild/store.ts"
import { NO_TRACES, TraceLedger, type Traces } from "./traces.ts"

/**
 * What the Life layer reads from the guild, refreshed once a frame (before any Life piece draws)
 * and only recomputed when the store has changed (~10×/s). Plain numbers, written in place.
 */
export interface LifeState {
  traces: Traces
  /** Implementers working at the yard right now: the smithy forges for them. */
  forging: number
  /** Explorers chopping at the forest right now: the lumber mill's saw runs. */
  sawing: number
  /** Researchers at the river: the water wheel turns a little faster for them. */
  fishing: number
}

export const life: LifeState = { traces: { ...NO_TRACES }, forging: 0, sawing: 0, fishing: 0 }

const ledger = new TraceLedger()
let version = -1

/** Called once a frame. Cheap when nothing changed. */
export function readGuild(store: GuildStore): void {
  const now = store.snapshot()
  if (now === version) return
  version = now
  let forging = 0
  let sawing = 0
  let fishing = 0
  for (const view of store.views) {
    if (view.phase !== "working" || !view.tool) continue
    if (view.site === "yard") forging++
    else if (view.site === "forest") sawing++
    else if (view.site === "river") fishing++
  }
  life.forging = forging
  life.sawing = sawing
  life.fishing = fishing
  // Prefer the store's own traces when it has them (exact across seeks); else the ledger.
  const own = (store as unknown as { traces?: Traces }).traces
  const traces = own ?? ledger.update(idsOf(store), (id) => store.sessionOf(id))
  Object.assign(life.traces, traces)
}

function* idsOf(store: GuildStore): Generator<string> {
  for (const view of store.views) yield view.id
}
