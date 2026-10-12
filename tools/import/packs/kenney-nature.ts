// Kenney Nature Kit: trees, cliffs, rocks, ground tiles and camp props, flat-coloured materials.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-nature",
  source: "kenney_nature-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLTF format/*.glb"],
  colour: { mode: "material" },
  // Trees are 1.2-1.7 raw (tree_default 1.71): x4 makes tree_default 6.6 m.
  scale: { factor: 4 },
  pivot: "bottom-centre",
  // Every piece is modelled 0.05 below its origin: that is the kit's ground line.
  ground: -0.05,
  rules: [
    { match: "tree*", category: "tree" },
    { match: "cliff*", category: "cliff" },
    { match: "{rock,stone}_*", category: "rock" },
    { match: "{plant,cactus}_*", category: "bush" },
    { match: "{grass,flower,crop,crops,path,ground,lily}*", category: "ground", attach: "ground" },
    { match: "bridge_*", category: "bridge" },
    { match: "fence_*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "platform_*", category: "floor" },
    { match: "bed*", category: "furniture" },
    { match: "canoe*", category: "vehicle" },
    { match: "*", category: "prop" },
  ],
} satisfies PackConfig
