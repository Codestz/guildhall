// Quaternius Ultimate Fantasy RTS (glTF): two ages of buildings in three levels, resources, walls.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-rts",
  source: "quaternius_ultimatefantasyrts",
  vendor: "quaternius",
  license: "CC0",
  include: ["glTF/*.gltf"],
  colour: { mode: "material" },
  // The SecondAge houses' doors are 0.22 raw tall: x12 puts a door at 2.6 m.
  scale: { factor: 12 },
  pivot: "bottom-centre",
  rules: [
    { match: "Houses_SecondAge_1_Level1", category: "building", tags: ["house", "scale-ref"] },
    { match: "{Houses,TowerHouse}_*", category: "building", tags: ["house"] },
    { match: "WatchTower_*", category: "tower" },
    { match: "WallTowers_Door*", category: "wall", attach: "gate" },
    { match: "{Wall,WallTowers,WonderWalls}_*", category: "wall", attach: "wall-segment" },
    { match: "Farm_*", category: "ground", attach: "ground", tags: ["farm"] },
    { match: "Resource_*Tree*", category: "tree" },
    { match: "{Resource_Rock,Resource_Gold,Rock}*", category: "rock" },
    { match: "Mountain*", category: "cliff" },
    { match: "{Barrel,Crate,Logs}*", category: "prop" },
    { match: "*", category: "building" },
  ],
} satisfies PackConfig
