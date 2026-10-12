// KayKit Furniture Bits: beds, chairs, tables, cabinets, shelves, rugs, lamps and frames.
import type { PackConfig } from "@guildhall/assets"

/**
 * The green texels of the potted cacti (alone and on the decorated cabinet and shelf), by the teal tone they would bake to: teal reads
 * cold against the warm palette, so the dark half pins to leaf and the light half to grass; the
 * gradient left over survives as `_SHADE`.
 */
// biome-ignore format: one tone per block
const GREENS: Record<string, string[]> = {
  leaf: [
    "#2c928b", "#2d928a", "#2d938a", "#2e938a", "#349985", "#3a9e80", "#3ca07e", "#3ea27c", "#3fa27c", "#40a47b",
    "#41a47a", "#44a778", "#46a876", "#46a976", "#47aa75", "#48ab74", "#49ab74",
  ],
  grass: [
    "#4aac73",
  ],
}

export default {
  id: "kaykit-furniture",
  source: "KayKit_Furniture_Bits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  colour: {
    mode: "atlas",
    map: Object.fromEntries(Object.entries(GREENS).flatMap(([tone, hexes]) => hexes.map((h) => [h, tone]))),
  },
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
