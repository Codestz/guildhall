// Test fixture pack (tools/import/test/fixtures/fixture-colormap): a flat-colormap wall panel.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "fixture-colormap",
  source: "fixture-colormap",
  vendor: "other",
  license: "CC0",
  include: ["**/*.glb"],
  colour: { mode: "colormap" },
  scale: { ref: "wall-door", measure: "height", metres: 3 },
  pivot: "keep",
  rules: [{ match: "wall*", category: "wall", attach: "wall-segment", tags: ["wall"] }],
} satisfies PackConfig
