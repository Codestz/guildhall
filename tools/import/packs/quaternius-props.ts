// Quaternius Fantasy Props MegaKit (Standard, glTF): tavern and workshop furniture, barrels, crates,
// books, candles, banners, tools and market stalls. Mostly vertex-coloured; the trim-textured pieces
// lose their trim detail to the vertex bake.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-props",
  source: "quaternius_fantasy-props-megakit_standard",
  vendor: "quaternius",
  license: "CC0",
  include: ["Exports/glTF/*.gltf"],
  colour: { mode: "vertex" },
  // Authored in metres (a barrel 0.9 m, a chair 1.12 m, a table 0.81 m). The KayKit hero is a
  // chunky 2.2 m, so x1.15 matches the village kit beside it: a chair 1.3 m, a table 0.95 m.
  scale: { factor: 1.15 },
  pivot: "bottom-centre",
  rules: [
    {
      match: "{Shelf_Simple,Shelf_Small_Bottles,Workbench_Drawers}",
      category: "prop",
      tags: ["furniture-part"],
    },
    // Bookcase_2 is a 2.9 m library case, over the furniture band: accepted.
    {
      match:
        "{Bed_*,Bench,Bookcase_*,Cabinet,Chair_*,Nightstand_*,Shelf_*,Stool,Table_Large,Workbench*,BookStand}",
      category: "furniture",
    },
    {
      match: "{Anvil*,Whetstone,Cauldron,WeaponStand,Barrel_Holder,Peg_Rack}",
      category: "furniture",
      tags: ["station", "workshop"],
    },
    { match: "Stall_*", category: "prop", tags: ["market"] },
    { match: "Banner_*", category: "prop", tags: ["banner"] },
    { match: "{Axe,Pickaxe,Sword,Shield}_*", category: "prop", attach: "held", tags: ["tool"] },
    { match: "{Candle*,CandleStick*,Chandelier,Torch_*,Lantern_*}", category: "prop", tags: ["light"] },
    { match: "*", category: "prop" },
  ],
  overrides: { "chair-1": { tags: ["scale-ref"] } },
} satisfies PackConfig
