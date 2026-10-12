// KayKit Halloween Bits, the town-useful part: iron fences, the gate arch and the lamps and lamp
// posts. The pumpkins, graves and skulls are seasonal and are not imported.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-halloween",
  source: "KayKit_HalloweenBits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/{fence,arch,lantern,post}*.gltf"],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1) for the arch (4.4 m, a gate over a hero) and the 3.3 m lamp posts.
  scale: { factor: 1 },
  // The iron fence is 2.2 raw, a prison railing next to the hero: x0.6 makes it a 1.3 m town railing.
  scaleBy: [{ match: "fence*", factor: 0.6 }],
  pivot: "bottom-centre",
  rules: [
    // The gate's finials top out at 1.8 m, over the fence band, as a gate stands above its railing: accepted.
    { match: "fence_gate", category: "fence", attach: "gate", edgeKind: "fence" },
    { match: "fence_pillar*", category: "fence", attach: "corner", edgeKind: "fence" },
    { match: "fence*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "arch*", category: "wall", attach: "gate", edgeKind: "wall", tags: ["arch"] },
    { match: "{lantern,post}*", category: "prop", tags: ["light"] },
  ],
  overrides: {
    fence: { tags: ["scale-ref"] },
  },
} satisfies PackConfig
