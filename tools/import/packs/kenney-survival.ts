// Kenney Survival Kit: a camp in 0.5-unit modules (wood and metal hut walls, roofs, tents, fences)
// with trees, rocks, tools, crates and campfires.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-survival",
  source: "kenney_survival-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: { mode: "colormap" },
  // A hut module is 0.5 raw and its doorway 0.517: x5 makes a 2.5 m wall with a 2.6 m door, a tent
  // 2.5 m, a tree 7-8.6 m and a boulder 2-2.5 m.
  scale: { factor: 5 },
  scaleBy: [
    // The loose camp props are modelled a size up: at x2.8 a barrel is 1 m, a chest 0.7 m, an axe
    // 0.7 m and the workbench 0.8 m.
    {
      match:
        "{barrel*,bedroll*,bottle*,box*,bucket,campfire-*,chest,fish*,resource-*,signpost*,tool-*,workbench*}",
      factor: 2.8,
    },
    // Fences at x2.5 are 1.3 m.
    { match: "fence*", factor: 2.5 },
  ],
  pivot: "bottom-centre",
  rules: [
    { match: "structure*-roof", category: "roof", attach: "roof" },
    { match: "structure*-floor", category: "floor", attach: "floor" },
    { match: "structure*-doorway", category: "wall", attach: "wall-segment", tags: ["door"] },
    // metal-panel-screws-half is a 1.25 m half panel, under the wall band by design.
    { match: "{structure*,metal-panel*}", category: "wall", attach: "wall-segment" },
    { match: "tent*", category: "prop", tags: ["shelter", "tent"] },
    { match: "fence-doorway", category: "fence", attach: "gate", edgeKind: "fence" },
    { match: "fence*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "{floor*}", category: "floor", attach: "floor" },
    { match: "tree-*{trunk,log}*", category: "prop", tags: ["wood"] },
    { match: "tree-{autumn,tall}*", category: "tree" },
    { match: "tree", category: "tree" },
    { match: "tree-*", category: "prop", tags: ["wood"] },
    { match: "rock*", category: "rock" },
    { match: "{grass*,patch-*}", category: "ground", attach: "ground" },
    { match: "tool-*", category: "prop", attach: "held", tags: ["tool"] },
    { match: "*", category: "prop" },
  ],
  overrides: { tree: { tags: ["scale-ref"] } },
} satisfies PackConfig
