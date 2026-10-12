// Kenney Pirate Kit: ships, a harbour fort, docks, palms and beach dressing.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-pirate",
  source: "kenney_pirate-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  colour: { mode: "colormap" },
  // castle-door is a 4.4 raw fort block whose doorway (on +z) tops out at 1.6 raw: at 2.6 m that is
  // x1.63, so ship-pirate-large is a 16 m tall, 21 m galleon and a palm 6.9 m.
  scale: { ref: "castle-door", measure: "doorTop", metres: 2.6 },
  // The loose props are modelled bigger than the fort (a 1.2 raw barrel, 0.9 raw bottles): at x1
  // a barrel is 1.2 m and a crate 0.8 m beside the hero; the tools (2.35 raw) at x0.7 are 1.6 m.
  scaleBy: [
    { match: "{barrel,bottle*,chest,crate*,cannon*}", factor: 1 },
    { match: "tool-*", factor: 0.7 },
  ],
  pivot: "bottom-centre",
  rules: [
    { match: "castle-{door,gate}", category: "wall", attach: "gate", edgeKind: "wall", tags: ["door"] },
    // The fort's walls are 7.2 m sea walls, over the town-wall band: accepted, a fort stands taller.
    { match: "castle-*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "tower-{roof,top,watch}", category: "roof", attach: "roof" },
    { match: "tower-*", category: "tower" },
    // Watercraft are props tagged vehicle: the vehicle band (1.2-3 m) sizes carts, and a 16 m
    // galleon is right outside it.
    { match: "ship-*", category: "prop", tags: ["ship", "vehicle"] },
    { match: "boat-*", category: "prop", tags: ["boat", "vehicle"] },
    { match: "{mast*,flag*}", category: "prop", tags: ["ship-part"] },
    { match: "{structure-platform,platform}*", category: "floor", attach: "floor", tags: ["dock"] },
    { match: "structure-roof", category: "roof", attach: "roof", tags: ["dock"] },
    // The stilt-house frame (3.6 m), bare or railed: the lower storey a structure-roof sits on.
    { match: "structure*", category: "wall", attach: "wall-segment", tags: ["dock"] },
    { match: "palm-*", category: "tree", tags: ["palm"] },
    // The coast rocks are 4-6 m outcrops: cliff dressing for a shoreline.
    { match: "rocks-*", category: "cliff", tags: ["coast"] },
    { match: "{grass,patch,hole}*", category: "ground", attach: "ground" },
    { match: "tool-*", category: "prop", attach: "held", tags: ["tool"] },
    { match: "*", category: "prop" },
  ],
  overrides: {
    "castle-door": {
      tags: ["door", "scale-ref"],
      front: "+z",
      anchors: [{ id: "door", kind: "door", at: [0, 1.6, 1], facing: 0, height: 1.6 }],
    },
  },
} satisfies PackConfig
