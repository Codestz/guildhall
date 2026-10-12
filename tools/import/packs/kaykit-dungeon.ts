// KayKit Dungeon 1.1: modular stone walls, floors and stairs on a 4-unit grid, plus dungeon props.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-dungeon",
  source: "KayKit_Dungeon_Pack_1.1_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1): a wall is 4 m, a chair 1.2 m, a table 1 m, beside a 2.2 m hero.
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    { match: "wall_doorway*", category: "wall", attach: "wall-segment", edgeKind: "wall", tags: ["door"] },
    { match: "wall_*gated*", category: "wall", attach: "gate", edgeKind: "wall" },
    { match: "wall_corner*", category: "wall", attach: "corner", edgeKind: "wall" },
    { match: "wall_*window*", category: "wall", attach: "wall-segment", edgeKind: "wall", tags: ["window"] },
    { match: "wall*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "pillar*", category: "wall", tags: ["pillar"] },
    { match: "barrier*", category: "fence", attach: "edge-dressing", edgeKind: "wall" },
    { match: "{floor,ceiling}_*", category: "floor", attach: "floor" },
    { match: "stairs*", category: "floor", tags: ["stairs"] },
    // table_long_decorated_C carries a candelabra to 2.8 m, over the furniture band: accepted.
    { match: "{bed,chair,stool,table,shelf,shelves,trunk}*", category: "furniture" },
    { match: "banner_*", category: "prop", tags: ["banner"] },
    { match: "{torch,candle}*", category: "prop", tags: ["light"] },
    { match: "rubble*", category: "rock", tags: ["rubble"] },
    { match: "*", category: "prop" },
  ],
  overrides: {
    "wall-doorway": { tags: ["door", "scale-ref"] },
  },
} satisfies PackConfig
