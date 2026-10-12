// Kenney Nature Kit: trees, cliffs, rocks, ground tiles, crops and camp props, flat-coloured materials.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-nature",
  source: "kenney_nature-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLTF format/*.glb"],
  colour: { mode: "material" },
  // Trees are 0.9-2.1 raw (tree_default 1.71): x4 makes tree_default 6.8 m and a cliff block 4 m.
  // The small and ground-hugging pines (tree_pineSmall*, tree_pineGround*) are 3.7-4.5 m young pines:
  // the ones under 4 m flag, by design.
  scale: { factor: 4 },
  scaleBy: [
    // Crops, flowers and grass tufts at x4 are a 5 m maize and knee-high daisies: x2.5 keeps them
    // in proportion with the hero (corn 3.1 m, wheat 1.3 m, a flower 0.6 m).
    { match: "{crop,crops,flower,grass,mushroom,lily}*", factor: 2.5 },
    // Cacti at x4 are 2.1-3 m: x2.4 makes them 1.3-1.8 m shrubs.
    { match: "cactus_*", factor: 2.4 },
  ],
  pivot: "bottom-centre",
  // The path and river tiles are thicker than the ground line, their surface at it: `sunk` by
  // design. The round bridge centres span between their side pieces, so they float by design.
  // Every piece is modelled 0.05 below its origin: that is the kit's ground line.
  ground: -0.05,
  rules: [
    { match: "tree*", category: "tree" },
    { match: "cliff_*corner*", category: "cliff", attach: "corner", edgeKind: "cliff-face" },
    { match: "cliff*", category: "cliff", attach: "edge-dressing", edgeKind: "cliff-face" },
    // The flat stones are 26 cm stepping slabs: ground scatter, not rocks.
    { match: "{rock,stone}_smallFlat*", category: "ground", attach: "ground", tags: ["stepping-stone"] },
    { match: "{rock,stone}_*", category: "rock" },
    { match: "{plant,cactus}_*", category: "bush" },
    { match: "{crop,crops}_*", category: "ground", attach: "ground", tags: ["crop"] },
    { match: "{grass,flower,path,ground,lily,mushroom}*", category: "ground", attach: "ground" },
    { match: "bridge_*", category: "bridge" },
    // fence_simpleLow is a 0.8 m border rail, under the fence band by design.
    { match: "fence_*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "platform_*", category: "floor", attach: "floor" },
    { match: "bed_floor", category: "prop", tags: ["bedroll"] },
    { match: "bed*", category: "furniture" },
    { match: "canoe*", category: "prop", tags: ["boat"] },
    { match: "statue_*", category: "prop", tags: ["statue"] },
    { match: "*", category: "prop" },
  ],
  overrides: { "tree-default": { tags: ["scale-ref"] } },
} satisfies PackConfig
