import type { CSSProperties } from "react"
import type { Party } from "../guild/parties.ts"
import type { GuildStore } from "../guild/store.ts"
import { Icon } from "./icons.tsx"

/**
 * A party's banner: a swallowtail pennant on a short staff, in the party's colour (guild/parties.ts
 * BANNERS). The same mark is on the guildmaster's back in the world and beside each name chip, so
 * the key reads at a glance. Decorative: the party's name always goes with it.
 */
export function Pennant({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg
      className="pennant-glyph"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ "--banner": color } as CSSProperties}
    >
      <path d="M3 1.6v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path
        d="M3.7 2.2h9.6l-2.9 3.15 2.9 3.15H3.7z"
        fill="var(--banner)"
        stroke="rgba(12,9,7,0.7)"
        strokeWidth="0.8"
      />
    </svg>
  )
}

/** Several banners fanned out: "All parties". */
function Pennants({ parties }: { parties: readonly Party[] }) {
  return (
    <span className="pennants" aria-hidden="true">
      {parties.slice(0, 3).map((p) => (
        <Pennant key={p.id} color={p.color} size={14} />
      ))}
    </span>
  )
}

/** What a party is doing, in a word: shown beside its name in the switcher. */
function stateOf(store: GuildStore, party: Party): { label: string; plea: boolean } {
  const views = store.views.filter((v) => v.party === party.id)
  const plea = views.some((v) => v.phase === "waiting")
  if (party.leaving) return { label: "going home", plea }
  if (plea) return { label: "waiting on you", plea }
  if (party.idleSince !== undefined) return { label: "done", plea }
  return { label: `${views.length} at work`, plea }
}

/**
 * The party switcher, and the banner key (roadmap "The harness phase"): shown when more than one
 * conversation is on the island. "All parties" (the default) shows everyone; picking a party
 * follows it — the others stay on the island, but the camera, captions, roster and weather are
 * about the one followed. A group of toggle buttons (aria-pressed), one per party.
 */
export function PartySwitcher({ store, compact = false }: { store: GuildStore; compact?: boolean }) {
  const parties = store.parties
  if (parties.length < 2) return null
  const all = store.following === null
  return (
    <nav className="plaque parties" aria-label="Parties" data-compact={compact}>
      <ul className="party-list">
        <li>
          <button
            type="button"
            className="party-row party-all"
            aria-pressed={all}
            onClick={() => store.follow(null)}
            title="Show every party"
            aria-label="All parties"
          >
            <Pennants parties={parties} />
            <span className="party-name">{compact ? "All" : "All parties"}</span>
            {!compact && <span className="party-state">{parties.length} on the island</span>}
          </button>
        </li>
        {parties.map((party) => {
          const on = store.following === party.id
          const state = stateOf(store, party)
          return (
            <li key={party.id}>
              <button
                type="button"
                className="party-row"
                aria-pressed={on}
                data-leaving={party.leaving}
                onClick={() => store.follow(on ? null : party.id)}
                aria-label={`${party.name} quest, ${state.label}. ${on ? "Following; show all parties." : "Follow this party."}`}
                title={on ? "Following: click to show all parties" : `Follow the ${party.name} quest`}
                style={{ "--banner": party.color } as CSSProperties}
              >
                <Pennant color={party.color} />
                <span className="party-name">{party.name}</span>
                {!compact && <span className="party-state">{state.label}</span>}
                {state.plea && (
                  <span className="party-plea" aria-hidden="true">
                    <Icon.plea />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
