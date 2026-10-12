import { type CSSProperties, Fragment, useEffect, useId, useRef, useState } from "react"
import type { Party } from "../guild/parties.ts"
import type { AdventurerView, GuildStore } from "../guild/store.ts"
import { crowdOf, isCrowd, plural, type RoleGroup } from "./crowd.ts"
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

/** A role group's key: its party and archetype (one party's Scouts open apart from another's). */
const roleKey = (party: Party | undefined, archetype: string) => `${party?.id ?? ""}:${archetype}`

/**
 * The role group a badge asked the roster to open with (crowd scale): set by a role badge just
 * before it expands the roster, taken by the roster when it mounts.
 */
let wanted: string | null = null

/**
 * Everyone in the hall, guildmaster first. A row is a button: it opens the dossier and follows them.
 * At crowd scale (hud/crowd.ts) only the notable are named; everyone else sits in a role group that
 * opens into its names.
 */
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
  const banners = groups.length > 1
  const crowd = isCrowd(views.length)
  // Opened from a role badge: that role starts open, and its header takes the focus the badge had.
  const [arrived] = useState(() => {
    const first = wanted
    wanted = null
    return first
  })
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(arrived ? [arrived] : []))
  const flip = (key: string) =>
    setExpanded((now) => {
      const next = new Set(now)
      if (!next.delete(key)) next.add(key)
      return next
    })

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
        groups.map((group) => {
          const split = crowd ? crowdOf(group.views, store.selected) : undefined
          return (
            <Fragment key={group.party?.id ?? "all"}>
              {group.party && (banners || store.following !== null) && (
                <h3 className="roster-party" style={{ "--banner": group.party.color } as CSSProperties}>
                  <Pennant color={group.party.color} />
                  <span>{group.party.name}</span>
                </h3>
              )}
              <ul className="roster-list">
                {(split ? split.notable : group.views).map((v) => (
                  <RosterRow key={v.id} store={store} view={v} />
                ))}
              </ul>
              {split && split.roles.length > 0 && (
                <ul className="roster-list roster-roles" aria-label="Everyone else, by role">
                  {split.roles.map((role) => {
                    const key = roleKey(group.party, role.archetype)
                    return (
                      <RoleRows
                        key={key}
                        store={store}
                        group={role}
                        open={expanded.has(key)}
                        onToggle={() => flip(key)}
                        arrive={key === arrived}
                      />
                    )
                  })}
                </ul>
              )}
            </Fragment>
          )
        })
      )}
    </Panel>
  )
}

