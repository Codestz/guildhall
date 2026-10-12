// Test fixture pack (tools/import/test/fixtures/fixture-material): a two-material bush and a skinned villager.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "fixture-material",
  source: "fixture-material",
  vendor: "other",
  license: "CC0",
  include: ["*.glb"],
  colour: { mode: "material" },
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    { match: "bush*", category: "bush", tags: ["foliage"] },
    { match: "villager", category: "character" },
  ],
  characters: [{ match: "villager", rig: "fixture-rig" }],
} satisfies PackConfig
