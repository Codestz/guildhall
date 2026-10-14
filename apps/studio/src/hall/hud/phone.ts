/**
 * The phone's HUD rules (decisions.md "Phone GUI (user, 10-13)"): one menu behind ☰, a bottom sheet with
 * tabs (Guild · Places · Chronicle · Settings), and a face bar at the foot beside the act chip. Pure: the
 * HUD (HallHud.tsx) reads them, the tests pin them.
 */

/** A tab of the phone's menu, as the HUD's own panel id. */
export type MenuTab = "roster" | "places" | "chronicle" | "settings"

/** Each tab's word on the tab bar (and its `data-tab`, in lower case). */
export const TAB_LABEL: Readonly<Record<MenuTab, string>> = {
  roster: "Guild",
  places: "Places",
  chronicle: "Chronicle",
  settings: "Settings",
}

/** The menu's tabs in order: the Guild only with a session, the Places only on a repo's island. */
export function menuTabs(has: { guild: boolean; places: boolean }): MenuTab[] {
  const tabs: MenuTab[] = []
  if (has.guild) tabs.push("roster")
  if (has.places) tabs.push("places")
  tabs.push("chronicle", "settings")
  return tabs
}

/**
 * The tab the menu shows for the HUD's state, or null (the menu folded): an open tab, or the tab a place's
 * or a hero's dossier was opened from (the dossier shows under it, with the way back).
 */
export function menuTab(open: string | null, back: string | null, tabs: readonly MenuTab[]): MenuTab | null {
  const tab = (id: string | null) =>
    id !== null && (tabs as readonly string[]).includes(id) ? (id as MenuTab) : null
  if (tab(open)) return tab(open)
  if (open === "dossier" || open === "hero") return tab(back)
  return null
}

/** The tab ☰ opens: the one seen last if it is still offered, else the first. */
export function menuOpens(last: MenuTab | null, tabs: readonly MenuTab[]): MenuTab {
  return last && tabs.includes(last) ? last : (tabs[0] ?? "settings")
}

/** A face on the phone's bar, CSS px (a 40 px round portrait in its 44 px tap target), and the gap between two. */
export const FACE_PX = 44
export const FACE_GAP = 2
/** The bar's own padding and border, both sides together, and its +N (or ⤢) button. */
const BAR_PAD = 10
const BAR_MORE = 42
/** Between the face bar and the act chip. */
const ROW_GAP = 8

/**
 * How many faces the face bar holds on a viewer `width` px wide with `gut` px each side, beside `beside`
 * px of the act chip (0: none): every face that fits, at least one.
 */
export function faceSlots(width: number, gut: number, beside = 0): number {
  const room = width - 2 * gut - (beside > 0 ? beside + ROW_GAP : 0) - BAR_PAD - BAR_MORE
  return Math.max(1, Math.floor((room + FACE_GAP) / (FACE_PX + FACE_GAP)))
}