/** One adventurer's row: sigil, name, deed, status. Pressing it follows them and opens their dossier. */
function RosterRow({ store, view: v }: { store: GuildStore; view: AdventurerView }) {
  const phase = phaseOf(v.phase)
  const active = store.selected === v.id
  return (
    <li>
      <button
        type="button"
        className="roster-row"
        aria-pressed={active}
        data-tone={phase.tone}
        onClick={() => store.select(active ? null : v.id)}
      >
        <Sigil glyph={v.glyph} color={v.color} ordinal={v.ordinal} />
        <span className="roster-text">
          <span className="roster-name">
            {v.title}
            {v.subtitle && <span className="roster-source"> · {v.subtitle}</span>}
            {v.master && (
              <span className="crown" title="Guildmaster">
                <Icon.crown />
              </span>
            )}
            {store.onCamera === v.id && (
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
}

/** The pleading / fallen a role group holds (they overflowed the named rows), as glyph + number. */
function RoleMarks({ group }: { group: RoleGroup }) {
  return (
    <>
      {group.pleas > 0 && (
        <span className="role-mark tone-plea">
          <Icon.plea />
          {group.pleas}
        </span>
      )}
      {group.fallen > 0 && (
        <span className="role-mark tone-fail">
          <Icon.fail />
          {group.fallen}
        </span>
      )}
    </>
  )
}

/** A role at crowd scale: a header (sigil, role, count) that opens into its members' rows. */
function RoleRows({
  store,
  group,
  open,
  onToggle,
  arrive = false,
}: {
  store: GuildStore
  group: RoleGroup
  open: boolean
  onToggle: () => void
  /** The roster was opened for this role (a role badge): focus its header and bring it into view. */
  arrive?: boolean
}) {
  const id = useId()
  const head = useRef<HTMLButtonElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the roster opens at it
  useEffect(() => {
    if (!arrive) return
    head.current?.focus({ preventScroll: true })
    head.current?.scrollIntoView({ block: "start" })
  }, [])
  const n = group.views.length
  const marks = [
    group.pleas > 0 ? `${group.pleas} pleading` : "",
    group.fallen > 0 ? `${group.fallen} fallen` : "",
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <li className="roster-role">
      <button
        ref={head}
        type="button"
        className="roster-role-head"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${n} ${plural(group, n)}${marks ? `, ${marks}` : ""}`}
        onClick={onToggle}
      >
        <Sigil glyph={group.glyph} color={group.color} />
        <span className="roster-role-name">{plural(group, n)}</span>
        <RoleMarks group={group} />
        <span className="roster-role-count">{n}</span>
        <span className="fold">
          <Icon.chevron />
        </span>
      </button>
      <ul className="roster-list roster-members" id={id} hidden={!open}>
        {open && group.views.map((v) => <RosterRow key={v.id} store={store} view={v} />)}
      </ul>
    </li>
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
  // At crowd scale: the notable by name, everyone else as one badge per role (hud/crowd.ts).
  const crowd = isCrowd(views.length)
  return (
    <nav className="plaque badges" aria-label="The guild">
      <ul className="badge-list">
        {groups.map((group) => {
          const split = crowd ? crowdOf(group.views, store.selected) : undefined
          return (
            <li key={group.party?.id ?? "all"} className="badge-group" data-banner={banners}>
              {banners && group.party && (
                <span className="badge-party" aria-hidden="true">
                  <Pennant color={group.party.color} size={14} />
                </span>
              )}
              <ul className="badge-list">
                {(split ? split.notable : group.views).map((v) => {
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
                        <Sigil glyph={v.glyph} color={v.color} ordinal={v.ordinal} />
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
                {split?.roles.map((role) => (
                  <li key={role.archetype}>
                    <RoleBadge
                      group={role}
                      onOpen={() => {
                        wanted = roleKey(group.party, role.archetype)
                        onExpand()
                      }}
                    />
                  </li>
                ))}
              </ul>
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

/** A role at crowd scale, folded: its sigil and how many. Pressing it opens the roster at that role. */
function RoleBadge({ group, onOpen }: { group: RoleGroup; onOpen: () => void }) {
  const n = group.views.length
  const tone = group.pleas > 0 ? "plea" : group.fallen > 0 ? "fail" : undefined
  const Mark = tone === "plea" ? Icon.plea : Icon.fail
  const marks = [
    group.pleas > 0 ? `${group.pleas} pleading` : "",
    group.fallen > 0 ? `${group.fallen} fallen` : "",
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <button
      type="button"
      className="badge badge-role"
      data-tone={tone}
      aria-label={`${n} ${plural(group, n)}${marks ? `, ${marks}` : ""}. Show them in the roster.`}
      onClick={onOpen}
      style={{ "--role": group.color } as CSSProperties}
    >
      <Sigil glyph={group.glyph} color={group.color} />
      <span className="badge-count" aria-hidden="true">
        {n}
      </span>
      {tone && (
        <span className="badge-mark" aria-hidden="true">
          <Mark />
        </span>
      )}
      <span className="tip" aria-hidden="true">
        <b>
          {n} {plural(group, n)}
        </b>
        <span>{marks || "Show them in the roster"}</span>
      </span>
    </button>
  )
}
