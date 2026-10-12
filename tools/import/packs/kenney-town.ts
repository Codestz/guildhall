// Kenney Fantasy Town 2.0: a modular kit on a 1-unit grid (walls sit on a cell edge).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-town",
  source: "kenney_fantasy-town-kit_2.0",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: { mode: "colormap" },
  // A wall piece is 1 unit, one storey. wall-door's opening tops out at 0.75 of the wall (its door
  // anchor below): set to 2.6 m, that is x3.47, a 3.5 m storey on a 3.5 m grid.
  scale: { ref: "wall-door", measure: "doorTop", metres: 2.6 },
  // Modular: the authored origin is the snap point, so it is kept. Walls, chimneys and fences sit on
  // a cell edge (`off-centre`); roofs overhang the wall top they snap to (`sunk` by the eave drip);
  // banners and the overhang hang off a wall (`floating`). All by design of the kit.
  // Trees and rocks are free-standing: at x3.47 tree-high is 10.3 m and rock-large 4 m, so they
  // take x2.8 (tree 6.8 m, tree-high 8.3 m) and x3 (rock-large 3.5 m).
  scaleBy: [
    { match: "tree*", factor: 2.8 },
    { match: "rock*", factor: 3 },
  ],
  pivot: "keep",
  rules: [
    { match: "wall-*corner*", category: "wall", attach: "corner", edgeKind: "wall" },
    {
      match: "wall-*{door,doorway}*",
      category: "wall",
      attach: "wall-segment",
      edgeKind: "wall",
      tags: ["door"],
    },
    { match: "wall-*window*", category: "wall", attach: "wall-segment", edgeKind: "wall", tags: ["window"] },
    // The *-half walls are half-storey parapets (1.7 m), under the wall band by design.
    { match: "wall*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "chimney*", category: "roof", attach: "roof", tags: ["chimney"] },
    { match: "roof*", category: "roof", attach: "roof" },
    // Hedges are shrubs trimmed to an edge: a 0.9 m border and a 2.1 m screen (hedge-large*, over
    // the bush band by design; scaling it down would break the kit's grid).
    { match: "hedge*", category: "bush", attach: "edge-dressing", edgeKind: "hedge", tags: ["hedge"] },
    { match: "fence*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "road*", category: "ground", attach: "ground", tags: ["road"] },
    { match: "fountain*", category: "prop", tags: ["fountain"] },
    { match: "stairs*", category: "floor", tags: ["stairs"] },
    { match: "{balcony,overhang,planks}*", category: "floor", attach: "floor" },
    { match: "{pillar,poles}*", category: "prop", tags: ["pillar"] },
    // The mills' wheels and sails reach below their origin (stream bed, sail sweep): `sunk` by design.
    { match: "{windmill,watermill}*", category: "building", tags: ["landmark"] },
    { match: "tree*", category: "tree" },
    { match: "rock*", category: "rock" },
    { match: "cart*", category: "vehicle" },
    { match: "*", category: "prop" },
  ],
  overrides: {
    // The kit ships no whole house: its doored storey is the scale reference (the scale scene's
    // stand-in for a Kenney house). The anchor sits on the +x face of the panel, at the opening's top.
    "wall-door": {
      tags: ["door", "scale-ref"],
      anchors: [{ id: "door", kind: "door", at: [0.5, 0.75, 0], facing: Math.PI / 2, height: 0.75 }],
    },
  },
} satisfies PackConfig
