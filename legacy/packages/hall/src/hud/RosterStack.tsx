import type { CSSProperties } from "react"
import type { GuildStore } from "../guild/store.ts"
import { Sigil } from "./parts.tsx"

/** How many sigils the stack shows before "+N". */
const SHOWN = 2

/**
 * The roster on a phone, folded to one button in the top bar: the first few adventurers' sigils
 * overlapped, "+N" for the rest, a dot when someone waits on a plea. Tapping it opens the roster
 * sheet (the full chips live there). Anyone waiting on a plea is shown first, then the guildmaster.
 */
export function RosterStack({ store, onExpand }: { store: GuildStore; onExpand: () => void }) {
  const views = store.views
  const pleas = views.filter((v) => v.phase === "waiting").length
  const order = [...views].sort(
    (a, b) =>
      Number(b.phase === "waiting") - Number(a.phase === "waiting") || Number(b.master) - Number(a.master),
  )
  const shown = order.slice(0, SHOWN)
  const rest = views.length - shown.length
  return (
    <button
      type="button"
      className="plaque tool roster-stack"
      onClick={onExpand}
      aria-label={`The guild: ${views.length} ${views.length === 1 ? "adventurer" : "adventurers"}${pleas > 0 ? `, ${pleas} waiting for you` : ""}. Open the roster.`}
      title="The guild"
    >
      {shown.map((v) => (
        <span key={v.id} className="stack-sigil" style={{ "--role": v.color } as CSSProperties}>
          <Sigil glyph={v.glyph} color={v.color} ordinal={v.ordinal} size="sm" />
        </span>
      ))}
      {rest > 0 && (
        <span className="stack-more mono" aria-hidden="true">
          +{rest}
        </span>
      )}
      {pleas > 0 && <i className="tab-dot" aria-hidden="true" />}
      {views.length === 0 && <span className="stack-more">0</span>}
    </button>
  )
}
