import type { MouseEvent } from "react"
import { linkTo } from "./directory.ts"

/** Opens a screen in place: through `guildhall.open` (so `ready()` tracks the mount) when it is there. */
export function go(id: string): void {
  const search = linkTo(id)
  if (window.guildhall) {
    void window.guildhall.open(search)
    return
  }
  history.pushState(null, "", search)
  dispatchEvent(new PopStateEvent("popstate"))
}

/**
 * A link's click handler: a plain click opens the screen in place; a modified click (new tab, new
 * window) is left to the browser, which follows the real `href`.
 */
export function follow(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    go(id)
  }
}
