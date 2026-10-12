/**
 * The palette preview's cast: one piece per pack and category, twelve in all, chosen so every kept pack
 * and the colours it leans on (KayKit greys and roofs, Kenney salmon stone and teal grass, Quaternius
 * bark and walls) are on screen. Each slot names a preferred piece and falls back to the first of its
 * pack and category, so a re-import that renames a piece still fills the slot.
 */
import type { Catalog, CatalogEntry, Category } from "@guildhall/assets"

export interface Slot {
  pack: string
  category: Category
  /** The piece name to prefer (exact, case-insensitive). */
  prefer: string
}

export const SLOTS: readonly Slot[] = [
  { pack: "kaykit-hexagon", category: "building", prefer: "building_home_B_blue" },
  { pack: "kaykit-hexagon", category: "tower", prefer: "building_tower_A_red" },
  { pack: "kaykit-forest", category: "tree", prefer: "Tree_1_A_Color1" },
  { pack: "kaykit-forest", category: "rock", prefer: "Rock_1_J_Color1" },
  { pack: "kenney-castle", category: "tower", prefer: "tower-square-roof" },
  { pack: "kenney-castle", category: "wall", prefer: "wall-doorway" },
  { pack: "kenney-nature", category: "tree", prefer: "tree_default" },
  { pack: "kenney-nature", category: "ground", prefer: "ground_grass" },
  { pack: "kenney-pirate", category: "vehicle", prefer: "boat-row-large" },
  { pack: "kenney-town", category: "wall", prefer: "wall-window-shutters" },
  { pack: "quaternius-nature", category: "tree", prefer: "MapleTree_1" },
  { pack: "quaternius-rts", category: "building", prefer: "Houses_FirstAge_1_Level1" },
]

/** Each slot's piece (static pieces only), or null when the library has nothing in that pack/category. */
export function palettePicks(catalog: Catalog, slots: readonly Slot[] = SLOTS): (CatalogEntry | null)[] {
  return slots.map((slot) => {
    const candidates = catalog
      .query({ pack: slot.pack, category: slot.category, kind: "static" })
      .filter((e) => e.files.glb)
    const want = slot.prefer.toLowerCase()
    return candidates.find((e) => e.name.toLowerCase() === want) ?? candidates[0] ?? null
  })
}
