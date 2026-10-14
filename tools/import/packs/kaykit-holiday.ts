// KayKit Holiday Bits, the toy-train track pieces only: short rail for the mines. The rest of the pack
// (presents, plates, trees) is not imported.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-holiday",
  source: "KayKit_Holiday_Bits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/tracks_*.gltf"],
  colour: { mode: "atlas" },
  // Raised x2 so a mine cart rides it: a straight piece is 1 m across and 2 m long.
  scale: { factor: 2 },
  pivot: "bottom-centre",
  rules: [{ match: "tracks_*", category: "ground", tags: ["rail", "track"] }],
} satisfies PackConfig
