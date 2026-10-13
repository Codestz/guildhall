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

/* a hall's HUD (the Viewer's HUD regions, hall/hud) sits under the crest; with ?dev=1 the Viewer's tools
   and Inspector show too, and the HUD's rail steps down below them */
.site-world .ui-viewer { --hud-top: 72px; --gut: var(--site-edge, 16px); }
.site-world .ui-viewer[data-phone] { --hud-top: 64px; --gut: 12px; }
.site-root[data-dev] .site-world .ui-hud-rail { top: 60px; }

/* the welcome bar owns the foot of the screen while it is up: the HUD's bottom row rides above it (SiteApp sets
   --welcome-h to the bar's height); on a phone the Chronicle chip rides up with it */
.site-root[data-welcome] .ui-hud-bottom { bottom: calc(var(--gut) + var(--welcome-h, 0px) + 12px); }
.site-root[data-welcome] .ui-viewer[data-phone] .ui-hud-bottom { bottom: calc(var(--welcome-h, 0px) + 24px + env(safe-area-inset-bottom)); }
.site-root[data-welcome] .ui-viewer[data-phone] .ui-hud-feed { bottom: calc(var(--welcome-h, 0px) + 24px + 64px + env(safe-area-inset-bottom)); }
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
