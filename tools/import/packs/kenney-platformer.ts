// Kenney Platformer Kit: grass and snow terrace blocks, fences, hedges, trees, ladders, doors and
// crates. The characters (only KayKit bodies are used) and the game pickups and traps are left out.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-platformer",
  source: "kenney_platformer-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  exclude: [
    "**/character-*.glb",
    "**/{coin-*,heart,star,jewel,key,lock,button-*,spike-*,trap-*,saw,spring,conveyor-belt,block-moving*,bomb,lever,arrow,arrows}.glb",
  ],
  colour: { mode: "colormap" },
  // The kit's characters are 0.9 raw and its doors 1.0: x2.5 makes a door 2.5 m (the hero walks
  // through it), a block a 2.5 m terrace step and a tree 4.8-5 m.
  scale: { factor: 2.5 },
  pivot: "bottom-centre",
  rules: [
    { match: "door-*", category: "door", tags: ["door"] },
    { match: "block-*", category: "ground", attach: "ground", tags: ["terrace"] },
    { match: "fence-*corner*", category: "fence", attach: "corner", edgeKind: "fence" },
    // fence-low-* and fence-rope are 0.75 m border rails, under the fence band by design.
    { match: "fence-*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "hedge*", category: "bush", attach: "edge-dressing", edgeKind: "hedge", tags: ["hedge"] },
    // tree-pine-small and its snow twin are 3.5 m young pines, under the tree band by design.
    { match: "tree-*", category: "tree" },
    { match: "{flowers*,grass,plant,mushrooms,stones}", category: "ground", attach: "ground" },
    { match: "rocks", category: "rock" },
    { match: "{platform*,pipe}", category: "floor", attach: "floor" },
    { match: "*", category: "prop" },
  ],
  overrides: { "door-rotate": { tags: ["door", "scale-ref"] } },
} satisfies PackConfig
