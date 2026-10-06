import { type CSSProperties, Fragment } from "react"
import type { Party } from "../guild/parties.ts"
import type { AdventurerView, GuildStore } from "../guild/store.ts"
import { phaseOf } from "./format.ts"
import { Icon } from "./icons.tsx"
import { Pennant } from "./Parties.tsx"
import { Panel, Sigil, Status } from "./parts.tsx"

/**
 * Who the roster lists, by party (the dais's first), guildmaster first in each. Following one party,
 * only it; with several on the island and all shown, each group carries its banner.
 */
function groupsOf(store: GuildStore): { party: Party | undefined; views: AdventurerView[] }[] {
  const byMaster = (a: AdventurerView, b: AdventurerView) => Number(b.master) - Number(a.master)
  const parties = store.parties.filter((p) => store.following === null || p.id === store.following)
  if (store.parties.length < 2) return [{ party: undefined, views: [...store.views].sort(byMaster) }]
  return parties.map((party) => ({
    party,
    views: store.views.filter((v) => v.party === party.id).sort(byMaster),
  }))
}

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
  const groups = groupsOf(store)
  const views = groups.flatMap((g) => g.views)
  const pleas = views.filter((v) => v.phase === "waiting").length
  const watched = store.onCamera
  const banners = groups.length > 1

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
        groups.map((group) => (
          <Fragment key={group.party?.id ?? "all"}>
            {group.party && (banners || store.following !== null) && (
              <h3 className="roster-party" style={{ "--banner": group.party.color } as CSSProperties}>
                <Pennant color={group.party.color} />
                <span>{group.party.name}</span>
              </h3>
            )}
            <ul className="roster-list">
              {group.views.map((v) => {
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
          </Fragment>
        ))
      )}
    </Panel>
  )
}

/**
 * The roster folded away: one sigil per adventurer. A plea or a fall marks the sigil (shape, not
 * only colour); hovering or focusing one names it. Clicking opens their dossier.
 */
export function RosterBadges({ store, onExpand }: { store: GuildStore; onExpand: () => void }) {
  const groups = groupsOf(store)
  const views = groups.flatMap((g) => g.views)
  // Banners whenever parties are told apart: several shown, or one followed among several.
  const banners = groups.length > 1 || (store.following !== null && store.parties.length > 1)
  return (
    <nav className="plaque badges" aria-label="The guild">
      <ul className="badge-list">
        {groups.map((group) => (
          <li key={group.party?.id ?? "all"} className="badge-group" data-banner={banners}>
            {banners && group.party && (
              <span className="badge-party" aria-hidden="true">
                <Pennant color={group.party.color} size={14} />
              </span>
            )}
            <ul className="badge-list">
              {group.views.map((v) => {
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
                      aria-label={`${v.title}${banners && group.party ? ` of the ${group.party.name} quest` : ""}, ${phase.label}${v.doing ? `, ${v.doing}` : ""}. Open dossier.`}
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
            </ul>
          </li>
        ))}
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
