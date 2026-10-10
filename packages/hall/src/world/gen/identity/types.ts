import type { KitColour } from "../biomes.ts"

/**
 * What makes a generator-2 island itself: the building its heart is, the shape of
 * its land, the colours of its roofs. All of it is read from the island's own tree, plus the little a
 * split repo knows about it (`IslandHint`), so the same island always comes out the same, on every
 * machine (the same DMath and hash rules as the plan).
 */

/** What a package is for, from its name and what is in it (identity/role.ts): the core is the home island, a castle the shared base others lean on. */
export type Role = "core" | "castle" | "forge" | "library" | "observatory" | "watch" | "harbour" | "civic"

/** The shapes an island's land takes (plan/shapes.ts): a ring round a lagoon, a long ridge, a single cone, a high flat table, a cluster of islets. */
export type Archetype = "atoll" | "ridge" | "cone" | "plateau" | "reef"

/** What the archipelago knows about an island that its tree does not. All optional: a lone repo has none. */
export interface IslandHint {
  /** Its own name ("react-dom"); empty for a repo's single island. */
  name: string
  /** The core of its archipelago (the home island): its heart is the grand castle. A lone repo is its own core. */
  core?: boolean
  /** Which of the palettes it has (identity/palette.ts `slotsOf`: bound islands are given ones that differ). */
  palette?: number
  /** How bound it is to the others, 0..1 (gen/coupling.ts `bindOf`). */
  weight?: number
  /** Years of history, when the chronicle knows them. */
  years?: number
}

/** A curated set of the pack's colours: what most roofs are, what some are, and the banners'. */
export interface Palette {
  id: number
  roof: KitColour
  accent: KitColour
  flag: "blue" | "red" | "yellow"
}

export interface Identity {
  role: Role
  archetype: Archetype
  palette: Palette
  /** The composites the heart may be, the best first: the first that fits is built (plan/heart.ts). */
  wish: readonly string[]
}
