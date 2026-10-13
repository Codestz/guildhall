/**
 * The roster (V1's hud/Roster.tsx), fed by props: everyone on the island, the guildmaster first, grouped
 * by party (or by family). A row is a button: it picks the hero (the dossier opens, the camera follows).
 * Folded, the roster is a strip of badges (`RosterBadges`).
 */
import { createContext, Fragment, useContext, useId, useState } from "react"
import { Avatar } from "./avatar/Avatar.tsx"
import { count, FAMILY_LABEL, heroTitle, phaseOf } from "./format.ts"
import { FAMILY_GLYPH, Glyphs, Pennant } from "./glyphs.tsx"
import {
  type Crowd,
  crowdOf,
  type FamilyCount,
  type GroupBy,
  isCrowd,
  pleasIn,
  rosterGroups,
} from "./group.ts"
import { Empty, FoldPanel, Sigil, Status } from "./parts.tsx"
import type { HeroView, PartyView } from "./types.ts"

export interface RosterProps {
  heroes: readonly HeroView[]
  parties?: readonly PartyView[]
  /** Group by party (V1, the default) or by hero family. */
  by?: GroupBy
  /** Following one party: only its heroes. */
  following?: string | null
  /** The picked hero (its row reads pressed). */
  selected?: string | null
  /** Who the director's camera is on (an eye beside the name). */
  onCamera?: string | null
  open: boolean
  onToggle?: () => void
  /** Folding hands over to the badges, rather than shutting the panel. */
  compact?: boolean
  /** A row was pressed: the hero, or null when the picked one is pressed again. */
  onPick?: (id: string | null) => void
  /** Each row's avatar: the hero's rendered portrait in a medallion (the default), or V1's diamond sigil. */
  look?: "portrait" | "sigil"
  /** The portrait sprite for a hero, once drawn (render `portrait.ts`); until then the face stands in. */
  portraitOf?: (hero: HeroView) => string | null | undefined
  className?: string
}

/** How a roster row draws its hero (Roster's `look` and `portraitOf`, handed down to every row). */
const RowArt = createContext<{ look: "portrait" | "sigil"; portraitOf?: RosterProps["portraitOf"] }>({
  look: "portrait",
})

