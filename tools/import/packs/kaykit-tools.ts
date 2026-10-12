// KayKit RPG Tools Bits: hand tools, writing things and a few workshop stations (anvil, grindstone).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-tools",
  source: "KayKit_RPGToolsBits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1): a hammer is 0.8 m, the anvil 0.8 m tall.
  scale: { factor: 1 },
  // Hand tools keep their grip origin (`sunk`/`off-centre` by design); the stations stand on the floor.
  pivot: "keep",
  rules: [
    { match: "{anvil,grindstone}", category: "furniture", tags: ["station", "workshop"] },
    { match: "{blueprint*,map,map_empty}", category: "prop", tags: ["paper"] },
    { match: "{bucket_metal,lantern,compass_base}", category: "prop" },
    { match: "rope_bundle_*", category: "prop", tags: ["rope"] },
    { match: "*", category: "prop", attach: "held", tags: ["tool"] },
  ],
  overrides: {
    anvil: { pivot: "bottom-centre", tags: ["scale-ref"] },
    grindstone: { pivot: "bottom-centre" },
    blueprint: { pivot: "bottom-centre" },
    "blueprint-stacked": { pivot: "bottom-centre" },
    map: { pivot: "bottom-centre" },
    "map-empty": { pivot: "bottom-centre" },
    "bucket-metal": { pivot: "bottom-centre" },
    lantern: { pivot: "bottom-centre" },
    "rope-bundle-a": { pivot: "bottom-centre" },
    "rope-bundle-b": { pivot: "bottom-centre" },
  },
} satisfies PackConfig
