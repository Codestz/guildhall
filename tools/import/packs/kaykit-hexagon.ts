// KayKit Medieval Hexagon, buildings and landmarks plus four hand-and-yard props (wheelbarrow, sack,
// archery target, weapon rack); the hex tiles and the rest of the tile-scale decoration (barrels,
// crates, little trees) are board-game miniatures and are not imported.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-hexagon",
  source: "KayKit_Medieval_Hexagon_Pack_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: [
    "**/Assets/gltf/buildings/**/*.gltf",
    "**/Assets/gltf/decoration/props/{wheelbarrow,sack,target,weaponrack}.gltf",
  ],
  // A catapult stone at x8 is a 2 m boulder.
  exclude: ["**/projectile_catapult.gltf"],
  colour: { mode: "atlas" },
  // home B's door opening is 0.335 raw from threshold to arch top: x8 puts it at 2.7 m. The door
  // stands on a stone plinth that is part of the mesh, so a house reads 7-10 m overall.
  scale: { factor: 8 },
  scaleBy: [
    // Tile-scale props raised to hero size: a 2.5 m barrow (waist-high on a 2.2 m hero), a 0.8 m sack, a 2 m target, a 1.4 m rack.
    { match: "wheelbarrow", factor: 5 },
    { match: "sack", factor: 5 },
    { match: "target", factor: 6.5 },
    { match: "weaponrack", factor: 6 },
    // The town wall at x8 would be 8.8 m: x4.2 gives a 4.6 m wall and a 5.9 m gatehouse.
    { match: "wall_*", factor: 4.2 },
    // Fences are knee-high on a tile; at hero scale the wooden one is a 1.1 m rail fence and the
    // stone one a 1.1 m dry-stone wall.
    { match: "fence_wood_*", factor: 2 },
    { match: "fence_stone_*", factor: 4 },
  ],
  pivot: "bottom-centre",
  rules: [
    { match: "building_home_*", category: "building", tags: ["house"] },
    { match: "building_tavern_*", category: "building", tags: ["tavern"] },
    { match: "building_bridge_*", category: "bridge" },
    { match: "building_tower_*", category: "tower" },
    { match: "building_castle_*", category: "building", tags: ["castle", "landmark"] },
    { match: "building_{church,windmill,watermill}_*", category: "building", tags: ["landmark"] },
    { match: "wheelbarrow", category: "prop", tags: ["cart", "wheelbarrow"] },
    { match: "sack", category: "prop", tags: ["sack"] },
    { match: "target", category: "prop", tags: ["target", "arena"] },
    { match: "weaponrack", category: "prop", tags: ["arena", "rack"] },
    { match: "building_well*", category: "prop", tags: ["well"] },
    // Stages A and B are a foundation and a half-raised frame, not yet a building's height.
    { match: "building_stage_{A,B}", category: "prop", tags: ["construction"] },
    { match: "building_{destroyed,scaffolding,stage_*}", category: "building", tags: ["construction"] },
    { match: "building_{dirt,grain}", category: "ground", attach: "ground", tags: ["field"] },
    { match: "building_*", category: "building" },
    { match: "wall_corner_*_gate", category: "wall", attach: "gate", edgeKind: "wall" },
    { match: "wall_corner_*", category: "wall", attach: "corner", edgeKind: "wall" },
    { match: "wall_*gate", category: "wall", attach: "gate", edgeKind: "wall" },
    { match: "wall_*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "fence_*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
  ],
  overrides: {
    "building-home-b-red": { tags: ["scale-ref"] },
    // The bridges' piers and the watermill's wheel reach below the tile top they are built on, so
    // their authored origin (the tile top) is kept: `sunk` marks that, by design.
    "building-bridge-a": { pivot: "keep" },
    "building-bridge-b": { pivot: "keep" },
    "building-watermill-blue": { pivot: "keep" },
    "building-watermill-green": { pivot: "keep" },
    "building-watermill-red": { pivot: "keep" },
    "building-watermill-yellow": { pivot: "keep" },
  },
} satisfies PackConfig
