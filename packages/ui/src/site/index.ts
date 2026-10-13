/**
 * The site's own UI (Track S): the first-visit welcome card, the crest menu, the demo picker and the
 * "How it's built" page. Props only: the shell routes, remembers and feeds the content.
 */
export {
  type Block,
  type BuiltContent,
  BuiltPage,
  type BuiltPageProps,
  type BuiltSection,
  type JourneyPost,
} from "./BuiltPage.tsx"
export { CrestMenu, type CrestMenuProps, type SiteDest } from "./CrestMenu.tsx"
export { DemoPicker, type DemoPickerProps, type Story, type StoryAct } from "./DemoPicker.tsx"
export {
  parseRepo,
  type RepoParse,
  readWelcomeDismissed,
  WELCOME_KEY,
  writeWelcomeDismissed,
} from "./repo.ts"
export { holdSiteStyle, SITE_CSS } from "./style.ts"
export { WelcomeCard, type WelcomeCardProps } from "./WelcomeCard.tsx"
