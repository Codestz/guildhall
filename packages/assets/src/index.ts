export type {
  CatalogEntry,
  CatalogIndex,
  Category,
  Kind,
  PieceFlag,
  RigEntry,
  ScaleFlag,
  ScaleInfo,
  ScaleTarget,
} from "./catalog.ts"
export { CATEGORIES, KINDS, PIECE_FLAGS, SCALE_FLAGS } from "./catalog.ts"
export type { ColourWeights, Lab, Rgb } from "./colour.ts"
export {
  EUCLIDEAN,
  hexToSrgb,
  labDistance2,
  linearToOklab,
  linearToSrgb,
  nearestSwatch,
  oklabToLinear,
  oklabToSrgb,
  SHADE_RANGE,
  shadeOf,
  srgbToLinear,
  srgbToOklab,
} from "./colour.ts"
export type {
  Anchor,
  AnchorKind,
  AttachRole,
  ComposeMeta,
  ComposeSource,
  EdgeKind,
  Facing,
} from "./compose.ts"
export { ANCHOR_KINDS, ATTACH_ROLES, EDGE_KINDS, FACINGS } from "./compose.ts"
export type { ColourMode, PackConfig, PackRule, PackScale, PieceOverride, Pivot } from "./pack.ts"
export type { Palette, PaletteJson, Ramp, Swatch, SwatchJson, Tone } from "./palette.ts"
export { loadPalette, paletteHash, paletteProblems, TONES } from "./palette.ts"
export type { Catalog, CatalogQuery, Facets } from "./query.ts"
export { createCatalog } from "./query.ts"
export { checkScale, DOOR_TOP, HERO_HEIGHT, SCALE_TARGETS } from "./scale.ts"
export { validateEntry, validateIndex } from "./validate.ts"

import paletteJson from "./palette.json" with { type: "json" }
import { loadPalette as load, type PaletteJson as PJ } from "./palette.ts"
/** The shared palette (placeholder until the user picks the swatches). */
export const PALETTE = load(paletteJson as PJ)
export type { Mount, MountClip, MountSlot, MountsFile, Vec3 } from "./mount.ts"
export { MOUNT_SLOTS, mountBasis, SLOT_FRAMES, validateMount, validateMounts } from "./mount.ts"
export type { NpcLook, NpcRecipe } from "./npc/recipe.ts"
export { validateNpc } from "./npc/recipe.ts"
export { holdsShield, resolveNpc, SKIN_RAMPS, standClip, TWO_HANDED_GUARD } from "./npc/resolve.ts"
export type { DataOverlay } from "./overlay.ts"
export { applyOverlay } from "./overlay.ts"
export { inStyle, STYLE_PACKS } from "./style.ts"
export { decodeShade, rampMapToSwatchMap, tintColours } from "./tint.ts"
