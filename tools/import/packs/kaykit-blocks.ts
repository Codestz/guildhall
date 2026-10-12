// KayKit Block Bits: 2-unit voxel blocks, terrain (grass, dirt, sand, snow, stone, ore, lava, water)
// and building material (bricks, wood, metal, glass, painted blocks).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-blocks",
  source: "KayKit_BlockBits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1): a block is 2 m, near a hero's height. Authored centred on the
  // origin; bottom-centre stands each block on the ground.
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    { match: "water", category: "water", tags: ["block"] },
    {
      match: "{dirt,grass,gravel,sand,snow,stone,lava,tree}*",
      category: "ground",
      attach: "ground",
      tags: ["block", "terrain"],
    },
    { match: "*", category: "prop", tags: ["block", "material"] },
  ],
  overrides: { grass: { tags: ["block", "scale-ref", "terrain"] } },
} satisfies PackConfig
