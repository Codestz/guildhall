/**
 * What the shell adds to the site's pieces (`@guildhall/ui` site style): the layers (world, pieces),
 * and the two small cards the pieces do not have: a repo's hall note (the HUD's place
 * until the hall screen is built) and the story chip. On the `.gh` tokens; phones (≤ 560 px) keep both
 * cards to a strip at the bottom edge.
 */
const CSS = /* css */ `
.site-root { position: absolute; inset: 0; overflow: hidden; background: #1b2418; }
.site-world { position: absolute; inset: 0; }
.site-pieces { display: contents; }

.gh .site-note, .gh .site-chip {
  position: absolute; z-index: 20; background: rgba(21, 17, 13, 0.95);
}
.gh .site-note { left: 16px; bottom: 16px; width: min(380px, calc(100% - 32px)); padding: 16px 18px 14px; }
.gh .site-note .ui-eyebrow { margin: 0; }
.gh .site-note h2 { margin: 4px 0 0; font: 400 24px/1.15 var(--display); letter-spacing: 0.03em; color: var(--paper); overflow-wrap: anywhere; }
.gh .site-note p { margin: 8px 0 0; font: 15px/1.5 var(--serif); color: var(--muted); }
.gh .site-note-links { display: flex; flex-wrap: wrap; gap: 0 18px; margin-top: 6px; }
.gh .site-note-hud {
  margin-top: 12px; padding: 10px 12px; border: 1px dashed var(--hair-2); border-radius: var(--r-sm);
  font: 12px/1.45 var(--mono); color: var(--faint);
}
.gh .site-chip {
  left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px;
  max-width: calc(100% - 32px); padding: 8px 8px 8px 16px; border-radius: 999px;
}
.gh .site-chip b { font: 400 15px/1.2 var(--display); letter-spacing: 0.05em; color: var(--paper); white-space: nowrap; }
.gh .site-chip span { font: 13px/1.3 var(--body); color: var(--muted); }
.gh .site-chip .ui-btn { flex: none; }

@media (max-width: 560px) {
  .gh .site-note { left: 0; right: 0; bottom: 0; width: 100%; padding: 14px 16px calc(8px + env(safe-area-inset-bottom)); border-radius: 14px 14px 0 0; border-bottom: 0; }
  .gh .site-note h2 { font-size: 21px; }
  .gh .site-note p { font-size: 14px; margin-top: 6px; }
  .gh .site-note-hud { display: none; }
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
