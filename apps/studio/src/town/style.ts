/** The town screen's own layout; the panels reuse the planner's `gh-pl-*` look (planner/style.ts). */
const CSS = /* css */ `
.gh-town { position: absolute; inset: 0; overflow: hidden; background: #120e0a; }
.gh-town .view { position: absolute; inset: 0; }
.gh-town .gh-pl-stats { max-height: calc(100% - 24px); }
.gh-town[data-ui="off"] .gh-panel { display: none; }
.gh-tw-hour { width: 100%; accent-color: var(--brass); }
.gh-tw-compare {
  position: absolute; right: 282px; bottom: 12px; margin: 0; width: 300px; padding: 6px;
  display: flex; flex-direction: column; gap: 4px;
}
.gh-tw-compare canvas { display: block; width: 100%; aspect-ratio: 1; border-radius: var(--r-sm); }
.gh-tw-compare figcaption { font: 11px/1.2 var(--mono); color: var(--faint); padding: 0 2px; }
.gh-tw-compare a { color: var(--brass-hi); }
.gh-town[data-ui="off"] .gh-tw-compare { display: flex; right: 12px; }
@media (max-width: 1100px) { .gh-tw-compare { right: 12px; width: 220px; } }
@media (max-width: 760px) { .gh-tw-compare { display: none; } }
`

let users = 0
let node: HTMLStyleElement | null = null

/** Adds the town stylesheet while the town is mounted. */
export function holdTownStyle(): { release(): void } {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "town"
    node.textContent = CSS
    document.head.append(node)
  }
  let released = false
  return {
    release() {
      if (released) return
      released = true
      if (--users > 0) return
      node?.remove()
      node = null
    },
  }
}
