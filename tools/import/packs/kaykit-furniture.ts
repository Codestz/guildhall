// KayKit Furniture Bits: beds, chairs, tables, cabinets, shelves, rugs, lamps and frames.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-furniture",
  source: "KayKit_Furniture_Bits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1): a table is 1 m, a chair 1.26 m, a single bed 3 m long.
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    { match: "rug_*", category: "floor", attach: "floor", tags: ["rug"] },
    { match: "pictureframe_{large,medium,small}_*", category: "prop", tags: ["wall-hung"] },
    { match: "{pictureframe,book,pillow}*", category: "prop" },
    { match: "cactus_*", category: "prop", tags: ["plant"] },
    { match: "shelf_*", category: "furniture", tags: ["wall-hung"] },
    // lamp_standing is a 2.5 m floor lamp, just over the furniture band: accepted (a hero is 2.2 m).
    { match: "*", category: "furniture" },
  ],
  overrides: {
    "table-medium": { tags: ["scale-ref"] },
  },
} satisfies PackConfig
