// KayKit Adventurers 2.0: the six hero bodies (Rig_Medium) and the props they hold.
import type { PackConfig } from "@guildhall/assets"

/**
 * The skin cell every hero atlas shares (top-left, #f8ccab down to #f2a87e), by the skin tone each
 * texel is nearest. No other KayKit piece samples these colours. Skin is pin-only (sample.ts), so they
 * are pinned here; the gradient left over survives as `_SHADE`.
 */
// biome-ignore format: one tone per block
const SKIN: Record<string, string[]> = {
  "skin-light": [
    "#f8ccab", "#f8ccaa", "#f8cbaa", "#f8cba9", "#f8caa9", "#f8caa8", "#f8c9a8", "#f8c9a7", "#f7c9a7", "#f7c8a7",
    "#f7c8a6", "#f7c7a5", "#f7c7a4", "#f7c6a4", "#f7c6a3", "#f7c5a3", "#f7c5a2", "#f7c4a2", "#f7c4a1", "#f7c4a0",
    "#f7c3a0", "#f6c3a0", "#f6c39f", "#f6c29f", "#f6c29e", "#f6c19e", "#f6c19d", "#f6c09d", "#f6c09c", "#f6c09b",
  ],
  skin: [
    "#f6bf9b", "#f6bf9a", "#f6be9a", "#f6be99", "#f6bd99", "#f6bd98", "#f5bd98", "#f5bc98", "#f5bc97", "#f5bc96",
    "#f5bb96", "#f5bb95", "#f5ba95", "#f5ba94", "#f5b994", "#f5b993",
  ],
  "skin-dark": [
    "#f5b893", "#f5b892", "#f5b891", "#f5b791", "#f4b791", "#f4b790", "#f4b690", "#f4b68f", "#f4b58f", "#f4b58e",
    "#f4b48d", "#f4b48c", "#f4b38c", "#f4b38b", "#f4b28b", "#f4b28a", "#f4b18a", "#f3b189", "#f3b088", "#f3af87",
    "#f3af86", "#f3ae86", "#f3ae85", "#f3ad85", "#f3ad84", "#f3ac83", "#f3ab82", "#f2ab82", "#f2ab81", "#f2aa81",
    "#f2aa80", "#f2a980", "#f2a97f", "#f2a87e",
  ],
}

export default {
  id: "kaykit-adventurers",
  source: "KayKit_Adventurers_2.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Characters/gltf/*.glb", "**/Assets/gltf/*.gltf"],
  colour: {
    mode: "atlas",
    map: Object.fromEntries(Object.entries(SKIN).flatMap(([tone, hexes]) => hexes.map((h) => [h, tone]))),
  },
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
