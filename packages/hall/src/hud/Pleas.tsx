import type { CSSProperties } from "react"
import type { GuildStore } from "../guild/store.ts"
import { Icon } from "./icons.tsx"
import { Pennant } from "./Parties.tsx"

/**
 * The steer moment: whoever is waiting on a human, pinned top-centre for as long as they wait.
 * The only HUD element that asks for attention in every mode but Hidden.
 */
export function Pleas({ store }: { store: GuildStore }) {
  const waiting = store.views.filter((v) => v.phase === "waiting").slice(0, 2)
  // Several parties on the island: whose plea it is (every party's pleas show, followed or not).
  const partyOf = (id: string) =>
    store.parties.length > 1 ? store.parties.find((p) => p.id === id) : undefined
  return (
    <div className="pleas" role="status" aria-live="assertive">
      {waiting.map((v) => {
        const party = partyOf(v.party)
        return (
          <button
            key={v.id}
            type="button"
            className="plea-card"
            onClick={() => store.select(v.id)}
            style={{ "--role": v.color } as CSSProperties}
          >
            <span className="plea-mark" aria-hidden="true">
              <Icon.plea />
            </span>
            <span className="plea-text">
              <span>
                {party && (
                  <>
                    <Pennant color={party.color} size={14} />{" "}
                  </>
                )}
                <b>{v.title}</b> {party ? <>of the {party.name} quest </> : null}awaits your word
              </span>
              <span className="plea-sub">{v.doing || "asks for permission"}</span>
            </span>
            <span className="plea-go">Open</span>
          </button>
        )
      })}
    </div>
  )
}
