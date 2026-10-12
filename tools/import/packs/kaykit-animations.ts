// KayKit Character Animations 1.1: the Rig_Medium clip library every KayKit body shares. A rig-only
// pack: the mannequins are not pieces (Mannequin_Medium has no handslot bones, so it cannot take the
// rig's prop clips) and Rig_Large is not used. `include` names a file that does not exist, on purpose.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kaykit-animations",
  source: "KayKit_Character_Animations_1.1",
  vendor: "kaykit",
  license: "CC0",
  include: ["rig-only/none.glb"],
  colour: { mode: "material" },
  // The clips are authored on 2.2 m bodies: factor 1, like every Rig_Medium body.
  scale: { factor: 1 },
  pivot: "keep",
  rules: [],
  rigs: [{ id: "rig-medium", files: ["**/Animations/gltf/Rig_Medium/*.glb"] }],
} satisfies PackConfig
