/**
 * The story (V1's roadmap S3, ported): what the moments mean, in words. Pure: no React, no three, no DOM.
 *
 *   teller   changes in, told moments out: the sim's moments with a name, a colour and a party
 *   story    the phrase grammar and the Narrator (live captions, one line at a time)
 *   renown   the Deeds of Renown's rules (festival, ghost ship, rainbow, raid, comet, dragon)
 *   legends  `legendOf`: the session's book, one chapter per quest, and its Markdown
 *   recap    the Chronicle card's words: the hero moment (`heroOf`), the numbers, three lines
 */
export {
  type Chapter,
  clockOf,
  costOf,
  type DeedCount,
  duration,
  type Legend,
  legendMarkdown,
  legendOf,
  markdownText,
  NOTABLE_LABEL,
  type Notable,
  type NotableKind,
  type RenownEntry,
  renownText,
  renownTitle,
  seaNote,
  tokensOf,
  UNSUNG,
  type Unsung,
} from "./legends.ts"
export {
  compactOf,
  countOf,
  fileNameOf,
  HERO_WEIGHTS,
  type Hero,
  type HeroSubject,
  heroOf,
  LINE_RANK,
  linesOf,
  numbersOf,
  type Recap,
  type RecapLine,
  type RecapNumber,
  recapOf,
  sentenceCase,
} from "./recap.ts"
export {
  EVENT_KINDS,
  type EventKind,
  type Hero as RenownHero,
  heldSkyAt,
  type LedgerContext,
  type LedgerHappening,
  type Renown,
  type RenownFacts,
  RenownLedger,
  RULES,
  renownOf,
  type Sky,
  skyAt,
} from "./renown.ts"
export * from "./repo/index.ts"
export {
  type BeatKind,
  beatOf,
  type Caption,
  type CaptionPart,
  type ChapterTitle,
  chapterLine,
  clip,
  type Lookup,
  lineOf,
  listen,
  listOf,
  Narrator,
  type NarratorOptions,
  nth,
  PRIORITY,
  quote,
  renownLine,
  type Stream,
  seaLine,
  spell,
  type Told,
  toldOf,
} from "./story.ts"
export {
  type Actor,
  actorOf,
  byJoin,
  HARBOUR,
  type Names,
  namedOf,
  numbered,
  ordinalOf,
  type Sighting,
  type StoryHappening,
  type StoryMoment,
  Teller,
  tellAll,
} from "./teller.ts"
