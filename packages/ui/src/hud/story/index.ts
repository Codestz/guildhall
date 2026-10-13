/**
 * Story and sharing (plan-hud-events.md U3): V1's Legends book, Chronicle card, captions, chapter chip,
 * town dossier (as a place's) and README badge, as props-only pieces on the `ui` tokens.
 */
export { CAPTION_FADE_MS, Captions, type CaptionsProps } from "./Captions.tsx"
export { ChapterChip, type ChapterChipProps } from "./ChapterChip.tsx"
export { altOf, ChronicleCard, type ChronicleCardProps } from "./ChronicleCard.tsx"
export {
  CARD_FACES,
  cardBlob,
  cardFileName,
  contrast,
  drawCard,
  type Format as CardFormat,
  loadCardFaces,
  type Run,
  readable,
  SIZES as CARD_SIZES,
  wrapRuns,
} from "./cardDraw.ts"
export { canCopyImage, copyImage, copyText } from "./clipboard.ts"
export { FOCUSABLE, tabStops, trapTab, useModalFocus } from "./focus.ts"
export { RenownGlyph, StoryGlyphs } from "./glyphs.tsx"
export { type BookView, LegendsBook, type LegendsBookProps } from "./Legends.tsx"
export { PLACE_DEEDS_SHOWN, PlaceDossier, type PlaceDossierProps } from "./PlaceDossier.tsx"
export {
  BADGE_IMAGE,
  badgeMarkdown,
  islandLink,
  ReadmeBadge,
  type ReadmeBadgeProps,
  SITE,
} from "./ReadmeBadge.tsx"
export { STORY_CSS } from "./style.ts"
export * from "./types.ts"
export { clockOf, costOf, duration, spell, tokensOf } from "./words.ts"
