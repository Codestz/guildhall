// KayKit Medieval Builder (legacy): the building and landmark objects; the hex and square tiles are
// board-game terrain and are not imported. Files are named `<name>.gltf.glb`, so slugs end in -gltf.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-builder",
  source: "KayKit_Medieval_Builder_Pack_1.0",
  vendor: "kaykit",
  license: "CC0",
  include: ["Models/objects/gltf/*.glb"],
  // The Green material (detail_hill's turf) is nearest teal, cold against the warm palette: pinned
  // to grass. The well's Water stays teal.
  colour: { mode: "material", map: { "#48bc8d": "grass" } },
  // Tile-scale miniatures like the hexagon pack. The house's arched door (on +z) rises from the
  // 0.145 raw floor to 0.389 raw: at 2.6 m that is x10.7, so the house stands 9.8 m.
  scale: { ref: "house.gltf", measure: "doorTop", metres: 2.6 },
  scaleBy: [{ match: "wall_*", factor: 4.2 }],
  pivot: "bottom-centre",
  rules: [
    { match: "house*", category: "building", tags: ["house"] },
    { match: "castle*", category: "building", tags: ["castle", "landmark"] },
    { match: "{mill,watermill}*", category: "building", tags: ["landmark"] },
    { match: "watchtower*", category: "tower" },
    { match: "bridge*", category: "bridge" },
    { match: "well*", category: "prop", tags: ["well"] },
    { match: "farm_plot*", category: "ground", attach: "ground", tags: ["field"] },
    { match: "wall_corner*", category: "wall", attach: "corner", edgeKind: "wall" },
    { match: "wall_hexCorner*", category: "wall", attach: "corner", edgeKind: "wall" },
    { match: "wall_gate*", category: "wall", attach: "gate", edgeKind: "wall" },
    { match: "wall_*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "detail_tree*", category: "tree" },
    { match: "detail_rocks_small*", category: "rock" },
    { match: "{detail_*,forest,mountain}*", category: "ground", attach: "ground" },
    { match: "*", category: "building" },
  ],
  overrides: {
    "house-gltf": {
      tags: ["scale-ref"],
      front: "+z",
      anchors: [{ id: "door", kind: "door", at: [0, 0.389, 0.2], facing: 0, height: 0.244 }],
    },
    // Piers and the wheel dip below the tile top they stand on: the authored origin is kept (`sunk`).
    "bridge-gltf": { pivot: "keep" },
    "bridge-roofed-gltf": { pivot: "keep" },
    "watermill-gltf": { pivot: "keep" },
  },
} satisfies PackConfig
