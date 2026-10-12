/**
 * A modal's focus trap, as pure rules over element-like things (hud/Legends.tsx applies them to
 * the DOM), so they are tested without a browser.
 */

/** Everything that may take focus; `tabStops` keeps the ones Tab really reaches. */
export const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]"

export interface Focusable {
  tabIndex: number
  hasAttribute(name: string): boolean
}

/**
 * The elements Tab stops at, in order: not taken out of the order (`tabIndex < 0`: a roving
 * tablist's unselected tabs, a heading focused by script) and not disabled. Review-2 #13: an
 * unselected tab counted as the last stop, so the real last one (the tab panel) let Tab out.
 */
export function tabStops<T extends Focusable>(candidates: Iterable<T>): T[] {
  return [...candidates].filter((el) => el.tabIndex >= 0 && !el.hasAttribute("disabled"))
}

/**
 * Where Tab (or Shift+Tab) from `active` must go to stay inside, or undefined to let it move on
 * by itself. `start` is focused by script and is not a stop (the dialog's title): Shift+Tab from
 * it wraps to the last stop.
 */
export function wrapOf<T>(
  stops: readonly T[],
  active: unknown,
  back: boolean,
  start?: unknown,
): T | undefined {
  const first = stops[0]
  const last = stops.at(-1)
  if (first === undefined || last === undefined) return undefined
  if (back) return active === first || (start !== undefined && active === start) ? last : undefined
  return active === last ? first : undefined
}
