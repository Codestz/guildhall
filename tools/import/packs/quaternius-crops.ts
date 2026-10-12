// Quaternius Ultimate Crops (FBX): fruit trees, vegetables, grain and flowers in four growth stages,
// plus their crop item and harvested state.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-crops",
  source: "quaternius_ultimatecrops",
  vendor: "quaternius",
  license: "CC0",
  include: ["FBX/*.fbx"],
  colour: { mode: "material" },
  // Authored about life size (a lettuce 0.5 m, wheat 0.95 m, ripe corn 2 m): factor 1 for the crops.
  scale: { factor: 1 },
  // The orchard trees at x1 are 2.8-3.3 m when grown: x1.6 makes them 4.4-5.2 m fruit trees.
  scaleBy: [{ match: "{Apple,Orange,PalmTree}_{4,Harvested}", factor: 1.6 }],
  pivot: "bottom-centre",
  rules: [
    { match: "{Apple,Orange,PalmTree}_{4,Harvested}", category: "tree", tags: ["orchard"] },
    { match: "*_Crop", category: "prop", attach: "held", tags: ["crop", "produce"] },
    { match: "{BushBerries,Cactus}_{4,Harvested}", category: "bush", tags: ["crop"] },
    // Growth stages 1-3 and the vegetables are field dressing, sized as planted.
    { match: "*", category: "ground", attach: "ground", tags: ["crop"] },
  ],
  overrides: { "corn-4": { tags: ["crop", "scale-ref"] } },
} satisfies PackConfig
