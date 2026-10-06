import type { GuildStore } from "../guild/store.ts"
import { phaseOf } from "./format.ts"
import { Icon } from "./icons.tsx"
import { Panel, Sigil, Status } from "./parts.tsx"

/** Everyone in the hall, guildmaster first. A row is a button: it opens the dossier and follows them. */
export function Roster({
  store,
  open,
  onToggle,
  className,
}: {
  store: GuildStore
  open: boolean
  onToggle: () => void
  className?: string
}) {
  const views = [...store.views].sort((a, b) => Number(b.master) - Number(a.master))
  const pleas = views.filter((v) => v.phase === "waiting").length
  const watched = store.bard && !store.selected ? store.focus?.id : undefined

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
                  <Sigil title={v.title} color={v.color} />
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
