// Quaternius Ultimate Fantasy RTS (glTF): two ages of buildings in three levels, resources, walls.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-rts",
  source: "quaternius_ultimatefantasyrts",
  vendor: "quaternius",
  license: "CC0",
  include: ["glTF/*.gltf"],
  colour: { mode: "material" },
  // Houses_SecondAge_1_Level1's door (on +z, under its canopy) is 0.242 raw from step to lintel: at
  // 2.6 m that is x10.7, so the house is 8.3 m to the ridge.
  scale: { ref: "Houses_SecondAge_1_Level1", measure: "doorTop", metres: 2.6 },
  scaleBy: [
    // Resources are modelled big next to the buildings (a tree 0.93 raw would be 10 m at x10.7):
    // x8 makes a tree 7.4 m and a pine 5.1 m, x6 a boulder 3.4 m.
    { match: "Resource_*Tree*", factor: 8 },
    { match: "{Resource_Rock,Resource_Gold,Rock}*", factor: 6 },
    // A barrel at x10.7 is 1.5 m: x7 makes it 1 m and a crate 0.9 m.
    { match: "{Barrel,Crate,Logs}*", factor: 7 },
    // The town walls at x10.7 are 5.6-7.9 m: x8 makes them 3.6-4.2 m with 5.4-5.9 m wall towers.
    { match: "{Wall,WallTowers}_*", factor: 8 },
  ],
  pivot: "bottom-centre",
  rules: [
    { match: "Houses_SecondAge_1_Level1", category: "building", tags: ["house", "scale-ref"] },
    { match: "{Houses,TowerHouse}_*", category: "building", tags: ["house"] },
    { match: "WatchTower_*", category: "tower" },
    { match: "WallTowers_Door*", category: "wall", attach: "gate", edgeKind: "wall" },
    { match: "{Wall,WallTowers}_*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "WonderWalls_*", category: "building", tags: ["landmark", "wonder"] },
    { match: "{Wonder,Temple}_*", category: "building", tags: ["landmark"] },
    { match: "Farm_*", category: "ground", attach: "ground", tags: ["farm"] },
    { match: "Resource_*Tree*Cut*", category: "ground", attach: "ground", tags: ["stumps"] },
    { match: "Resource_*Tree*", category: "tree" },
    { match: "{Resource_Rock,Resource_Gold,Rock}*", category: "rock" },
    { match: "Mountain*", category: "cliff" },
    { match: "{Barrel,Crate,Logs}*", category: "prop" },
    { match: "Dock_*", category: "floor", tags: ["dock"] },
    // TownCenter_FirstAge_Level1 (3.3 m) and Storage_SecondAge_Level1 (5.4 m) are first-level
    // footprints, under the building band by design (their levels 2 and 3 grow up).
    { match: "*", category: "building" },
  ],
  overrides: {
    "houses-second-age-1-level1": {
      front: "+z",
      anchors: [{ id: "door", kind: "door", at: [-0.1, 0.259, 0.17], facing: 0, height: 0.242 }],
    },
  },
} satisfies PackConfig
