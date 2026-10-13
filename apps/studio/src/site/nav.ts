/** Moves the site to a URL in place: through `guildhall.open` (so `ready()` tracks it) when it is there. */
export function openUrl(url: string): void {
  if (window.guildhall) {
    void window.guildhall.open(url)
    return
  }
  history.pushState(null, "", url)
  dispatchEvent(new PopStateEvent("popstate"))
}
