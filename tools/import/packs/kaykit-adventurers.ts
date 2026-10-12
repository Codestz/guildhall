// KayKit Adventurers 2.0: the six hero bodies (Rig_Medium) and the props they hold.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-adventurers",
  source: "KayKit_Adventurers_2.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Characters/gltf/*.glb", "**/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // KayKit is authored at hero scale: Rogue stands 2.18 raw, Knight 2.54 to the helmet crest. The
  // hero is 2.2 m native (ADR 004), so the bodies, the rig and its clips keep factor 1.
  scale: { factor: 1 },
  // Held props are authored with the grip at the origin (they mount on a hand bone), so the origin
  // is kept: their `sunk`/`off-centre` flags mark that grip, by design.
  pivot: "keep",
  rules: [
    { match: "**/Characters/**", category: "character", tags: ["hero"] },
    { match: "{arrow,quiver}*", category: "prop", attach: "held", tags: ["ammo", "weapon"] },
    { match: "shield_*", category: "prop", attach: "held", tags: ["shield"] },
    {
      match: "{axe,bow,crossbow,dagger,staff,sword,wand,smokebomb}*",
      category: "prop",
      attach: "held",
      tags: ["weapon"],
    },
    { match: "spellbook_*", category: "prop", attach: "held", tags: ["book"] },
    { match: "mug_*", category: "prop", attach: "held", tags: ["mug"] },
  ],
  // Rogue (2.18 m, no hat) is the hero the scale scene stands everything against.
  overrides: { rogue: { tags: ["scale-ref"] } },
  characters: [{ match: "**/Characters/**", rig: "rig-medium" }],
  rigs: [{ id: "rig-medium", files: ["**/Animations/gltf/Rig_Medium/*.glb"] }],
} satisfies PackConfig
