import { resolve } from "../shell/router.ts"

/** What opens the demo picker over the page in place (SiteApp, while a site page is up), or null. */
let demosInPlace: (() => void) | null = null

/**
 * Lets the site open the demos over whatever it shows (an island, a hall, a page) instead of moving to
 * `/demos`: every way there (the crest menu, the welcome card, the HUD's "Watch a demo") then opens the
 * picker in place, and closing it leaves the visitor where they were. Null hands `/demos` back to the
 * router. A direct visit to `/demos` is its own screen still.
 */
export function openDemosWith(open: (() => void) | null): void {
  demosInPlace = open
}

/** Whether `url` is the demos' own address. */
function isDemos(url: string): boolean {
  const at = new URL(url, location.href)
  return at.origin === location.origin && resolve(at.pathname, at.search).screen === "demos"
}

/** Moves the site to a URL in place: through `guildhall.open` (so `ready()` tracks it) when it is there. */
export function openUrl(url: string): void {
  if (demosInPlace && isDemos(url)) {
    demosInPlace()
    return
  }
  if (window.guildhall) {
    void window.guildhall.open(url)
    return
  }
  history.pushState(null, "", url)
  dispatchEvent(new PopStateEvent("popstate"))
}
