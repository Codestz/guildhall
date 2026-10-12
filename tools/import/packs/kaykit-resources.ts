// KayKit Resource Bits: ingots, ore, logs, planks, stone, textiles and fuel, loose and stacked.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-resources",
  source: "KayKit_ResourceBits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1): a fuel barrel is 1 m, a log stack 1.5 m.
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    {
      match: "*_{Bar,Nugget_*,Brick,Plank_?,Log_?,Cog}",
      category: "prop",
      attach: "held",
      tags: ["resource"],
    },
    { match: "Pallet_*", category: "prop", tags: ["pallet"] },
    { match: "Fuel_*", category: "prop", tags: ["barrel", "resource"] },
    { match: "*", category: "prop", tags: ["resource", "stack"] },
  ],
  overrides: { "wood-log-stack": { tags: ["scale-ref"] } },
} satisfies PackConfig
