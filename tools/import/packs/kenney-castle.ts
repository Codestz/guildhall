// Kenney Castle Kit: modular towers and walls on a 1-unit grid, plus siege engines.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-castle",
  source: "kenney_castle-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: { mode: "colormap" },
  // door is 0.605 raw and the wall-doorway arch tops out at 0.70: x4 puts them at 2.4 and 2.8 m, so
  // a wall (1.31 raw) is 5.2 m. A whole number keeps the kit's grid a 4 m grid.
  scale: { factor: 4 },
  // Modular: the authored origin is the snap point (tower pieces stack on it).
  pivot: "keep",
  rules: [
    { match: "wall-doorway", category: "wall", attach: "gate", tags: ["door", "scale-ref"] },
    { match: "wall-*corner*", category: "wall", attach: "corner" },
    { match: "wall-*gate*", category: "wall", attach: "gate" },
    { match: "wall*", category: "wall", attach: "wall-segment" },
    { match: "tower*", category: "tower" },
    { match: "{door,gate,metal-gate}", category: "door", attach: "gate" },
    { match: "bridge*", category: "bridge" },
    { match: "stairs*", category: "floor", tags: ["stairs"] },
    { match: "ground*", category: "ground", attach: "ground" },
    { match: "rocks*", category: "rock" },
    { match: "tree-{large,small}", category: "tree" },
    { match: "siege-*", category: "vehicle", tags: ["siege"] },
    { match: "*", category: "prop" },
  ],
} satisfies PackConfig
