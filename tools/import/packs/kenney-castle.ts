// Kenney Castle Kit: modular towers and walls on a 1-unit grid, plus siege engines.
import type { PackConfig } from "@guildhall/assets"

/**
 * The green texels of its trees and grass ground, by the teal tone they would bake to: teal reads
 * cold against the warm palette, so the dark half pins to leaf and the light half to grass; the
 * gradient left over survives as `_SHADE`.
 */
// biome-ignore format: one tone per block
const GREENS: Record<string, string[]> = {
  leaf: [
    "#1f896b", "#238d6d", "#28916f", "#2c9671", "#309a73", "#349d75", "#3ca679", "#41ab7b",
  ],
  grass: [
    "#4ab380", "#52bc84", "#56c086", "#5ac488", "#61cb8b",
  ],
}

export default {
  id: "kenney-castle",
  source: "kenney_castle-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: {
    mode: "colormap",
    map: Object.fromEntries(Object.entries(GREENS).flatMap(([tone, hexes]) => hexes.map((h) => [h, tone]))),
  },
  // wall-doorway's opening tops out at 0.605 raw (the door leaf is the same height): at 2.6 m that
  // is x4.3, so a wall (1.31 raw) is 5.6 m and the grid a 4.3 m grid.
  scale: { ref: "wall-doorway", measure: "doorTop", metres: 2.6 },
  // Modular: the authored origin is the snap point (tower pieces stack on it, walls sit on a cell
  // edge), so it is kept; `off-centre` on walls is by design.
  pivot: "keep",
  rules: [
    { match: "wall-doorway", category: "wall", attach: "gate", edgeKind: "wall", tags: ["door"] },
    { match: "wall-*corner*", category: "wall", attach: "corner", edgeKind: "wall" },
    { match: "wall-*gate*", category: "wall", attach: "gate", edgeKind: "wall" },
    { match: "wall-*fence*", category: "wall", attach: "wall-segment", edgeKind: "fence" },
    // wall-corner-half-tower, wall-narrow-stairs-rail and wall-narrow-wood-fence carry a rail or a
    // turret 0.6 m over the 5.6 m wall, just over the wall band: accepted.
    { match: "wall*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "tower-*-roof*", category: "roof", attach: "roof" },
    { match: "tower*", category: "tower" },
    { match: "{door,gate,metal-gate}", category: "door", attach: "gate" },
    { match: "bridge*", category: "bridge" },
    { match: "stairs*", category: "floor", tags: ["stairs"] },
    { match: "ground*", category: "ground", attach: "ground" },
    { match: "rocks*", category: "rock" },
    { match: "tree-{large,small}", category: "tree" },
    { match: "tree-*", category: "prop", tags: ["wood"] },
    // Siege engines are 4-12 m machines, not carts: props tagged siege, outside the vehicle band.
    { match: "siege-*", category: "prop", tags: ["siege", "vehicle"] },
    { match: "flag*", category: "prop", tags: ["flag"] },
    { match: "*", category: "prop" },
  ],
  overrides: {
    "wall-doorway": {
      tags: ["door", "scale-ref"],
      anchors: [{ id: "door", kind: "door", at: [0, 0.605, 0], facing: Math.PI / 2, height: 0.605 }],
    },
  },
} satisfies PackConfig
