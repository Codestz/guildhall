// Quaternius Medieval Village (2020, FBX): whole houses, an inn, a blacksmith, mills, a stable and a
// bell tower, plus market stands, carts, wells, doors, windows and street props.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-village",
  source: "quaternius_medievalvillage",
  vendor: "quaternius",
  license: "CC0",
  include: ["{Buildings,Props}/FBX/*.fbx"],
  // A smoke plume is an effect, not a piece.
  exclude: ["Props/FBX/Smoke.fbx"],
  colour: { mode: "material" },
  // The doors are 0.72 raw, the same as House_1's front door: x3.6 puts a door at 2.6 m, House_1 at
  // 12.2 m (two storeys and a roof), a barrel at 0.7 m and a cart at 2.9 m.
  scale: { factor: 3.6 },
  pivot: "bottom-centre",
  rules: [
    // House_4 is a one-storey cottage (3.9 m), under the building band by design.
    // The houses' front doors face +z (seen on all four in the thumbnails): that side meets the street.
    { match: "House_*", category: "building", tags: ["house"], front: "+z", streetEdge: "+z" },
    { match: "{Inn,Blacksmith,Stable}", category: "building", tags: ["house"] },
    { match: "{Mill,Sawmill}", category: "building", tags: ["workshop"] },
    { match: "Bell_Tower", category: "tower", tags: ["landmark"] },
    { match: "Door_*", category: "door", tags: ["door"] },
    { match: "Window_*", category: "prop", tags: ["window"] },
    { match: "Fence", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "Path_*", category: "ground", attach: "ground", tags: ["road"] },
    { match: "Rock_3", category: "ground", attach: "ground", tags: ["stepping-stone"] },
    { match: "Rock_*", category: "rock" },
    { match: "{MarketStand_*,Gazebo}", category: "prop", tags: ["market"] },
    { match: "Cart", category: "vehicle" },
    { match: "{Bench_*}", category: "furniture" },
    { match: "*", category: "prop" },
  ],
  overrides: { "house-1": { tags: ["house", "scale-ref"] } },
} satisfies PackConfig
