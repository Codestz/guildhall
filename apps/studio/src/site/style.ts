/**
 * What the shell adds to the site's pieces (`@guildhall/ui` site style): the layers (world, pieces), where
 * a hall's HUD sits round the site's crest, and the story chip. On the `.gh` tokens; phones (≤ 560 px)
 * keep the chip to a strip at the bottom edge.
 */
const CSS = /* css */ `
.site-root { position: absolute; inset: 0; overflow: hidden; background: #1b2418; }
.site-world { position: absolute; inset: 0; }
.site-pieces { display: contents; }
/* of the Viewer's own chrome the site keeps the loading cover only (the HUD is its own layer) */
.site-root:not([data-dev]) .site-world .ui-viewer-chrome > :not(.ui-loader) { display: none; }
/* the cover is the whole screen: the crest and the card wait for the reveal */
.site-root[data-cover] .site-pieces { visibility: hidden; }

/* a hall's HUD (the Viewer's HUD regions, hall/hud) starts in the crest's row (its repo chip right of the
   crest, hall/hud/style.ts); with ?dev=1 the Viewer's tools and Inspector show too, and the HUD's rail
   steps down below them */
.site-world .ui-viewer { --gut: var(--site-edge, 16px); --hud-top: var(--gut); }
.site-world .ui-viewer[data-phone] { --gut: 12px; }
.site-root[data-dev] .site-world .ui-hud-rail { top: 60px; }

/* the welcome bar owns the foot of a wide screen while it is up: the HUD's bottom row rides above it (SiteApp
   sets --welcome-h to the bar's height). A phone's welcome is a button in the top row: the foot stays the HUD's */
.site-root[data-welcome] .ui-viewer:not([data-phone]) .ui-hud-bottom { bottom: calc(var(--gut) + var(--welcome-h, 0px) + 12px); }
/* the top row on a phone with "Your repo" in it: the repo chip leaves it room */
.site-root:has(.site-welcome[data-dock="top"]) .ui-viewer[data-phone] { --rail-w: 156px; }
/* < 400 px "Your repo" is its icon alone (packages/ui site/style.ts), 44 px + 8 px */
@media (max-width: 399px) {
  .site-root:has(.site-welcome[data-dock="top"]) .ui-viewer[data-phone] { --rail-w: 104px; }
}
/* a screen on its side (a container up to 460 px tall): the caption is one line, its rows run on, so the
   island keeps the height (the welcome is the top row's button there, packages/ui site/style.ts) */
@container viewer (max-height: 460px) {
  .ui-viewer:not([data-phone]) .hall-caps .st-caption:not([data-kind="chapter"]) { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ui-viewer:not([data-phone]) .hall-caps .st-caption:not([data-kind="chapter"]) .st-caption-row { display: inline; padding: 0; margin: 0; overflow: visible; }
  .ui-viewer:not([data-phone]) .hall-caps .st-caption-row + .st-caption-row::before { content: " "; }
}
`

let users = 0
let node: HTMLStyleElement | null = null

/** The shell's site sheet, while a site screen is up. */
export function holdSiteShellStyle(): () => void {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "site-shell"
    node.textContent = CSS
    document.head.append(node)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users > 0) return
    node?.remove()
    node = null
  }
}
