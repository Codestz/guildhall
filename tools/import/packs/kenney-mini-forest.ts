// Kenney Mini Forest: a forest camp on a 1-unit grid (platform, hut frame and roof, tent, ladder,
// bridge, trees, rocks). The archer is left out (only KayKit bodies are used).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-mini-forest",
  source: "kenney_mini-forest_1.0",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  exclude: ["**/character-*.glb"],
  colour: { mode: "colormap" },
  // The kit's archer is 0.82 raw: x3 sizes the camp to a hero, so the hut frame is a 3 m storey, a
  // tree 5-6.9 m and the fence 1.2 m.
  scale: { factor: 3 },
  pivot: "bottom-centre",
  rules: [
    { match: "building-roof", category: "roof", attach: "roof" },
    { match: "building-structure", category: "wall", attach: "wall-segment" },
    { match: "{building-platform,platform}", category: "floor", attach: "floor" },
    { match: "tent", category: "prop", tags: ["shelter", "tent"] },
    { match: "fence", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "tree*", category: "tree" },
    { match: "rocks-*", category: "cliff", attach: "edge-dressing", edgeKind: "cliff-face" },
    { match: "stones", category: "rock" },
    { match: "patch-*", category: "ground", attach: "ground" },
    { match: "plant", category: "bush" },
    { match: "bridge", category: "bridge" },
    { match: "weapon-*", category: "prop", attach: "held", tags: ["weapon"] },
    { match: "*", category: "prop" },
  ],
  overrides: { tree: { tags: ["scale-ref"] } },
} satisfies PackConfig
