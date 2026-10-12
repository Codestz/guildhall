// Kenney Fantasy Town 2.0: a modular kit on a 1-unit grid (walls sit on a cell edge).
import type { PackConfig } from "@guildhall/assets"

/**
 * The green texels of its trees and hedges (the roofs, banner and stall keep their own teal: other texels), by the teal tone they would bake to: teal reads
 * cold against the warm palette, so the dark half pins to leaf and the light half to grass; the
 * gradient left over survives as `_SHADE`.
 */
// biome-ignore format: one tone per block
const GREENS: Record<string, string[]> = {
  leaf: [
    "#35946f", "#35956f", "#369570", "#369670", "#379770", "#379771", "#379871", "#389871", "#399972", "#399a72",
    "#399a73", "#3a9b73", "#3b9c74", "#3b9d74", "#3c9d74", "#3c9e75", "#3d9f75", "#3d9f76", "#3da076", "#3ea076",
    "#3ea176", "#3ea177", "#3fa177", "#41a478", "#41a479", "#41a579", "#42a579", "#42a679", "#42a67a", "#43a67a",
    "#43a77a", "#44a87b", "#45a97b", "#45a97c", "#45aa7c", "#46aa7c",
  ],
  grass: [
    "#46ab7c", "#46ab7d", "#47ac7d", "#47ad7e", "#48ad7e", "#49ae7f", "#49af7f", "#4aaf7f", "#4ab07f", "#4ab080",
    "#4bb180", "#4cb281", "#4cb381", "#4db382", "#4db482", "#4eb582", "#4eb583",
  ],
}

export default {
  id: "kenney-town",
  source: "kenney_fantasy-town-kit_2.0",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: {
    mode: "colormap",
    map: Object.fromEntries(Object.entries(GREENS).flatMap(([tone, hexes]) => hexes.map((h) => [h, tone]))),
  },
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
