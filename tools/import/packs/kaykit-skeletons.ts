// KayKit Skeletons 1.1: four skeleton bodies on Rig_Medium and their weapons.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-skeletons",
  source: "KayKit_Skeletons_1.1_FREE",
  vendor: "kaykit",
  license: "CC0",
  include: ["**/characters/gltf/*.glb", "**/assets/gltf/*.gltf"],
  colour: { mode: "atlas" },
  // Hero scale as authored (Minion 2.17 raw, Warrior 2.59 with its helmet): factor 1, as the adventurers.
  scale: { factor: 1 },
  // Held props keep their grip origin (see kaykit-adventurers): `sunk`/`off-centre` by design.
  pivot: "keep",
  rules: [
    { match: "**/characters/**", category: "character", tags: ["skeleton"] },
    { match: "Skeleton_Shield_*", category: "prop", attach: "held", tags: ["shield"] },
    { match: "Skeleton_{Arrow,Quiver}*", category: "prop", attach: "held", tags: ["ammo", "weapon"] },
    { match: "Skeleton_*", category: "prop", attach: "held", tags: ["weapon"] },
  ],
  overrides: { "skeleton-minion": { tags: ["scale-ref"] } },
  characters: [{ match: "**/characters/**", rig: "rig-medium" }],
  rigs: [{ id: "rig-medium", files: ["**/Animations/gltf/Rig_Medium/*.glb"] }],
} satisfies PackConfig
