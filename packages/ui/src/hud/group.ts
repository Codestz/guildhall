/**
 * Who the roster lists, and in what groups (V1's hud/Roster.tsx and hud/crowd.ts, fed by props).
 *
 * - By party (the default, V1): one group per party when several are on the island, else one plain
 *   group. The guildmaster leads each group.
 * - By family: one group per hero family (mage, knight, ranger, barbarian, rogue), in that order.
 * - At crowd scale (past `CROWD_AT` heroes) a list of everyone stops being a roster: the few who matter
 *   keep their row and everyone else folds into a count per family, which opens into the names.
 */
import { FAMILIES, type Family, type HeroView, type PartyView } from "./types.ts"

export const CROWD_AT = 24
/** At most this many keep their row at crowd scale; the rest are counted (and marked) in their family. */
export const NOTABLE_MAX = 8

export type GroupBy = "party" | "family"

export interface RosterGroup {
  /** Stable key: the party id, the family, or "all". */
  key: string
  party?: PartyView
  family?: Family
  heroes: HeroView[]
}

/** Masters first, then the order they came in. */
function byMaster(heroes: readonly HeroView[]): HeroView[] {
  return heroes
    .map((hero, at) => ({ hero, at }))
    .sort((a, b) => Number(Boolean(b.hero.master)) - Number(Boolean(a.hero.master)) || a.at - b.at)
    .map((r) => r.hero)
}

/**
 * The roster's groups. By party: parties in their own order (a hero of an unknown party joins a last
 * "Others" group), and a single party is one unnamed group. By family: the fixed family order, empty
 * families left out. Following a party (`following`) keeps only its heroes.
 */
export function rosterGroups(
  heroes: readonly HeroView[],
  parties: readonly PartyView[] = [],
  { by = "party", following = null }: { by?: GroupBy; following?: string | null } = {},
): RosterGroup[] {
  const shown = following === null ? heroes : heroes.filter((h) => h.party === following)
  if (by === "family")
    return FAMILIES.map((family) => ({
      key: family,
      family,
      heroes: byMaster(shown.filter((h) => h.family === family)),
    })).filter((g) => g.heroes.length > 0)
  if (parties.length < 2) return shown.length ? [{ key: "all", heroes: byMaster(shown) }] : []
  const known = new Set(parties.map((p) => p.id))
  const groups: RosterGroup[] = parties
    .filter((p) => following === null || p.id === following)
    .map((party) => ({ key: party.id, party, heroes: byMaster(shown.filter((h) => h.party === party.id)) }))
  const strays = shown.filter((h) => !h.party || !known.has(h.party))
  if (strays.length > 0) groups.push({ key: "others", heroes: byMaster(strays) })
  return groups.filter((g) => g.heroes.length > 0)
}

export interface FamilyCount {
  family: Family
  heroes: HeroView[]
  /** Of them, waiting on you / fallen: the group shows a mark for each. */
  pleas: number
  fallen: number
}

export interface Crowd {
  /** Named: the selected hero, anyone pleading or fallen, the guildmaster — in roster order. */
  notable: HeroView[]
  /** Everyone else, counted by family (families in the order their first member appears). */
  families: FamilyCount[]
}

export const isCrowd = (n: number): boolean => n > CROWD_AT

/** How much a hero earns its own row: lower first; Infinity is not notable. */
function notability(hero: HeroView, selected: string | null): number {
  if (hero.id === selected) return 0
  if (hero.phase === "waiting") return 1
  if (hero.phase === "failed") return 2
  if (hero.master) return 3
  return Number.POSITIVE_INFINITY
}

/** Splits `heroes` (already in roster order) into the named few and a count per family. */
export function crowdOf(heroes: readonly HeroView[], selected: string | null = null): Crowd {
  const named = new Set(
    heroes
      .map((hero, at) => ({ hero, at, rank: notability(hero, selected) }))
      .filter((r) => r.rank !== Number.POSITIVE_INFINITY)
      .sort((a, b) => a.rank - b.rank || a.at - b.at)
      .slice(0, NOTABLE_MAX)
      .map((r) => r.hero.id),
  )
  const families = new Map<Family, FamilyCount>()
  for (const hero of heroes) {
    if (named.has(hero.id)) continue
    let group = families.get(hero.family)
    if (!group) {
      group = { family: hero.family, heroes: [], pleas: 0, fallen: 0 }
      families.set(hero.family, group)
    }
    group.heroes.push(hero)
    if (hero.phase === "waiting") group.pleas++
    if (hero.phase === "failed") group.fallen++
  }
  return { notable: heroes.filter((h) => named.has(h.id)), families: [...families.values()] }
}

/** How many are waiting on a human. */
export const pleasIn = (heroes: readonly HeroView[]): number =>
  heroes.filter((h) => h.phase === "waiting").length
