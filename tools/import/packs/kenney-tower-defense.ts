// Kenney Tower Defense Kit: 1-unit path, river and bridge tiles (green and snow), modular towers,
// wooden scaffolds and siege weapons. The UFO enemies, spawn pads and selection rings are game UI.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-tower-defense",
  source: "kenney_tower-defense-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  exclude: ["**/{enemy-*,selection-*,spawn-*,*tile-spawn*,weapon-ammo-*}.glb"],
  colour: { mode: "colormap" },
  // A tile is 1 unit: x3 makes it a 3 m path cell (Kenney Town's grid), a two-piece round tower
  // 5.4 m and a ballista 1.5 m.
  scale: { factor: 3 },
  // The loose decoration trees are 0.5-0.76 raw, saplings at x3: x8 makes them 4.3-6.1 m trees.
  scaleBy: [{ match: "*detail-tree*", factor: 8 }],
  pivot: "bottom-centre",
  rules: [
    { match: "*detail-tree*", category: "tree" },
    { match: "*detail-{rocks,crystal}*", category: "rock" },
    { match: "*detail-dirt*", category: "ground", attach: "ground" },
    { match: "*tile-river-bridge", category: "bridge", tags: ["tile"] },
    { match: "*tile-river*", category: "water", attach: "ground", tags: ["river", "tile"] },
    { match: "*tile*", category: "ground", attach: "ground", tags: ["path", "tile"] },
    { match: "tower-*-roof-*", category: "roof", attach: "roof" },
    { match: "tower-*", category: "tower" },
    { match: "*wood-structure*", category: "floor", tags: ["scaffold"] },
    { match: "weapon-*", category: "prop", tags: ["siege"] },
    { match: "*", category: "prop" },
  ],
  overrides: { "tile-straight": { tags: ["path", "scale-ref", "tile"] } },
} satisfies PackConfig
