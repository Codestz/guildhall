// Test fixture pack (tools/import/test/fixtures/fixture-atlas): a gradient-atlas crate.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "fixture-atlas",
  source: "fixture-atlas",
  vendor: "other",
  license: "CC0",
  include: ["*.glb"],
  colour: { mode: "atlas" },
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [{ match: "crate*", category: "prop", tags: ["storage"] }],
} satisfies PackConfig
