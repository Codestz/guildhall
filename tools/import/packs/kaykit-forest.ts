// KayKit Forest Nature: trees, bushes, rocks and grass.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-forest",
  source: "KayKit_Forest_Nature_Pack_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  // The *_Mesh files are untextured duplicates of Grass_1/Grass_2.
  exclude: ["**/*_Mesh.gltf"],
  colour: { mode: "atlas" },
  // Authored in KayKit's hero units (the hero is 2.2 m at factor 1), so factor 1 keeps the forest
  // in proportion with the people: Tree_1_A 4.2 m, Tree_2_E 8.8 m. The A sizes of a few types are
  // saplings (Tree_3_A, Tree_Bare_1_A/B, Tree_Bare_2_A: 2.9-3.8 m) and Tree_4_C is a 10.8 m
  // giant fir: kept as authored, so those five trees flag; a sapling is meant to be small.
  scale: { factor: 1 },
  // Leaning trunks: pivot on the trunk's foot, not the canopy's bbox centre, and root it 5 cm.
  pivot: "trunk",
  sink: 0.05,
  rules: [
    { match: "Tree_Bare_*", category: "tree", tags: ["bare"] },
    { match: "Tree_*", category: "tree" },
    // Rock_1_N..Q are 4-4.6 m spires: crags, so cliff dressing rather than loose rock.
    { match: "Rock_1_{N,O,P,Q}_*", category: "cliff", tags: ["crag"] },
    // A 22 cm stone and a 23 cm tuft are ground scatter, not a rock or a bush.
    { match: "{Rock_2_A,Bush_1_A}_*", category: "ground", attach: "ground", tags: ["scatter"] },
    { match: "Rock_*", category: "rock" },
    { match: "Bush_*", category: "bush" },
    { match: "Grass_*", category: "ground", attach: "ground", tags: ["grass"] },
  ],
  overrides: { "tree-2-c-color1": { tags: ["scale-ref"] } },
} satisfies PackConfig
