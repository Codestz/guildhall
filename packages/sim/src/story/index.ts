/**
 * The story (V1's roadmap S3, ported): what the moments mean, in words. Pure: no React, no three, no DOM.
 *
 *   teller   changes in, told moments out: the sim's moments with a name, a colour and a party
 *   story    the phrase grammar and the Narrator (live captions, one line at a time)
 *   renown   the Deeds of Renown's rules (festival, ghost ship, rainbow, raid, comet, dragon)
 *   legends  `legendOf`: the session's book, one chapter per quest, and its Markdown
 *   recap    the Chronicle card's words: the hero moment (`heroOf`), the numbers, three lines
 *   worldEvents  the world events on stage: `worldShows(log, t)`, the renown rules scheduled as shows
 *   living   what the work touches, place by place: reads glow, edits scaffold, failures blight
 *   purse    a party's spending over time (the raid's treasury rule), from the session's changes
 */

export { commandWords, type DeedWords, deedWords } from "./commands.ts"
export {
  type GravePhase,
  type GraveState,
  graveAt,
  gravesOf,
  UNDEAD_KINDS,
  type UndeadKind,
  undeadKind,
} from "./graveyard.ts"
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
  blightSpans,
  editedPlaces,
  LIVING,
  type LivingKind,
  type LivingSpan,
  livingAt,
  livingLevel,
  type PlaceLiving,
  workSpans,
} from "./living.ts"
export { PurseBook } from "./purse.ts"
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
  type Cast,
  HARBOUR,
  joinIndexOf,
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
export {
  dismissed,
  forcedShow,
  type Grave,
  type GraveCause,
  LASTING_SHOWS,
  renownKindOf,
  SHOW_KINDS,
  SHOW_LOOK,
  SHOW_RULES,
  type Show,
  ShowEngine,
  type ShowHint,
  type ShowKind,
  type ShowParams,
  type ShowWhere,
  type ShowWho,
  showHint,
  showLine,
  type WorldShowOptions,
  worldShows,
} from "./worldEvents.ts"
