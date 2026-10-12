// KayKit Medieval Hexagon, buildings only (the hex tiles and decoration are not imported yet).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-hexagon",
  source: "KayKit_Medieval_Hexagon_Pack_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/gltf/buildings/**/*.gltf"],
  colour: { mode: "atlas" },
  // home B's door opening is 0.335 raw from threshold to arch top: x8 puts it at 2.7 m (the door
  // stands on a plinth that is part of the mesh, so a house reads ~10 m overall).
  scale: { factor: 8 },
  pivot: "bottom-centre",
  rules: [
    { match: "building_home_B_*", category: "building", tags: ["house", "scale-ref"] },
    { match: "building_home_*", category: "building", tags: ["house"] },
    { match: "building_bridge_*", category: "bridge" },
    { match: "building_tower_*", category: "tower" },
    { match: "building_well*", category: "prop", tags: ["well"] },
    { match: "building_{destroyed,scaffolding,stage_*}", category: "building", tags: ["construction"] },
    { match: "building_{dirt,grain}", category: "ground", attach: "ground" },
    { match: "building_*", category: "building" },
    { match: "wall_corner_*_gate", category: "wall", attach: "gate" },
    { match: "wall_corner_*", category: "wall", attach: "corner" },
    { match: "wall_*gate", category: "wall", attach: "gate" },
    { match: "wall_*", category: "wall", attach: "wall-segment" },
    { match: "fence_*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "projectile_*", category: "prop" },
  ],
} satisfies PackConfig
