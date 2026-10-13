/**
 * The steer moment (V1's hud/Pleas.tsx): whoever waits on a human, pinned as a brass card for as long as
 * they wait. The one HUD element that asks for attention in every mode but Hidden.
 */
import type { CSSProperties } from "react"
import { count, heroTitle } from "./format.ts"
import { Glyphs, Pennant } from "./glyphs.tsx"
import type { PartyView, PleaView } from "./types.ts"

/** Cards shown at once; the rest are counted on the last. */
export const PLEAS_SHOWN = 2

export interface PleasProps {
  pleas: readonly PleaView[]
  parties?: readonly PartyView[]
  /** "Open": the hero's dossier. */
  onOpen: (hero: string) => void
}

export function Pleas({ pleas, parties = [], onOpen }: PleasProps) {
  const shown = pleas.slice(0, PLEAS_SHOWN)
  const more = pleas.length - shown.length
  const partyOf = (id: string | undefined) =>
    parties.length > 1 ? parties.find((p) => p.id === id) : undefined
  return (
    // assertive: a hero is blocked until someone answers
    <div className="hud-pleas" role="status" aria-live="assertive">
      {shown.map(({ hero, ask }, k) => {
        const party = partyOf(hero.party)
        return (
          <button
            key={hero.id}
            type="button"
            className="hud-plea-card"
            onClick={() => onOpen(hero.id)}
            style={{ "--banner": hero.banner } as CSSProperties}
          >
            <span className="hud-plea-mark" aria-hidden="true">
              <Glyphs.plea size={22} />
            </span>
            <span className="hud-plea-text">
              <span>
                {party && (
                  <>
                    <Pennant colour={party.colour} size={14} />{" "}
                  </>
                )}
                <b>{heroTitle(hero)}</b> {party ? <>of the {party.name} quest </> : null}awaits your word
              </span>
              <span className="hud-plea-sub">{ask || "asks for permission"}</span>
            </span>
            <span className="hud-plea-go">
              Open
              {k === shown.length - 1 && more > 0 && <span className="hud-plea-more">+{more}</span>}
            </span>
            {k === shown.length - 1 && more > 0 && (
              <span className="ui-visually-hidden">, and {count(more, "more plea")}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
