// KayKit Fantasy Weapons Bits: swords, axes, bows, spears, shields and staffs for the hand slots.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-weapons",
  source: "KayKit_FantasyWeaponsBits_1.0_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/Assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // KayKit hero units (factor 1): a sword is 1.8 m against the 2.2 m chibi hero, as in KayKit's renders.
  scale: { factor: 1 },
  // The grip is the origin (they mount on a hand bone), so it is kept: `sunk`/`off-centre` by design.
  pivot: "keep",
  rules: [
    { match: "shield_*", category: "prop", attach: "held", tags: ["shield"] },
    { match: "arrow_*", category: "prop", attach: "held", tags: ["ammo", "weapon"] },
    { match: "*", category: "prop", attach: "held", tags: ["weapon"] },
  ],
  overrides: { "sword-a": { tags: ["scale-ref"] } },
} satisfies PackConfig
