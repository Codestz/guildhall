// Kenney Mini Forest: a forest camp on a 1-unit grid (platform, hut frame and roof, tent, ladder,
// bridge, trees, rocks). The archer is left out (only KayKit bodies are used).
import type { PackConfig } from "@guildhall/assets"

/**
 * The green texels of its trees, plant, grass patch and the grass top of the platform, by the teal tone they would bake to: teal reads
 * cold against the warm palette, so the dark half pins to leaf and the light half to grass; the
 * gradient left over survives as `_SHADE`.
 */
// biome-ignore format: one tone per block
const GREENS: Record<string, string[]> = {
  leaf: [
    "#53a58a", "#54a68a", "#55a78a", "#56a78a",
  ],
  grass: [
    "#57a88a", "#58a88a", "#58a98a", "#59a98a", "#5aa98a", "#5aaa89", "#5baa89", "#5bab89", "#5cab89", "#5dac89",
    "#5eac89", "#5ead89", "#60ae89", "#61ae89", "#61af89", "#62af89", "#63b089", "#64b089", "#65b189", "#66b189",
    "#66b289", "#67b289", "#68b389", "#69b389", "#69b489", "#6ab488", "#6bb588", "#6cb588", "#6cb688", "#6eb788",
    "#6fb788", "#70b888", "#71b988", "#72b988", "#72ba88", "#73ba88", "#74bb88", "#75bb88", "#75bc88", "#76bc88",
    "#77bd88", "#78bd88", "#78be88", "#79be88", "#7abf87", "#7cc087", "#7dc087", "#7ec187", "#7fc287", "#80c287",
    "#80c387", "#81c387", "#82c487", "#83c487", "#83c587", "#84c587", "#85c687",
  ],
}

export default {
  id: "kenney-mini-forest",
  source: "kenney_mini-forest_1.0",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  exclude: ["**/character-*.glb"],
  colour: {
    mode: "colormap",
    map: Object.fromEntries(Object.entries(GREENS).flatMap(([tone, hexes]) => hexes.map((h) => [h, tone]))),
  },
  // The kit's archer is 0.82 raw: x3 sizes the camp to a hero, so the hut frame is a 3 m storey, a
  // tree 5-6.9 m and the fence 1.2 m.
  scale: { factor: 3 },
  pivot: "bottom-centre",
  rules: [
    { match: "building-roof", category: "roof", attach: "roof" },
    { match: "building-structure", category: "wall", attach: "wall-segment" },
    { match: "{building-platform,platform}", category: "floor", attach: "floor" },
    { match: "tent", category: "prop", tags: ["shelter", "tent"] },
    { match: "fence", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "tree*", category: "tree" },
    { match: "rocks-*", category: "cliff", attach: "edge-dressing", edgeKind: "cliff-face" },
    { match: "stones", category: "rock" },
    { match: "patch-*", category: "ground", attach: "ground" },
    { match: "plant", category: "bush" },
    { match: "bridge", category: "bridge" },
    { match: "weapon-*", category: "prop", attach: "held", tags: ["weapon"] },
    { match: "*", category: "prop" },
  ],
  overrides: { tree: { tags: ["scale-ref"] } },
} satisfies PackConfig
