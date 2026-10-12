// Quaternius Modular Medieval Buildings (FBX): castle walls (plain, brick, tall, with an entrance),
// towers and watchtowers, a bridge, a tunnel, a door, windows and a few yard props.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-castle",
  source: "quaternius_modularmedievalbuildings",
  vendor: "quaternius",
  license: "CC0",
  include: ["FBX/*.fbx"],
  colour: { mode: "material" },
  // WallEntrance's arch tops out 0.99 raw over its threshold (the Door leaf is the same height): at
  // 2.5 m that is x2.53, so a wall is 3.9 m, a tall wall 5.9 m and the pointy tower 13.6 m.
  scale: { ref: "WallEntrance", measure: "doorTop", metres: 2.5 },
  pivot: "bottom-centre",
  rules: [
    {
      match: "{WallEntrance*,TallWallEntrance}",
      category: "wall",
      attach: "gate",
      edgeKind: "wall",
      tags: ["door"],
    },
    { match: "*Wall*", category: "wall", attach: "wall-segment", edgeKind: "wall" },
    { match: "*{Tower,tower}*", category: "tower" },
    { match: "Door", category: "door", tags: ["door"] },
    { match: "Window*", category: "prop", tags: ["window"] },
    { match: "Bridge", category: "bridge" },
    { match: "Tunnel", category: "wall", attach: "gate", tags: ["arch"] },
    { match: "Well", category: "prop", tags: ["well"] },
    { match: "*", category: "prop" },
  ],
  overrides: {
    "wall-entrance": {
      tags: ["door", "scale-ref"],
      anchors: [{ id: "door", kind: "door", at: [0, 1.002, -0.116], facing: 0, height: 0.989 }],
    },
  },
} satisfies PackConfig
