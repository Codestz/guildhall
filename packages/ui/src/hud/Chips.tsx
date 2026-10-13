/**
 * V1's small HUD pieces, fed by props: the party tabs (hud/Parties.tsx PartySwitcher), the "Show HUD · H"
 * pill the Hidden HUD keeps (hud/Hud.tsx), and the replay fast-forward chip (hud/FastForward.tsx).
 */
import type { CSSProperties } from "react"
import { Kbd } from "../components/controls.tsx"
import { Glyphs, Pennant } from "./glyphs.tsx"
import type { HeroView, PartyView } from "./types.ts"

// ── party tabs ───────────────────────────────────────────────────

export interface PartyTabsProps {
  parties: readonly PartyView[]
  /** Everyone on the island: a party's state word and plea mark come from its heroes. */
  heroes: readonly HeroView[]
  /** The party followed, or null for all of them. */
  following: string | null
  onFollow: (id: string | null) => void
  /** A phone: one row of banners, scrolled sideways. */
  compact?: boolean
  className?: string
}

/** What a party is doing, in a word (V1 `stateOf`). */
export function partyState(party: PartyView, heroes: readonly HeroView[]): { label: string; plea: boolean } {
  const own = heroes.filter((h) => h.party === party.id)
  const plea = own.some((h) => h.phase === "waiting")
  if (party.leaving) return { label: "going home", plea }
  if (plea) return { label: "waiting on you", plea }
  if (party.done) return { label: "done", plea }
  return { label: `${own.length} at work`, plea }
}

/**
 * The party switcher: shown when more than one conversation is on the island. "All parties" shows
 * everyone; a party's tab follows it (camera, captions, roster and weather are about that one). Toggle
 * buttons (aria-pressed); the followed party's banner runs down its row's edge.
 */
export function PartyTabs({
  parties,
  heroes,
  following,
  onFollow,
  compact = false,
  className,
}: PartyTabsProps) {
  if (parties.length < 2) return null
  const all = following === null
  return (
    <nav
      className={`ui-panel hud-parties${className ? ` ${className}` : ""}`}
      aria-label="Parties"
      data-compact={compact}
    >
      <ul className="hud-party-list">
        <li>
          <button
            type="button"
            className="hud-party-row hud-party-all"
            aria-pressed={all}
            onClick={() => onFollow(null)}
            title="Show every party"
          >
            <span className="hud-pennants" aria-hidden="true">
              {parties.slice(0, 3).map((p) => (
                <Pennant key={p.id} colour={p.colour} size={14} />
              ))}
            </span>
            <span className="hud-party-name">{compact ? "All" : "All parties"}</span>
            {!compact && <span className="hud-party-state">{parties.length} on the island</span>}
          </button>
        </li>
        {parties.map((party) => {
          const on = following === party.id
          const state = partyState(party, heroes)
          return (
            <li key={party.id}>
              <button
                type="button"
                className="hud-party-row"
                aria-pressed={on}
                data-leaving={party.leaving ?? false}
                onClick={() => onFollow(on ? null : party.id)}
                aria-label={`${party.name} quest, ${state.label}. ${on ? "Following; show all parties." : "Follow this party."}`}
                title={on ? "Following: click to show all parties" : `Follow the ${party.name} quest`}
                style={{ "--banner": party.colour } as CSSProperties}
              >
                <Pennant colour={party.colour} />
                <span className="hud-party-name">{party.name}</span>
                {!compact && <span className="hud-party-state">{state.label}</span>}
                {state.plea && (
                  <span className="hud-party-plea" aria-hidden="true">
                    <Glyphs.plea size={14} />
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

// ── the Hidden HUD's way back ────────────────────────────────────

/**
 * The one control the Hidden HUD keeps: "Show HUD · H", with a plea dot when someone waits on you (the
 * plea is part of the world; the pill says it too, in words, to assistive tech).
 */
export function ShowHudPill({
  onShow,
  pleas = 0,
  className,
}: {
  onShow: () => void
  pleas?: number
  className?: string
}) {
  return (
    <button
      type="button"
      className={`hud-show${className ? ` ${className}` : ""}`}
      onClick={onShow}
      aria-label={`Show the HUD (H)${pleas > 0 ? `, ${pleas} waiting for you` : ""}`}
      title="Show the HUD (H)"
    >
      <Glyphs.hidden size={16} />
      <span>Show HUD</span>
      <Kbd>H</Kbd>
      {pleas > 0 && <i className="hud-show-dot" aria-hidden="true" />}
    </button>
  )
}

// ── fast-forward ─────────────────────────────────────────────────

/** Shown from this multiple up; hidden again below it (V1 `SHOWN_AT`). */
export const FFWD_SHOWN_AT = 1.05

/**
 * The replay's fast-forward mark: a small ⏩ with the speed while the director skips a quiet stretch. Top
 * centre, where the plea banner goes (a plea stops the fast-forward, so they never meet). Kept in the
 * Hidden HUD: it explains why the film suddenly runs fast. Screen readers hear it once per stretch.
 *
 * `rate` is the speed the story runs at now (pace × the director's skip); `skip` the director's skip alone.
 */
export function FastForwardChip({
  rate,
  skip,
  className,
}: {
  rate: number
  skip: number
  className?: string
}) {
  const on = skip > FFWD_SHOWN_AT
  return (
    <>
      <div className={`hud-ffwd${className ? ` ${className}` : ""}`} data-on={on} aria-hidden="true">
        <Glyphs.fast size={14} />
        <span className="hud-ffwd-rate num">{rate.toFixed(1)}×</span>
      </div>
      <p className="ui-visually-hidden" aria-live="polite">
        {on ? "Fast-forwarding a quiet stretch" : ""}
      </p>
    </>
  )
}
