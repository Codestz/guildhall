/**
 * The HUD lab's layout: V1's regions (hall.css `.region-*`, `.toolbar`, `.toasts`, `.timeline`) over a
 * still of the island. The panels style themselves (@guildhall/ui HUD_CSS); this only places them. On a
 * phone the sheets (dossier, settings) take the bottom and hide the toasts and timeline under them.
 */
export const LAB_CSS = /* css */ `
.lab-hud-root { position: absolute; inset: 0; overflow: hidden; background: #2d3b2a url("/lab/hud/hud-bg.webp") center / cover no-repeat; }
.lab-hud { --gut: 16px; --bar: 40px; position: absolute; inset: 0; pointer-events: none; }
.lab-hud > * { position: absolute; pointer-events: none; }
.lab-hud > * > * { pointer-events: auto; }
.lab-left { top: var(--gut); left: var(--gut); bottom: calc(var(--gut) + 38% + 10px); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-height: 0; max-width: 304px; }
.lab-hud[data-mode="minimal"] .lab-left { bottom: auto; }
.lab-left .lab-roster { flex: 0 1 auto; }
.lab-pleas { top: var(--gut); left: 50%; translate: -50% 0; width: min(460px, calc(100% - 2 * 340px)); }
.lab-tools { top: var(--gut); right: var(--gut); display: flex; gap: 8px; z-index: 3; }
.lab-right { top: calc(var(--gut) + var(--bar) + 10px); right: var(--gut); bottom: var(--gut); width: 372px; display: flex; flex-direction: column; align-items: stretch; min-height: 0; }
.lab-right > * { flex: 0 1 auto; }
.lab-bottom-left { left: var(--gut); bottom: var(--gut); max-height: 38%; width: 400px; display: flex; flex-direction: column; justify-content: flex-end; min-height: 0; }
.lab-bottom-left .lab-chronicle { flex: 0 1 auto; }
.lab-bottom { left: 50%; bottom: var(--gut); translate: -50% 0; width: min(680px, calc(100% - 2 * (400px + 2 * var(--gut)))); min-width: 360px; }
.lab-bottom .hud-timeline { width: 100%; }
/* the right sheet open: the timeline makes room on its right */
.lab-hud[data-sheet="true"] .lab-bottom { width: min(560px, calc(100% - 400px - 372px - 4 * var(--gut))); left: calc(400px + 2 * var(--gut)); translate: 0 0; }

/* U3: the story layer: an icon rail beside the tools, the captions strip above the timeline, the chapter
   chip bottom-right, a place as the right-hand sheet (its chip under the tools when folded) */
.lab-story { inset: 0; }
.lab-story > :not(.st-scrim) { position: absolute; }
/* the lab's HUD area is under the studio bar: overlays fill it, not the viewport */
.lab-story > .st-scrim { position: absolute; }
.lab-story-rail { top: var(--gut); right: calc(var(--gut) + 2 * var(--bar) + 16px); display: flex; gap: 8px; z-index: 5; }
.lab-captions { left: 50%; translate: -50% 0; bottom: calc(var(--gut) + 74px); width: min(760px, calc(100% - 2 * (var(--gut) + 416px))); display: flex; justify-content: center; }
.lab-chapter { right: var(--gut); bottom: var(--gut); z-index: 3; }
.lab-place { top: calc(var(--gut) + var(--bar) + 10px); right: var(--gut); bottom: var(--gut); width: 372px; display: flex; flex-direction: column; z-index: 3; }
.lab-place[data-fold="true"] { bottom: auto; width: auto; align-items: flex-end; }

@media (max-width: 720px) {
  .lab-story-rail { top: calc(var(--gut) + var(--bar) + 8px); right: var(--gut); flex-direction: column; }
  .lab-captions { left: var(--gut); right: var(--gut); width: auto; translate: none; bottom: calc(var(--gut) + 116px); }
  /* one voice at the bottom (V1): with captions on, the toasts fold to their button */
  .lab-hud:has(.lab-captions) .hud-toast-list { display: none; }
  .lab-chapter { bottom: calc(var(--gut) + 60px); }
  .lab-place { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: 76%; }
  .lab-place[data-fold="true"] { left: auto; right: var(--gut); top: calc(var(--gut) + var(--bar) + 162px); bottom: auto; }
  .lab-hud-root { background-size: cover; background-position: 62% 70%; }
  .lab-hud { --gut: 10px; }
  .lab-left { right: calc(var(--gut) + 2 * var(--bar) + 16px); bottom: auto; max-width: none; }
  .lab-left > * { width: 100%; }
  .lab-pleas { top: calc(var(--gut) + 116px); left: var(--gut); right: var(--gut); width: auto; translate: none; }
  .lab-right { top: auto; left: var(--gut); right: var(--gut); bottom: var(--gut); width: auto; max-height: 72%; z-index: 4; }
  .lab-bottom-left { left: var(--gut); right: var(--gut); width: auto; bottom: calc(var(--gut) + 52px + 8px); max-height: 40%; }
  .lab-bottom { left: var(--gut); right: var(--gut); width: auto; min-width: 0; translate: none; }
  .lab-hud[data-sheet="true"] .lab-bottom { left: var(--gut); width: auto; }
  .lab-hud[data-sheet="true"] :is(.lab-bottom, .lab-bottom-left, .lab-pleas) { display: none; }
}
`
