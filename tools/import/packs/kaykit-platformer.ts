// KayKit Platformer: platforms, slopes, pillars, railings, arches, pipes, flags and signs on a 1-unit
// grid, in four colourways (blue, green, red, yellow) plus neutral pieces. Colourways are kept: the
// palette bake turns them into wood/stone/roof tones a recipe can pick between.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-platformer",
  source: "KayKit_Platformer_Pack_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/**/*.gltf"],
  // Game pickups and gadgets, not world dressing.
  exclude: [
    "**/{ball,bomb,heart,star,diamond,power,spring,button,lever,cone}*.gltf",
    "**/{spring_pad,button_base,lever_*}*.gltf",
  ],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1): a platform step is 1 m, a railing 1.2 m beside the 2.2 m hero.
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [
    { match: "railing_corner*", category: "fence", attach: "corner", edgeKind: "fence" },
    { match: "railing_*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "{arch,hoop}*", category: "wall", attach: "gate", tags: ["arch"] },
    { match: "{platform,floor,structure}*", category: "floor", attach: "floor" },
    { match: "{pillar,strut,bracing}*", category: "prop", tags: ["pillar"] },
    { match: "barrier_*", category: "prop", tags: ["block"] },
    { match: "pipe_*", category: "prop", tags: ["pipe"] },
    { match: "{flag,sign,signage}*", category: "prop", tags: ["sign"] },
    { match: "*", category: "prop" },
  ],
  overrides: { "railing-straight-single-blue": { tags: ["scale-ref"] } },
} satisfies PackConfig
