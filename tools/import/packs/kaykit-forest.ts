// KayKit Forest Nature: trees, bushes, rocks and grass, each in several colourways.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-forest",
  source: "KayKit_Forest_Nature_Pack_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // Trees are 3.5-5.3 raw (character-scale units, a knight is 2.33): x1.5 puts them at 5-8 m.
  scale: { factor: 1.5 },
  // Leaning trunks: pivot on the trunk's foot, not the canopy's bbox centre, and root it 5 cm.
  pivot: "trunk",
  sink: 0.05,
  rules: [
    { match: "Tree_Bare_*", category: "tree", tags: ["bare"] },
    { match: "Tree_*", category: "tree" },
    { match: "Bush_*", category: "bush" },
    { match: "Rock_*", category: "rock" },
    { match: "Grass_*", category: "ground", attach: "ground", tags: ["grass"] },
  ],
} satisfies PackConfig
