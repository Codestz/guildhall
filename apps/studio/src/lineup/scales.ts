/**
 * Raw-to-metre scale per vendor pack, set hero-relative (the hero is 2.2 m): a door top lands at
 * 2.4-2.8 m above the floor it opens onto, a storey near 3 m, trees 4-9 m. Each factor comes from a
 * raw height measured on the pack's own files (glTF bounds, then a front view against the 1 m grid).
 * This is the lineup's calibration table, a preview of what tools/import's pack configs will pin.
 */
export const SCALES = {
  /** Built in metres already: the 2.2 m reference everything else is set against. */
  hero: { name: "Hero silhouette", factor: 1 },
  /**
   * Knight.glb stands 2.54 raw to the helmet crest (skinned bind pose, measured in three; the file's
   * own bounds agree). 2.2 / 2.54 = 0.87: the real hero matches the silhouette.
   */
  "kaykit-adventurers": { name: "KayKit Adventurers", factor: 0.87 },
  /**
   * home B's door opening is 0.335 raw from its threshold to the arch top: x8 puts it at 2.7 m. The
   * door sits on a stone plinth that is part of the mesh (no hex tile in these files, but the plinth
   * and steps lift the floor ~1.8 m), so the house reads 10 m tall overall. The tavern's door matches.
   */
  "kaykit-hexagon": { name: "KayKit Medieval Hexagon", factor: 8 },
  /**
   * Kenney's wall pieces are exactly 1 unit tall, one storey: x3 gives the 3 m storey. The arched
   * door in wall-door tops out at 0.83 of the wall, so its top lands at 2.5 m.
   */
  "kenney-town": { name: "Kenney Fantasy Town", factor: 3 },
  /**
   * door.glb is 0.605 raw and the wall-doorway arch tops out at 0.70: x4 puts the door at 2.4 m and
   * the arch at 2.8 m, so a wall (1.31 raw) is 5.2 m and a three-piece tower 12 m.
   */
  "kenney-castle": { name: "Kenney Castle", factor: 4 },
  /**
   * The SecondAge houses' doors are 0.22 raw tall (house 1 is 0.77 raw to the ridge): x12 puts a
   * door at 2.6 m and the one-storey house at 9.2 m; the barracks-castle comes out at 22 m.
   */
  "quaternius-rts": { name: "Quaternius Fantasy RTS", factor: 12 },
  /**
   * The rigged characters stand 3.05-3.3 raw to the hair or hat top (skinned bind pose). Villagers a
   * touch under the hero: x0.68 gives 2.1-2.2 m.
   */
  "quaternius-characters": { name: "Quaternius Characters", factor: 0.68 },
  /**
   * The forest trees are 3.5-5.3 raw tall (KayKit's character-scale units, where a knight is 2.33):
   * x1.5 makes Tree 1A 6.2 m and Tree 4A 7.9 m, mid of the 4-9 m band and well over a 3 m storey.
   */
  "kaykit-forest": { name: "KayKit Forest", factor: 1.5 },
  /** Authored in metres: MapleTree_1 is 6.6 m as shipped, already in the band. */
  "quaternius-nature": { name: "Quaternius Stylized Nature", factor: 1 },
  /**
   * Nature Kit trees are 1.2-1.7 raw (tree_default 1.71, sitting 0.05 below its origin): x4 makes
   * tree_default 6.6 m, matching the Quaternius maple beside it.
   */
  "kenney-nature": { name: "Kenney Nature", factor: 4 },
  /**
   * castle-door.glb is 4.4 raw tall but its doorway arch tops out at only 1.5 raw. x1.7 lifts that
   * arch to 2.6 m; ship-pirate-large (9.96 raw mast, 13.1 raw long) becomes a 17 m tall, 22 m galleon.
   */
  "kenney-pirate": { name: "Kenney Pirate", factor: 1.7 },
} as const satisfies Record<string, { name: string; factor: number }>

export type PackId = keyof typeof SCALES
