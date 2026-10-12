// Kenney Fantasy Town 2.0: a modular kit on a 1-unit grid (walls sit on a cell edge).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-town",
  source: "kenney_fantasy-town-kit_2.0",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: { mode: "colormap" },
  // A wall piece is 1 unit, one storey: x3 is the 3 m storey, and wall-door's arch tops out at 2.5 m.
  // Kept a whole number so the kit's grid stays a 3 m grid.
  scale: { factor: 3 },
  // Modular: the authored origin is the snap point, so it is kept (walls report off-centre by design).
  pivot: "keep",
  rules: [
    { match: "wall-door", category: "wall", attach: "wall-segment", tags: ["door", "scale-ref"] },
    { match: "wall-*corner*", category: "wall", attach: "corner" },
    { match: "wall-*{door,doorway}*", category: "wall", attach: "wall-segment", tags: ["door"] },
    { match: "wall-*window*", category: "wall", attach: "wall-segment", tags: ["window"] },
    { match: "wall*", category: "wall", attach: "wall-segment" },
    { match: "chimney*", category: "roof", attach: "roof", tags: ["chimney"] },
    { match: "roof*", category: "roof", attach: "roof" },
    { match: "hedge*", category: "fence", attach: "edge-dressing", edgeKind: "hedge" },
    { match: "fence*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "road*", category: "ground", attach: "ground", tags: ["road"] },
    { match: "stairs*", category: "floor", tags: ["stairs"] },
    { match: "{balcony,overhang,planks}*", category: "floor" },
    { match: "{windmill,watermill}*", category: "building" },
    { match: "tree*", category: "tree" },
    { match: "rock*", category: "rock" },
    { match: "cart*", category: "vehicle" },
    { match: "*", category: "prop" },
  ],
} satisfies PackConfig
