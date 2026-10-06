import type { Piece } from "./furniture.ts"

/**
 * How each role looks in the hall: which KayKit model, what it holds. The roster's `character` key
 * picks the model file; props are kit.glb pieces attached to the rig's hand slots.
 */
export const MODELS = ["knight", "barbarian", "mage", "rogue", "rogue-hooded", "ranger"] as const
export type Model = (typeof MODELS)[number]

export const modelUrl = (model: Model): string => `${import.meta.env.BASE_URL}assets/characters/${model}.glb`
export const ANIMS_URL = `${import.meta.env.BASE_URL}assets/anims.glb`
export const KIT_URL = `${import.meta.env.BASE_URL}assets/kit.glb`

export interface Gear {
  right?: Piece
  left?: Piece
}

export const GEAR: Record<string, Gear> = {
  "guild-master": { right: "staff" },
  "guild-architect": { left: "spellbook_open" },
  "guild-implementer": { right: "hammer_A" },
  "guild-verifier": { right: "dagger" },
  "guild-librarian": { left: "spellbook_closed" },
  "guild-explorer": { right: "crossbow_1handed" },
  "guild-researcher": { right: "wand" },
  "guild-designer": { left: "shield_badge_color" },
  "guild-product-owner": { right: "map_rolled" },
}

export function isModel(value: string): value is Model {
  return (MODELS as readonly string[]).includes(value)
}
