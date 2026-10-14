/**
 * The avatars' sheet: the rim takes the state's tone (plea warn, fail fail, loot ok), otherwise the
 * hero's own colour (face, portrait) or brass (shield). Idle heroes dim. Part of HUD_CSS.
 */
export const AVATAR_CSS = /* css */ `
.hud-avatar { --rim: var(--banner); flex: none; position: relative; display: inline-grid; place-items: center; width: var(--av); line-height: 0; }
.hud-avatar svg { display: block; overflow: visible; }
.hud-avatar-rim { stroke: var(--rim); }
.hud-avatar[data-variant="shield"] { --rim: var(--brass); }
/* a face's or portrait's rim is its hero's own colour (the medallion's ground is the banner): heroes of
   one body and one banner still tell apart */
.hud-avatar[data-variant="face"], .hud-avatar[data-variant="portrait"] { --rim: var(--accent, var(--banner)); }
.hud-avatar[data-tone="plea"] { --rim: var(--warn); }
.hud-avatar[data-tone="fail"] { --rim: var(--fail); }
.hud-avatar[data-tone="loot"] { --rim: var(--ok); }
.hud-avatar[data-idle="true"] { opacity: 0.72; }
.hud-avatar[data-variant="portrait"][data-idle="true"] { filter: grayscale(0.65); opacity: 0.7; }
.hud-avatar-medal {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--av);
  height: var(--av);
  overflow: hidden;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--banner) 80%, #fff 20%), color-mix(in srgb, var(--banner) 45%, #000 55%) 78%);
  box-shadow: 0 0 0 1px rgba(12, 9, 7, 0.75);
}
.hud-avatar-medal img, .hud-avatar-medal svg { width: 100%; height: 100%; object-fit: cover; }
/* the medal's rim is drawn over the picture */
.hud-avatar-medal::after { content: ""; position: absolute; inset: 0; border-radius: 50%; box-shadow: inset 0 0 0 max(2px, calc(var(--av) * 0.07)) var(--rim); pointer-events: none; }
.hud-avatar-num {
  position: absolute;
  right: -3px;
  bottom: -3px;
  min-width: 14px;
  padding: 0 2px;
  border-radius: 3px;
  background: var(--ink-solid);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--banner) 70%, transparent);
  color: var(--paper);
  font: normal 400 10px/13px var(--display);
  letter-spacing: 0.02em;
  text-align: center;
}
`
