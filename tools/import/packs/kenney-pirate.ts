// Kenney Pirate Kit: ships, a harbour fort, docks and beach dressing.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-pirate",
  source: "kenney_pirate-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: { mode: "colormap" },
  // castle-door's arch tops out at 1.5 raw: x1.7 lifts it to 2.6 m. ship-pirate-large becomes a 17 m
  // tall, 22 m galleon.
  scale: { factor: 1.7 },
  pivot: "bottom-centre",
  rules: [
    { match: "castle-door", category: "door", attach: "gate", tags: ["scale-ref"] },
    { match: "castle-gate", category: "door", attach: "gate" },
    { match: "castle-*", category: "wall", attach: "wall-segment" },
    { match: "tower-*", category: "tower" },
    { match: "{ship,boat}-*", category: "vehicle", tags: ["ship"] },
    { match: "{structure-platform,platform}*", category: "floor", tags: ["dock"] },
    { match: "structure-fence*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "structure*", category: "building" },
    { match: "palm-*", category: "tree", tags: ["palm"] },
    { match: "rocks-*", category: "rock" },
    { match: "{grass,patch}*", category: "ground", attach: "ground" },
    { match: "*", category: "prop" },
  ],
} satisfies PackConfig
