import type { CSSProperties } from "react"
import type { GuildStore } from "../guild/store.ts"
import { phaseOf } from "./format.ts"
import { Icon } from "./icons.tsx"
import { Panel, Sigil, Status } from "./parts.tsx"

const sorted = (store: GuildStore) => [...store.views].sort((a, b) => Number(b.master) - Number(a.master))

/** Everyone in the hall, guildmaster first. A row is a button: it opens the dossier and follows them. */
export function Roster({
  store,
  open,
  onToggle,
  compact = false,
  className,
}: {
  store: GuildStore
  open: boolean
  onToggle: () => void
  /** Collapsing returns to the compact form (badges / toasts). */
  compact?: boolean
  className?: string
}) {
  const views = sorted(store)
  const pleas = views.filter((v) => v.phase === "waiting").length
  const watched = store.onCamera

  return (
    <Panel
      label="The Guild"
      meta={
        <>
          {views.length} {views.length === 1 ? "adventurer" : "adventurers"}
          {pleas > 0 && <span className="meta-plea"> · {pleas} plea</span>}
        </>
      }
      open={open}
      onToggle={onToggle}
      compact={compact}
      className={`roster ${className ?? ""}`}
    >
      {views.length === 0 ? (
        <p className="empty">The hall is quiet. The guildmaster arrives soon.</p>
      ) : (
        <ul className="roster-list">
          {views.map((v) => {
            const phase = phaseOf(v.phase)
            const active = store.selected === v.id
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className="roster-row"
                  aria-pressed={active}
                  data-tone={phase.tone}
                  onClick={() => store.select(active ? null : v.id)}
                >
                  <Sigil title={v.role} color={v.color} ordinal={v.ordinal} />
                  <span className="roster-text">
                    <span className="roster-name">
                      {v.title}
                      {v.master && (
                        <span className="crown" title="Guildmaster">
                          <Icon.crown />
                        </span>
                      )}
                      {watched === v.id && (
                        <span className="on-camera" title="The Bard is filming them">
                          <Icon.eye />
                          <span className="visually-hidden">on camera</span>
                        </span>
                      )}
                    </span>
                    <span className="roster-doing">{v.doing || "—"}</span>
                  </span>
                  <Status tone={phase.tone} label={phase.label} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/**
 * The roster folded away: one sigil per adventurer. A plea or a fall marks the sigil (shape, not
 * only colour); hovering or focusing one names it. Clicking opens their dossier.
 */
export function RosterBadges({ store, onExpand }: { store: GuildStore; onExpand: () => void }) {
  const views = sorted(store)
  return (
    <nav className="plaque badges" aria-label="The guild">
      <ul className="badge-list">
        {views.map((v) => {
          const phase = phaseOf(v.phase)
          const active = store.selected === v.id
          const mark = phase.tone === "plea" || phase.tone === "fail" || phase.tone === "loot"
          const Mark = Icon[phase.tone === "plea" ? "plea" : phase.tone === "fail" ? "fail" : "loot"]
          return (
            <li key={v.id}>
              <button
                type="button"
                className="badge"
                data-tone={phase.tone}
                aria-pressed={active}
                aria-label={`${v.title}, ${phase.label}${v.doing ? `, ${v.doing}` : ""}. Open dossier.`}
                onClick={() => store.select(active ? null : v.id)}
                style={{ "--role": v.color } as CSSProperties}
              >
                <Sigil title={v.role} color={v.color} ordinal={v.ordinal} />
                {mark && (
                  <span className="badge-mark" aria-hidden="true">
                    <Mark />
                  </span>
                )}
                <span className="tip" aria-hidden="true">
                  <b>{v.title}</b>
                  <span>{phase.label}</span>
                </span>
              </button>
            </li>
          )
        })}
        {views.length === 0 && <li className="badge-empty">The hall is quiet</li>}
      </ul>
      <button
        type="button"
        className="icon-btn expand"
        onClick={onExpand}
        aria-label="Expand the guild roster"
      >
        <Icon.expand />
      </button>
    </nav>
  )
}
