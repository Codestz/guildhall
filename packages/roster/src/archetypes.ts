/**
 * The world's characters (ADR 0010): what an adventurer *is* in the hall, whatever source sent it.
 * One table drives everything the hall varies by kind of adventurer — its name, its sigil and
 * colour, the model it is drawn with, where it works and what it holds — so adding a kind is one
 * entry here and the compiler asks for nothing else.
 *
 * Sources never name an archetype on their own terms: an adapter maps its own actors onto one
 * (roster role → archetype in `roles/`, a bot → the Automaton, anything unknown → the Wanderer;
 * `cast.ts`), or a source sends one on the wire (`session.archetype`, PROTOCOL.md).
 *
 * The work an archetype does is its home's: a site's or station's work loop (the hall's
 * world/behaviours.ts) sets the clips, so they are not repeated here.
 */

/** The keep's stations: where each archetype works indoors. */
export type Station =
  | "quest-board"
  | "drafting-table"
  | "forge"
  | "inspection-bench"
  | "library"
  | "map-table"
  | "easel"
  | "scroll-desk"
  | "overflow"

/** The island's job sites (the hall's world/sites.ts registry says what each looks like and does). */
export type Site = "yard" | "forest" | "river" | "proving" | "quarry" | "tower"

/** Kit pieces (the hall's kit.json names) held in each hand. */
export interface Gear {
  right?: string
  left?: string
}

export type ArchetypeId =
  | "guildmaster"
  | "architect"
  | "artisan"
  | "warden"
  | "archivist"
  | "scout"
  | "scholar"
  | "illuminator"
  | "herald"
  | "wanderer"
  | "automaton"

export interface Archetype {
  id: ArchetypeId
  /** In-world name: `Warden`. */
  name: string
  /** `Wardens`. */
  plural: string
  /** The sigil's two letters (unique: the HUD tells archetypes apart by them and the colour). */
  glyph: string
  /** Hex colour: sigil, ring, chip border and the cape's dye. */
  color: string
  /** Character model key (the hall's world/cast.ts MODELS). */
  model: string
  station: Station
  /** The island site it works out at; none for the keep's own. */
  site?: Site
  /** What it carries. */
  gear: Gear
  /** What a master carries instead, hand by hand (ranks.ts): the finer tools of the trade. */
  master?: Gear
}

export const ARCHETYPES: Readonly<Record<ArchetypeId, Archetype>> = {
  guildmaster: {
    id: "guildmaster",
    name: "Guildmaster",
    plural: "Guildmasters",
    glyph: "Gm",
    color: "#d4ad3a",
    model: "mage",
    station: "quest-board",
    gear: { right: "staff" },
  },
  architect: {
    id: "architect",
    name: "Architect",
    plural: "Architects",
    glyph: "Ar",
    color: "#4f8fd6",
    model: "knight",
    station: "drafting-table",
    gear: { left: "spellbook_open" },
    master: { right: "drafting_compass" },
  },
  artisan: {
    id: "artisan",
    name: "Artisan",
    plural: "Artisans",
    glyph: "At",
    color: "#e0702f",
    model: "barbarian",
    station: "forge",
    site: "yard",
    gear: { right: "hammer_A" },
    master: { right: "hammer" },
  },
  warden: {
    id: "warden",
    name: "Warden",
    plural: "Wardens",
    glyph: "Wd",
    color: "#3fae6b",
    model: "rogue",
    station: "inspection-bench",
    site: "proving",
    gear: { right: "dagger" },
    master: { right: "sword_1handed" },
  },
  archivist: {
    id: "archivist",
    name: "Archivist",
    plural: "Archivists",
    glyph: "Av",
    color: "#8b6cd9",
    model: "mage",
    station: "library",
    site: "tower",
    gear: { left: "spellbook_closed" },
    master: { right: "candle_lit" },
  },
  scout: {
    id: "scout",
    name: "Scout",
    plural: "Scouts",
    glyph: "Sc",
    color: "#2fa7a0",
    model: "ranger",
    station: "map-table",
    site: "forest",
    gear: { right: "crossbow_1handed" },
    master: { left: "shield_A" },
  },
  scholar: {
    id: "scholar",
    name: "Scholar",
    plural: "Scholars",
    glyph: "Sh",
    color: "#6fb3e0",
    model: "rogue-hooded",
    station: "map-table",
    site: "river",
    gear: { right: "wand" },
    master: { left: "magnifying_glass" },
  },
  illuminator: {
    id: "illuminator",
    name: "Illuminator",
    plural: "Illuminators",
    glyph: "Il",
    color: "#e070a8",
    model: "rogue",
    station: "easel",
    gear: { left: "shield_badge_color" },
    master: { right: "wand" },
  },
  herald: {
    id: "herald",
    name: "Herald",
    plural: "Heralds",
    glyph: "He",
    color: "#b8864a",
    model: "knight",
    station: "scroll-desk",
    gear: { right: "map_rolled" },
    master: { left: "journal_open" },
  },
  wanderer: {
    id: "wanderer",
    name: "Wanderer",
    plural: "Wanderers",
    glyph: "Wn",
    color: "#9a8f80",
    model: "rogue-hooded",
    station: "overflow",
    site: "quarry",
    gear: {},
  },
  automaton: {
    id: "automaton",
    name: "Automaton",
    plural: "Automatons",
    glyph: "Au",
    color: "#c8873a",
    model: "automaton",
    station: "overflow",
    site: "quarry",
    gear: {},
  },
}

/** Every archetype, in the table's order. */
export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[]

export function isArchetype(value: unknown): value is ArchetypeId {
  return typeof value === "string" && Object.hasOwn(ARCHETYPES, value)
}
