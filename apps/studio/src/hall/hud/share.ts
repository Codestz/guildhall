/**
 * The way from the site's crest menu to the island's Chronicle card: the HUD offers "Share island" while
 * it can draw a card (a repo's chronicle, or a session's story so far) and takes the offer back when it
 * goes; the site's menu shows the item while one is offered. A tiny store: the menu is the site's chunk,
 * the card the HUD's.
 */
let offered: (() => void) | null = null
const fns = new Set<() => void>()

/** Offers (or, with null, takes back) the island's card. */
export function offerShare(open: (() => void) | null): void {
  offered = open
  for (const fn of fns) fn()
}

/** What opens the card now, or null (a `useSyncExternalStore` snapshot). */
export const shareOffer = (): (() => void) | null => offered

export function onShareOffer(fn: () => void): () => void {
  fns.add(fn)
  return () => fns.delete(fn)
}
