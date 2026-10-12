// Quaternius Ultimate Nature (FBX): birch, common, pine, willow and palm trees in green, autumn, snow
// and dead variants, bushes, cacti, rocks, logs, grass and flowers, flat-coloured materials.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-nature",
  source: "quaternius_ultimatenature",
  vendor: "quaternius",
  license: "CC0",
  include: ["FBX/*.fbx"],
  colour: { mode: "material" },
  // Trees are 2.3-5 raw: x1.72 puts the green ones at 4-8.7 m, mid of the tree band, and a rock
  // at 1-1.7 m.
  scale: { factor: 1.72 },
  scaleBy: [
    // Dead trees are modelled smaller than the living ones: x2 makes them 4.4-8.7 m snags. The two
    // smallest dead willows (Willow_Dead_3 and its snow twin) stay 3.8 m and flag, by design.
    { match: "*_Dead_*", factor: 2 },
    // Bushes at x1.7 are 2.2 m: x1.3 makes them 1.4-1.7 m shrubs.
    { match: "{Bush,BushBerries}_*", factor: 1.3 },
    // Ground cover, plants and cacti are authored about life size: x1 (grass 0.4-1.2 m, corn 2 m).
    { match: "{Cactus,CactusFlower,CactusFlowers,Plant,Grass,Flowers,Wheat,Corn,Lilypad}*", factor: 1 },
  ],
  pivot: "bottom-centre",
  rules: [
    { match: "Rock_Snow_*", category: "rock", tags: ["snow"] },
    { match: "Rock_*", category: "rock" },
    { match: "{Bush,BushBerries}_*", category: "bush" },
    // CactusFlowers_2 is a 1.9 m saguaro, a hair over the bush band: accepted.
    // CactusFlower_1 is a 0.36 m flowering pad: ground cover.
    { match: "CactusFlower_1", category: "ground", attach: "ground" },
    { match: "{Cactus,CactusFlower,CactusFlowers,Plant}*", category: "bush" },
    { match: "*_Dead_*", category: "tree", tags: ["dead"] },
    { match: "*_Snow_*", category: "tree", tags: ["snow"] },
    { match: "*_Autumn_*", category: "tree", tags: ["autumn"] },
    { match: "{BirchTree,CommonTree,PineTree,PalmTree,Willow}_*", category: "tree" },
    { match: "{WoodLog,TreeStump}*", category: "prop", tags: ["wood"] },
    { match: "*", category: "ground", attach: "ground" },
  ],
  overrides: { "common-tree-1": { tags: ["scale-ref"] } },
} satisfies PackConfig
