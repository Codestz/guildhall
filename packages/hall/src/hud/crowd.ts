import type { AdventurerView } from "../guild/store.ts"

/**
 * The roster at crowd scale (a stress cast, `?n=300`). Past ROSTER_CROWD_AT adventurers a list of
 * everyone stops being a roster and becomes a wall: the roster keeps the few who matter by name
 * (`notable`) and gathers everyone else under their role (`roles`), a sigil and a count that open
 * into the names. The showcase stories (up to ~16) stay under the line and keep their list.
 */
export const ROSTER_CROWD_AT = 24
/** At most this many named outside the role groups: the rest are counted (and marked) in their role. */
export const NOTABLE_MAX = 8

export interface RoleGroup {
  /** Keyed by archetype (never by the shown name, which the Names setting changes). */
  archetype: string
  /** The first member's unnumbered name and plural, sigil and colour. */
  role: string
  plural: string
  glyph: string
  color: string
  /** Everyone of the role not named above, in roster order. */
  views: AdventurerView[]
  /** Of them, pleading / fallen (they overflowed NOTABLE_MAX): the group shows a mark for them. */
  pleas: number
  fallen: number
}

export interface Crowd {
  /** Named: who you follow, anyone pleading or fallen, the guildmaster — in roster order. */
  notable: AdventurerView[]
  roles: RoleGroup[]
}

/** Is a roster of `count` adventurers a crowd? */
export function isCrowd(count: number): boolean {
  return count > ROSTER_CROWD_AT
}

/** How much a view earns its own row: lower first; Infinity is not notable. */
function rank(view: AdventurerView, selected: string | null): number {
  if (view.id === selected) return 0
  if (view.phase === "waiting") return 1
  if (view.phase === "failed") return 2
  if (view.master) return 3
  return Number.POSITIVE_INFINITY
}

/**
 * Splits `views` (already in roster order) into the named few and role groups. The named are
 * chosen by rank (followed, plea, fall, guildmaster) up to NOTABLE_MAX, then shown in roster order;
 * roles keep the order their first member appears in.
 */
export function crowdOf(views: readonly AdventurerView[], selected: string | null): Crowd {
  const ranked = views
    .map((view, at) => ({ view, at, rank: rank(view, selected) }))
    .filter((r) => r.rank !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, NOTABLE_MAX)
  const named = new Set(ranked.map((r) => r.view.id))
  const notable = views.filter((v) => named.has(v.id))
  const roles = new Map<string, RoleGroup>()
  for (const view of views) {
    if (named.has(view.id)) continue
    let group = roles.get(view.archetype)
    if (!group) {
      group = {
        archetype: view.archetype,
        role: view.role,
        plural: view.plural,
        glyph: view.glyph,
        color: view.color,
        views: [],
        pleas: 0,
        fallen: 0,
      }
      roles.set(view.archetype, group)
    }
    group.views.push(view)
    if (view.phase === "waiting") group.pleas++
    if (view.phase === "failed") group.fallen++
  }
  return { notable, roles: [...roles.values()] }
}

/** A group's name for `count` of them: `Scout`, `Scouts`. */
export function plural(group: Pick<RoleGroup, "role" | "plural">, count: number): string {
  return count === 1 ? group.role : group.plural
}
