/**
 * The repository's story (plan-hud-events.md, "Repository story"): a Repo Chronicle (sim/repo) told in
 * the hall's voice. Pure: no React, no three, no DOM.
 *
 *   eras     the era rule: by major release, else by the calendar, merged to a book of 4–10 chapters
 *   facts    what happened in each era, read off the chronicle
 *   legend   `repoLegendOf`: the Legends book's History by era, each chapter with its island's size
 *   recap    `repoRecapOf`: the Repo Chronicle card (figures, the island today, three highlights)
 */
export {
  commitsIn,
  type EraRule,
  type EraSpan,
  type Eras,
  erasOf,
  MAX_ERAS,
  MIN_ERAS,
  majorsOf,
} from "./eras.ts"
export { type EraFacts, factsOf, isPlace, placesNow } from "./facts.ts"
export {
  figuresOf,
  type RepoEra,
  type RepoFigures,
  type RepoLegend,
  type RepoMilestone,
  type RepoMilestoneKind,
  type RepoStoryOptions,
  repoLegendMarkdown,
  repoLegendOf,
  shortName,
} from "./legend.ts"
export {
  HALL_SITE,
  type HighlightKind,
  highlightsOf,
  type RepoHighlight,
  type RepoRecap,
  repoCardName,
  repoRecapOf,
} from "./recap.ts"
export { ageOf, isMajor, isRelease, plain, spanOf } from "./words.ts"
