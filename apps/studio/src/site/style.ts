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

.gh .site-chip { position: absolute; z-index: 20; background: rgba(21, 17, 13, 0.95); }
.gh .site-chip {
  left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px;
  max-width: calc(100% - 32px); padding: 8px 8px 8px 16px; border-radius: 999px;
}
.gh .site-chip b { font: 400 15px/1.2 var(--display); letter-spacing: 0.05em; color: var(--paper); white-space: nowrap; }
.gh .site-chip span { font: 13px/1.3 var(--body); color: var(--muted); }
.gh .site-chip .ui-btn { flex: none; }

@media (max-width: 560px) {
  .gh .site-chip { bottom: 12px; border-radius: 14px; align-items: flex-start; flex-wrap: wrap; }
  .gh .site-chip span { display: none; }
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
