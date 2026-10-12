// Kenney Platformer Kit: grass and snow terrace blocks, fences, hedges, trees, ladders, doors and
// crates. The characters (only KayKit bodies are used) and the game pickups and traps are left out.
import type { PackConfig } from "@guildhall/assets"

/**
 * The green texels of its grass blocks, hedges, trees and plants, by the teal tone they would bake to: teal reads
 * cold against the warm palette, so the dark half pins to leaf and the light half to grass; the
 * gradient left over survives as `_SHADE`.
 */
// biome-ignore format: one tone per block
const GREENS: Record<string, string[]> = {
  leaf: [
    "#20896b", "#218a6c", "#228a6c", "#228b6c", "#238c6d", "#248d6d", "#258e6e", "#268f6e", "#27906e", "#27906f",
    "#28916f", "#299270", "#2a9370", "#2b9470", "#2b9471", "#2c9571", "#2d9671", "#2d9672", "#2e9772", "#2e9872",
    "#2f9873", "#309973", "#319a73", "#319a74", "#329b74", "#329c74", "#339c75", "#349d75", "#359e75", "#359e76",
    "#369f76", "#36a076", "#37a076", "#37a177", "#38a177", "#39a277", "#39a278", "#3aa378", "#3aa478", "#3ba478",
    "#3ba579", "#3ca579", "#3da679", "#3ea77a", "#3ea87a", "#3fa87a", "#3fa97b", "#40a97b", "#40aa7b", "#41aa7b",
  ],
  grass: [
    "#42ab7c", "#42ac7c", "#43ac7c", "#43ad7c", "#44ad7d", "#44ae7d", "#45ae7d", "#45af7e", "#46b07e", "#47b07e",
    "#47b17e", "#48b17f", "#48b27f", "#49b27f", "#49b37f", "#4ab480", "#4bb480", "#4bb580", "#4cb581", "#4cb681",
    "#4db681", "#4db781", "#4eb882", "#4fb982", "#50b982", "#50ba83", "#51ba83", "#51bb83", "#52bc84", "#54bd84",
    "#54be85", "#55be85", "#55bf85", "#56c086", "#57c186", "#58c287", "#59c287", "#59c387", "#5ac487",
  ],
}

export default {
  id: "kenney-platformer",
  source: "kenney_platformer-kit",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  exclude: [
    "**/character-*.glb",
    "**/{coin-*,heart,star,jewel,key,lock,button-*,spike-*,trap-*,saw,spring,conveyor-belt,block-moving*,bomb,lever,arrow,arrows}.glb",
  ],
  colour: {
    mode: "colormap",
    map: Object.fromEntries(Object.entries(GREENS).flatMap(([tone, hexes]) => hexes.map((h) => [h, tone]))),
  },
  // The kit's characters are 0.9 raw and its doors 1.0: x2.5 makes a door 2.5 m (the hero walks
  // through it), a block a 2.5 m terrace step and a tree 4.8-5 m.
  scale: { factor: 2.5 },
  pivot: "bottom-centre",
  rules: [
    { match: "door-*", category: "door", tags: ["door"] },
    { match: "block-*", category: "ground", attach: "ground", tags: ["terrace"] },
    { match: "fence-*corner*", category: "fence", attach: "corner", edgeKind: "fence" },
    // fence-low-* and fence-rope are 0.75 m border rails, under the fence band by design.
    { match: "fence-*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "hedge*", category: "bush", attach: "edge-dressing", edgeKind: "hedge", tags: ["hedge"] },
    // tree-pine-small and its snow twin are 3.5 m young pines, under the tree band by design.
    { match: "tree-*", category: "tree" },
    { match: "{flowers*,grass,plant,mushrooms,stones}", category: "ground", attach: "ground" },
    { match: "rocks", category: "rock" },
    { match: "{platform*,pipe}", category: "floor", attach: "floor" },
    { match: "*", category: "prop" },
  ],
  overrides: { "door-rotate": { tags: ["door", "scale-ref"] } },
} satisfies PackConfig
