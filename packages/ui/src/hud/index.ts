/**
 * The HUD panels (plan-hud-events.md U1): V1's HUD rebuilt as pure components on the `ui` tokens, fed by
 * props alone. The Viewer's HUD regions (U2) place them; the hall screen (H1) feeds them.
 */
export { BrandCard, type BrandCardProps, type BrandFigures, sourceWords } from "./Brand.tsx"
export {
  CHRONICLE_SHOWN,
  ChronicleFeed,
  type ChronicleFeedProps,
  Toasts,
  type ToastsProps,
} from "./Chronicle.tsx"
export { Dossier, type DossierProps, TRANSCRIPT_SHOWN } from "./Dossier.tsx"
export {
  clock,
  cost,
  count,
  day,
  FAMILY_LABEL,
  heroTitle,
  month,
  type PhaseTone,
  phaseOf,
  pickToasts,
  RANK_LABEL,
  span,
  type Tick,
  TOAST_LIFE,
  ticks,
  tokens,
} from "./format.ts"
export { Crest, FAMILY_GLYPH, Glyphs, Pennant } from "./glyphs.tsx"
export {
  CROWD_AT,
  type Crowd,
  crowdOf,
  type FamilyCount,
  type GroupBy,
  isCrowd,
  NOTABLE_MAX,
  pleasIn,
  type RosterGroup,
  rosterGroups,
} from "./group.ts"
export { PLEAS_SHOWN, Pleas, type PleasProps } from "./Pleas.tsx"
export { BannerChip, FamilyChip, FoldPanel, Sigil, Status } from "./parts.tsx"
export { Roster, RosterBadges, type RosterProps } from "./Roster.tsx"
export { SETTINGS_KEYS, SettingsPanel, type SettingsPanelProps } from "./Settings.tsx"
export { HUD_CSS, holdHudStyle } from "./style.ts"
export { Timeline, type TimelineProps } from "./Timeline.tsx"
export * from "./types.ts"
