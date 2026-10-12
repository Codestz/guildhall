// Quaternius Ultimate Stylized Nature (glTF): textured trees, bushes, flowers and grass.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-nature",
  source: "quaternius_ultimatestylizednature",
  vendor: "quaternius",
  license: "CC0",
  include: ["glTF/*.gltf"],
  // Bark and leaf textures, averaged per face into the palette.
  colour: { mode: "texture-average" },
  // Authored in metres: MapleTree_1 is 6.6 m as shipped.
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    { match: "*Tree_*", category: "tree" },
    { match: "Bush*", category: "bush" },
    { match: "{Flower,Grass}_*", category: "ground", attach: "ground" },
  ],
} satisfies PackConfig
