// Quaternius Medieval Village MegaKit (Standard, glTF): a modular timber-and-plaster kit on a 2 m
// grid (walls, corners, door frames and doors, windows and shutters, floors, overhangs, roofs,
// stairs, balconies, fences). Textured with trim sheets: the bake averages each face (`texture-lost`).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-village-kit",
  source: "quaternius_medieval-village-megakit_standard",
  vendor: "quaternius",
  license: "CC0",
  include: ["**/glTF/*.gltf"],
  colour: { mode: "texture-average" },
  // Metric: a wall is a 3.12 m storey with a 2.1 m (flat) or 2.32 m (round) door. x1.15 puts the
  // doors at 2.4 and 2.7 m for the 2.2 m hero, a storey at 3.6 m and the grid at 2.3 m.
  scale: { factor: 1.15 },
  // Modular: the authored origin is the snap point on the grid (walls stand on a cell edge, corners
  // on a cell corner, overhangs and roofs above their wall), so it is kept: `off-centre`, `sunk` and
  // `floating` on these pieces are the kit's layout, by design.
  pivot: "keep",
  rules: [
    { match: "Corner_Exterior_TopOnly", category: "prop", tags: ["trim"] },
    { match: "Corner_*", category: "wall", attach: "corner", edgeKind: "wall" },
    { match: "Wall_*_Door_*", category: "wall", attach: "wall-segment", edgeKind: "wall", tags: ["door"] },
    {
      match: "Wall_*_Window_*",
      category: "wall",
      attach: "wall-segment",
      edgeKind: "wall",
      tags: ["window"],
    },
    { match: "Wall_BottomCover", category: "prop", tags: ["trim"] },
    { match: "Wall_*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "DoorFrame_*", category: "wall", attach: "wall-segment", tags: ["door", "frame"] },
    { match: "Door_*", category: "door", tags: ["door"] },
    { match: "{Window*,WindowShutters*}", category: "prop", tags: ["window"] },
    { match: "Overhang_Roof*", category: "roof", attach: "roof" },
    // The Overhang_Side_* gables close two storeys (7 m), over the wall band by design.
    { match: "Overhang_*", category: "wall", attach: "wall-segment", tags: ["overhang"] },
    { match: "{Roof_*,Window_Roof_*}", category: "roof", attach: "roof" },
    { match: "{Floor_*,HoleCover_*}", category: "floor", attach: "floor" },
    { match: "{Stair*,Stairs*}", category: "floor", tags: ["stairs"] },
    { match: "Balcony_*", category: "floor", attach: "floor", tags: ["balcony"] },
    { match: "Prop_WoodenFence_*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    // The metal fences are 3.3 m wrought-iron screens: walls of railing, not a garden fence.
    { match: "Prop_MetalFence_*", category: "wall", attach: "wall-segment", edgeKind: "fence" },
    { match: "Prop_Chimney*", category: "roof", attach: "roof", tags: ["chimney"] },
    { match: "Prop_Vine*", category: "prop", tags: ["vine"] },
    { match: "Prop_Wagon", category: "vehicle" },
    { match: "Prop_ExteriorBorder_*", category: "ground", attach: "ground", tags: ["border"] },
    { match: "*", category: "prop" },
  ],
  overrides: {
    "wall-plaster-door-round": { tags: ["door", "scale-ref"] },
    // Loose props stand on the ground, not on the grid.
    "prop-brick1": { pivot: "bottom-centre" },
    "prop-brick2": { pivot: "bottom-centre" },
    "prop-brick3": { pivot: "bottom-centre" },
    "prop-brick4": { pivot: "bottom-centre" },
    "prop-crate": { pivot: "bottom-centre" },
    "prop-wagon": { pivot: "bottom-centre" },
  },
} satisfies PackConfig