export function Roster({
  heroes,
  parties = [],
  by = "party",
  following = null,
  selected = null,
  onCamera = null,
  open,
  onToggle,
  compact,
  onPick,
  look = "portrait",
  portraitOf,
  className,
}: RosterProps) {
  const groups = rosterGroups(heroes, parties, { by, following })
  const shown = groups.flatMap((g) => g.heroes)
  const pleas = pleasIn(shown)
  const crowd = isCrowd(shown.length)
  const heads = by === "family" || groups.length > 1 || (following !== null && parties.length > 1)
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const flip = (key: string) =>
    setOpened((now) => {
      const next = new Set(now)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const pick = (id: string) => onPick?.(selected === id ? null : id)

  return (
    <RowArt.Provider value={{ look, portraitOf }}>
      <FoldPanel
        label="The Guild"
        meta={
          <>
            {count(shown.length, "hero", "heroes")}
            {pleas > 0 && <span className="hud-meta-plea"> · {count(pleas, "plea")}</span>}
          </>
        }
        open={open}
        onToggle={onToggle}
        compact={compact}
        className={`hud-roster${className ? ` ${className}` : ""}`}
      >
        {shown.length === 0 ? (
          <Empty>The hall is quiet. The guildmaster arrives soon.</Empty>
        ) : (
          groups.map((group) => {
            const split: Crowd | undefined = crowd ? crowdOf(group.heroes, selected) : undefined
            const Mark = group.family ? FAMILY_GLYPH[group.family] : null
            return (
              <Fragment key={group.key}>
                {heads && (
                  <h3 className="hud-roster-group">
                    {group.party && <Pennant colour={group.party.colour} />}
                    {Mark && <Mark size={14} />}
                    <span>
                      {group.party?.name ?? (group.family ? FAMILY_LABEL[group.family].many : "Others")}
                    </span>
                    <span className="hud-roster-group-n">{group.heroes.length}</span>
                  </h3>
                )}
                <ul className="hud-roster-list">
                  {(split ? split.notable : group.heroes).map((hero) => (
                    <RosterRow
                      key={hero.id}
                      hero={hero}
                      active={selected === hero.id}
                      filmed={onCamera === hero.id}
                      onPick={pick}
                    />
                  ))}
                </ul>
                {split && split.families.length > 0 && (
                  <ul className="hud-roster-list hud-roster-folds" aria-label="Everyone else, by family">
                    {split.families.map((fold) => {
                      const key = `${group.key}:${fold.family}`
                      return (
                        <FamilyFold
                          key={key}
                          fold={fold}
                          open={opened.has(key)}
                          onToggle={() => flip(key)}
                          selected={selected}
                          onCamera={onCamera}
                          onPick={pick}
                        />
                      )
                    })}
                  </ul>
                )}
              </Fragment>
            )
          })
        )}
      </FoldPanel>
    </RowArt.Provider>
  )
}

function RosterRow({
  hero,
  active,
  filmed,
  onPick,
}: {
  hero: HeroView
  active: boolean
  filmed: boolean
  onPick: (id: string) => void
}) {
  const phase = phaseOf(hero.phase)
  const art = useContext(RowArt)
  return (
    <li>
      <button
        type="button"
        className="hud-roster-row"
        aria-pressed={active}
        data-tone={phase.tone}
        onClick={() => onPick(hero.id)}
      >
        {art.look === "portrait" ? (
          <Avatar variant="portrait" hero={hero} size={30} src={art.portraitOf?.(hero)} />
        ) : (
          <Sigil family={hero.family} banner={hero.banner} ordinal={hero.ordinal} />
        )}
        <span className="hud-roster-text">
          <span className="hud-roster-name">
            <span className="hud-roster-title">{heroTitle(hero)}</span>
            {hero.source && <span className="hud-roster-source"> · {hero.source}</span>}
            {hero.master && (
              <span className="hud-crown" title="Guildmaster">
                <Glyphs.crown size={13} />
                <span className="ui-visually-hidden">, guildmaster</span>
              </span>
            )}
            {filmed && (
              <span className="hud-on-camera" title="The camera is on them">
                <Glyphs.eye size={13} />
                <span className="ui-visually-hidden">, on camera</span>
              </span>
            )}
          </span>
          <span className="hud-roster-doing">{hero.doing || "—"}</span>
        </span>
        <Status tone={phase.tone} label={phase.label} />
      </button>
    </li>
  )
}

/** A family at crowd scale: a header (glyph, name, marks, count) that opens into its members' rows. */
function FamilyFold({
  fold,
  open,
  onToggle,
  selected,
  onCamera,
  onPick,
}: {
  fold: FamilyCount
  open: boolean
  onToggle: () => void
  selected: string | null
  onCamera: string | null
  onPick: (id: string) => void
}) {
  const id = useId()
  const n = fold.heroes.length
  const name = n === 1 ? FAMILY_LABEL[fold.family].one : FAMILY_LABEL[fold.family].many
  const Mark = FAMILY_GLYPH[fold.family]
  const marks = [
    fold.pleas > 0 ? `${fold.pleas} pleading` : "",
    fold.fallen > 0 ? `${fold.fallen} fallen` : "",
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <li className="hud-roster-fold">
      <button
        type="button"
        className="hud-roster-fold-head"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${n} ${name}${marks ? `, ${marks}` : ""}`}
        onClick={onToggle}
      >
        <span className="hud-fold-mark" aria-hidden="true">
          <Mark size={16} />
        </span>
        <span className="hud-roster-fold-name">{name}</span>
        {fold.pleas > 0 && (
          <span className="hud-role-mark" data-tone="plea" aria-hidden="true">
            <Glyphs.plea size={13} />
            {fold.pleas}
          </span>
        )}
        {fold.fallen > 0 && (
          <span className="hud-role-mark" data-tone="fail" aria-hidden="true">
            <Glyphs.fail size={13} />
            {fold.fallen}
          </span>
        )}
        <span className="hud-roster-group-n" aria-hidden="true">
          {n}
        </span>
        <span className="hud-fold">
          <Glyphs.chevron />
        </span>
      </button>
      <ul className="hud-roster-list hud-roster-members" id={id} hidden={!open}>
        {open &&
          fold.heroes.map((hero) => (
            <RosterRow
              key={hero.id}
              hero={hero}
              active={selected === hero.id}
              filmed={onCamera === hero.id}
              onPick={onPick}
            />
          ))}
      </ul>
    </li>
  )
}

/**
 * The roster folded away: one sigil per hero. A plea, a fall or loot marks the sigil (a shape, not only
 * a colour); hovering or focusing one names it. Pressing one picks them; the last button unfolds.
 */
export function RosterBadges({
  heroes,
  parties = [],
  following = null,
  selected = null,
  onPick,
  onExpand,
  look = "face",
}: Pick<RosterProps, "heroes" | "parties" | "following" | "selected" | "onPick"> & {
  onExpand: () => void
  /** A chibi face whose expression follows the phase (the default), or V1's monogram diamond. */
  look?: "face" | "sigil"
}) {
  const groups = rosterGroups(heroes, parties, { following })
  const banners = groups.length > 1
  const partyOf = (id: string | undefined) => parties.find((p) => p.id === id)
  return (
    <nav className="ui-panel hud-badges" aria-label="The guild">
      <ul className="hud-badge-list">
        {groups.map((group) => (
          <li key={group.key} className="hud-badge-group" data-banner={banners}>
            {banners && group.party && (
              <span className="hud-badge-party" aria-hidden="true">
                <Pennant colour={group.party.colour} size={14} />
              </span>
            )}
            <ul className="hud-badge-list">
              {group.heroes.map((hero) => {
                const phase = phaseOf(hero.phase)
                const active = selected === hero.id
                const Mark =
                  phase.tone === "plea"
                    ? Glyphs.plea
                    : phase.tone === "fail"
                      ? Glyphs.fail
                      : phase.tone === "loot"
                        ? Glyphs.loot
                        : null
                const party = banners ? partyOf(hero.party) : undefined
                return (
                  <li key={hero.id}>
                    <button
                      type="button"
                      className="hud-badge"
                      data-tone={phase.tone}
                      aria-pressed={active}
                      aria-label={`${heroTitle(hero)}${party ? ` of the ${party.name} quest` : ""}, ${phase.label}${hero.doing ? `, ${hero.doing}` : ""}. Open dossier.`}
                      onClick={() => onPick?.(active ? null : hero.id)}
                    >
                      {look === "face" ? (
                        <Avatar variant="face" hero={hero} size={30} />
                      ) : (
                        <Sigil family={hero.family} banner={hero.banner} ordinal={hero.ordinal} />
                      )}
                      {Mark && (
                        <span className="hud-badge-mark" aria-hidden="true">
                          <Mark size={12} />
                        </span>
                      )}
                      <span className="hud-tip" aria-hidden="true">
                        <b>{heroTitle(hero)}</b>
                        <span>{phase.label}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
        {groups.length === 0 && <li className="hud-badge-empty">The hall is quiet</li>}
      </ul>
      <button
        type="button"
        className="ui-icon-btn hud-badges-expand"
        onClick={onExpand}
        aria-label="Expand the guild roster"
      >
        <Glyphs.expand />
      </button>
    </nav>
  )
}
