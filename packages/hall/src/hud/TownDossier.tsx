import { ARCHETYPES } from "@guildhall/roster"
import { useSyncExternalStore } from "react"
import { RANK_LABEL } from "../guild/casting.ts"
import type { GuildStore } from "../guild/store.ts"
import { town } from "../guild/town/town.ts"
import { isoOf } from "../world/chronicle/format.ts"
import { activityBuckets } from "../world/town/presence.ts"
import type { Resident } from "../world/town/townsfolk.ts"
import { Icon } from "./icons.tsx"
import { Sigil, Status } from "./parts.tsx"
import "./town.css"

/** Spans in the dossier's sparkline. */
const BUCKETS = 48
const SPARK = { width: 240, height: 36 }

const PRESENCE = {
  busy: { label: "At work", tone: "work" },
  quiet: { label: "Resting at the harbour", tone: "idle" },
  leaving: { label: "Leaving by ferry", tone: "idle" },
} as const

/** The town's resident the selection names, re-read whenever the town changes. */
export function useResident(id: string | null): Resident | undefined {
  useSyncExternalStore(town.subscribe, town.snapshot)
  return town.resident(id)
}

/**
 * A contributor up close (ADR 0013): who they are on GitHub, what they are in the town, how
 * seasoned, when they came and last committed, and their commits over the repo's history. No
 * avatar: fetching one from GitHub would tell it who is looking.
 */
export function TownDossier({
  store,
  resident,
  className,
}: {
  store: GuildStore
  resident: Resident
  className?: string
}) {
  const chronicle = town.chronicle
  const person = chronicle?.contributors[resident.index]
  if (!chronicle || !person) return null
  const archetype = ARCHETYPES[resident.archetype]
  const buckets = activityBuckets(chronicle, person, BUCKETS)
  const most = Math.max(1, ...buckets)
  const step = SPARK.width / (buckets.length - 1)
  const line = buckets
    .map(
      (n, i) => `${(i * step).toFixed(1)},${(SPARK.height - 2 - (n / most) * (SPARK.height - 4)).toFixed(1)}`,
    )
    .join(" ")
  const state = PRESENCE[resident.presence]
  const homes = [person.home, ...(person.also ?? [])].filter(Boolean)
  return (
    <aside className={`plaque dossier town-dossier ${className ?? ""}`} aria-labelledby="town-dossier-h">
      <header className="dossier-head">
        <Sigil glyph={archetype.glyph} color={archetype.color} size="lg" />
        <div className="dossier-id">
          <span className="eyebrow">
            {RANK_LABEL[resident.rank]} {archetype.name} · {chronicle.repo.name}
          </span>
          <h2 id="town-dossier-h">{resident.login}</h2>
          {resident.name !== resident.login && <span className="faint">{resident.name}</span>}
          <Status tone={state.tone} label={state.label} />
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => store.select(null)}
          aria-label="Close dossier (Esc)"
          title="Close (Esc)"
        >
          <Icon.close />
        </button>
      </header>

      <dl className="ledger">
        <div>
          <dt>Commits</dt>
          <dd className="mono">{person.commits.toLocaleString("en")}</dd>
        </div>
        <div>
          <dt>First</dt>
          <dd className="mono">{isoOf(person.first)}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd className="mono">{isoOf(person.last)}</dd>
        </div>
        <div>
          <dt>Rank</dt>
          <dd>{RANK_LABEL[resident.rank]}</dd>
        </div>
      </dl>

      <section
        className="town-spark"
        aria-label={`${resident.login}'s commits over ${chronicle.repo.name}'s history`}
      >
        <span className="eyebrow">
          Commits, {isoOf(chronicle.start).slice(0, 4)}–{isoOf(chronicle.end).slice(0, 4)}
        </span>
        <svg viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} role="img" aria-hidden="true">
          <polyline points={line} style={{ stroke: archetype.color }} />
        </svg>
      </section>

      {homes.length > 0 && (
        <section className="quest-card" aria-label="Where they work">
          <span className="eyebrow">Home folder</span>
          <p className="mono">
            {homes[0]}
            {homes.length > 1 && <span className="faint"> · also {homes.slice(1).join(", ")}</span>}
          </p>
        </section>
      )}
    </aside>
  )
}
