// Kenney Tower Defense Kit: 1-unit path, river and bridge tiles (green and snow), modular towers,
// wooden scaffolds and siege weapons. The UFO enemies, spawn pads and selection rings are game UI.
import type { PackConfig } from "@guildhall/assets"

/**
 * The green texels of the grass of its tiles (river banks included), its trees and mossy rocks, by the teal tone they would bake to: teal reads
 * cold against the warm palette, so the dark half pins to leaf and the light half to grass; the
 * gradient left over survives as `_SHADE`.
 */
// biome-ignore format: one tone per block
const GREENS: Record<string, string[]> = {
  leaf: [
    "#20896b", "#258f6e", "#2b9471", "#309973", "#359e75", "#3aa478", "#40aa7b",
  ],
  grass: [
    "#46b07e", "#4cb681", "#51bb83", "#56c186", "#5cc689",
  ],
}

export default {
  id: "kenney-tower-defense",
  source: "kenney_tower-defense-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  exclude: ["**/{enemy-*,selection-*,spawn-*,*tile-spawn*,weapon-ammo-*}.glb"],
  colour: {
    mode: "colormap",
    map: Object.fromEntries(Object.entries(GREENS).flatMap(([tone, hexes]) => hexes.map((h) => [h, tone]))),
  },
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
