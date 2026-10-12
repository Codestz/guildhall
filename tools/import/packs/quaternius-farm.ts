// Quaternius Farm Buildings (FBX): barns, a chicken coop, silos, windmills, a water tower, a well
// and fences, flat-coloured materials.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-farm",
  source: "quaternius_farmbuildings",
  vendor: "quaternius",
  license: "CC0",
  include: ["FBX/*.fbx"],
  colour: { mode: "material" },
  // Authored in metres (a barn 6 m to the ridge, a fence 1.1 m), which already sits on the hero
  // scale: factor 1.
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    { match: "Fence*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "Well", category: "prop", tags: ["well"] },
    { match: "{Windmill,TowerWindmill,WaterTower}", category: "building", tags: ["farm", "landmark"] },
    { match: "{Silo,Silo_House}", category: "building", tags: ["farm", "silo"] },
    // The coop is 1.9 m, a hen house rather than a building: a prop.
    { match: "ChickenCoop", category: "prop", tags: ["farm"] },
    // OpenBarn and SmallBarn are one-storey sheds (4.7-5 m to the ridge), just under the building
    // band by design.
    { match: "*", category: "building", tags: ["barn", "farm"] },
  ],
  overrides: { barn: { tags: ["barn", "farm", "scale-ref"] } },
} satisfies PackConfig
