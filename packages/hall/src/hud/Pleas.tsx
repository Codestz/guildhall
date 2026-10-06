import type { CSSProperties } from "react"
import type { GuildStore } from "../guild/store.ts"
import { Icon } from "./icons.tsx"

/**
 * The steer moment: whoever is waiting on a human, pinned top-centre for as long as they wait.
 * The only HUD element that asks for attention in every mode but Hidden.
 */
export function Pleas({ store }: { store: GuildStore }) {
  const waiting = store.views.filter((v) => v.phase === "waiting").slice(0, 2)
  return (
    <div className="pleas" role="status" aria-live="assertive">
      {waiting.map((v) => (
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
              <b>{v.title}</b> awaits your word
            </span>
            <span className="plea-sub">{v.doing || "asks for permission"}</span>
          </span>
          <span className="plea-go">Open</span>
        </button>
      ))}
    </div>
  )
}
