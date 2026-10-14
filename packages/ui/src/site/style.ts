/**
 * The site's pieces (welcome card, crest menu, demo picker, "How it's built") on the `.gh` tokens, in V1's
 * site style (demos.css, how.css, nav.css): ledger cards, small-caps serif titles, brass hairlines. A host
 * is `position: relative` (the world's stage); overlays sit inside it. Phones (≤ 560 px) turn the card and
 * the menu into bottom sheets and the demos into a vertical list. Motion is off under reduced-motion.
 */
export const SITE_CSS = /* css */ `
/* ── tokens: one spacing and type scale for every piece ─────────── */
.gh {
  --site-edge: 16px; --site-pad: 24px; --site-gap: 12px; --site-sheet: 14px;
  --site-h1: clamp(24px, 3.4vw, 32px); --site-h2: 22px; --site-lede: 17px; --site-body: 15px; --site-small: 13px;
}
/* ── shared ─────────────────────────────────────────────────────── */
.gh .site-link {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 4px;
  color: var(--brass-hi); font-weight: 500; text-decoration: underline; text-decoration-color: var(--brass-line);
  text-underline-offset: 4px; background: none; border: 0; cursor: pointer; font-size: 15px;
}
.gh .site-link:hover { color: var(--paper); text-decoration-color: currentColor; }
.gh .site-msg { display: flex; align-items: flex-start; gap: 6px; margin: 0; min-height: 20px; font-size: 13px; line-height: 1.4; color: var(--faint); }
.gh .site-msg svg { flex: none; margin-top: 2px; }
.gh .site-msg[data-tone="fail"] { color: var(--fail); }
.gh .site-msg[data-tone="ok"] { color: var(--ok); }
.gh .site-scrim { position: fixed; inset: 0; z-index: 31; background: rgba(10, 7, 5, 0.5); }
.gh .site-scrim[data-soft] { background: rgba(10, 7, 5, 0.28); }
.gh .site-keys { display: inline-flex; gap: 4px; }

/* ── welcome bar ────────────────────────────────────────────────── */
.gh .site-welcome { position: absolute; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; justify-content: center; padding: 0 16px 20px; pointer-events: none; }
.gh .site-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.gh .site-welcome-card {
  pointer-events: auto; width: min(560px, 100%); padding: 10px 12px 2px; background: rgba(21, 17, 13, 0.95);
}
.gh .site-welcome-form { display: grid; gap: 4px; }
.gh .site-input:focus-visible { outline: none; border-color: var(--brass-hi); box-shadow: var(--ring); }
.gh .site-input[aria-invalid="true"]:focus-visible { border-color: var(--fail); }
.gh .site-input[data-ok] { border-color: rgba(166, 221, 143, 0.55); }
.gh .site-welcome-row { display: flex; gap: 8px; }
.gh .site-welcome-row .ui-btn { min-height: 44px; padding: 0 20px; flex: none; font-size: 15px; }
.gh .site-input {
  flex: 1; min-width: 0; min-height: 44px; padding: 0 12px; border-radius: var(--r-sm);
  border: 1px solid var(--hair-2); background: var(--ink-deep); color: var(--paper); font: 16px var(--mono);
}
.gh .site-input::placeholder { color: var(--faint); font-family: var(--body); }
.gh .site-input:hover { border-color: var(--brass-line); }
.gh .site-input[aria-invalid="true"] { border-color: var(--fail); }
.gh .site-welcome-card .site-msg { min-height: 0; }
.gh .site-welcome-card .site-msg:empty { display: none; }
.gh .site-welcome-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gh .site-welcome-links .site-link { min-height: 36px; font-size: 14px; }
.gh .site-welcome-links { display: flex; flex-wrap: wrap; align-items: center; gap: 0 10px; color: var(--faint); font-size: 13px; }
/* folded: the field alone, a slim pill; it unfolds to the full bar on focus */
.gh .site-welcome[data-open="false"] .site-welcome-card { width: min(340px, 100%); padding: 6px; }
.gh .site-welcome[data-open="false"] .site-msg { display: none; }
.gh .site-welcome[data-open="false"] .site-input { min-height: 40px; cursor: text; }
.gh .site-welcome-foot[hidden] { display: none; }

@media (max-width: 560px) {
  .gh .site-welcome { padding: 0 16px calc(12px + env(safe-area-inset-bottom)); }
  .gh .site-welcome-card { width: 100%; padding: 10px 10px 2px; }
  .gh .site-welcome-links .site-link { min-height: 44px; font-size: 15px; }
}

/* ── crest menu ─────────────────────────────────────────────────── */
.gh .site-crestmenu { position: absolute; top: 16px; left: 16px; z-index: 32; }
.gh .site-crest-btn {
  display: inline-flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 16px 0 5px; cursor: pointer;
  background: var(--ink); border: 1px solid var(--hair); border-radius: 999px; box-shadow: var(--shadow);
  backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15);
  color: var(--paper); font: 400 17px/1 var(--display); letter-spacing: 0.05em;
}
.gh .site-crest-btn:hover { border-color: var(--brass); color: var(--brass-hi); background: var(--ink-solid); }
.gh .site-crest-btn:hover .site-crest-mark, .gh .site-crest-btn[aria-expanded="true"] .site-crest-mark { border-color: var(--brass); background: radial-gradient(circle at 50% 35%, rgba(220, 182, 98, 0.34), transparent 70%); }
.gh .site-crest-btn:focus-visible { outline: none; box-shadow: var(--ring), var(--shadow); }
.gh .site-crest-btn[aria-expanded="true"] { border-color: var(--brass); color: var(--brass-hi); }
.gh .site-crest-mark {
  display: grid; place-items: center; width: 34px; height: 34px; color: var(--brass-hi);
  border: 1px solid var(--brass-line); border-radius: 50%;
  background: radial-gradient(circle at 50% 35%, rgba(220, 182, 98, 0.18), transparent 70%);
}
.gh .site-menu {
  position: absolute; top: calc(100% + 8px); left: 0; z-index: 33; width: 340px; padding: 6px; background: rgba(21, 17, 13, 0.97);
}
.gh .site-menu-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.gh .site-menu-item {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 8px 12px; text-align: left;
  border: 1px solid transparent; border-radius: var(--r-sm); background: none; color: var(--paper); text-decoration: none; cursor: pointer;
}
.gh .site-menu-item:hover { background: var(--raise-2); border-color: var(--hair-2); }
.gh .site-menu-item[aria-current="page"] { border-color: var(--brass-line); background: var(--brass-wash); }
.gh .site-menu-glyph { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--r-sm); color: var(--brass-hi); background: var(--raise); }
.gh .site-menu-text { flex: 1; min-width: 0; display: grid; gap: 1px; }
.gh .site-menu-text b { font: 400 17px/1.2 var(--display); letter-spacing: 0.04em; }
.gh .site-menu-text small { font-size: 13px; line-height: 1.3; color: var(--muted); }
.gh .site-menu-here { font: 400 var(--t-sm)/1 var(--display); letter-spacing: 0.12em; color: var(--brass-hi); }
.gh .site-menu-foot { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--hair); }
.gh .site-menu-palette {
  display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 40px; margin: 0; padding: 0 12px;
  border: 0; border-radius: var(--r-sm); background: none; color: var(--muted); font-size: 14px; text-align: left;
}
button.site-menu-palette { cursor: pointer; }
button.site-menu-palette:hover { background: var(--raise-2); color: var(--paper); }

@media (max-width: 560px) {
  .gh .site-crestmenu { top: 12px; left: 12px; }
  .gh .site-crest-name { display: none; }
  .gh .site-crest-btn { padding: 0 5px; }
  .gh .site-menu {
    position: fixed; top: auto; left: 0; right: 0; bottom: 0; width: auto; padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
    border-radius: 14px 14px 0 0; border-bottom: 0;
  }
  .gh .site-menu::before { border-radius: 14px 14px 0 0; }
  .gh .site-menu-item { min-height: 60px; }
}

/* ── demo picker ────────────────────────────────────────────────── */
.gh .site-layer { position: absolute; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; }
.gh .site-layer > .site-scrim { position: absolute; z-index: 0; background: rgba(10, 7, 5, 0.6); }
.gh .site-demos {
  position: relative; z-index: 1; display: flex; flex-direction: column; width: min(1100px, calc(100% - 48px)); max-height: calc(100% - 48px);
}
.gh .site-demos-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 12px var(--site-pad); border-bottom: 1px solid var(--hair); }
.gh .site-demos-title { margin: 4px 0 0; font: 400 var(--site-h1)/1.15 var(--display); letter-spacing: 0.03em; color: var(--paper); text-wrap: balance; }
.gh .site-demos-scroll { overflow-y: auto; overscroll-behavior: contain; padding: 16px var(--site-pad) 28px; scrollbar-width: thin; scrollbar-color: var(--hair-2) transparent; }
.gh .site-demos-lede { margin: 0 0 4px; max-width: 64ch; font: 17px/1.5 var(--serif); color: var(--muted); }
.gh .site-shelf { margin-top: 24px; }
.gh .site-shelf .ui-section-head { padding-bottom: 8px; margin-bottom: 14px; border-bottom: 1px solid var(--hair); font-size: var(--t-lg); }
.gh .site-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin: 0; padding: 0; list-style: none; }
.gh .site-card, .gh .site-card article { display: flex; min-width: 0; }
.gh .site-card article {
  flex: 1; flex-direction: column; overflow: hidden; border-radius: var(--r); border: 1px solid var(--hair-2);
  background: linear-gradient(180deg, var(--raise), transparent 70%), var(--ink-raised);
}
.gh .site-card:hover article, .gh .site-card article:focus-within { border-color: var(--brass-line); }
.gh .site-card-art { display: block; width: 100%; height: auto; aspect-ratio: 16 / 10; object-fit: cover; background: var(--ink-deep); border-bottom: 1px solid var(--hair); }
.gh .site-card-body { display: flex; flex: 1; flex-direction: column; gap: 8px; padding: 14px 16px 16px; }
.gh .site-card-kicker { margin: 0; font-size: 13px; letter-spacing: 0.02em; color: var(--brass); }
.gh .site-card-title { margin: 0; font: 400 22px/1.15 var(--display); letter-spacing: 0.02em; color: var(--paper); }
.gh .site-card-blurb { margin: 0; font-size: 15px; line-height: 1.45; color: var(--muted); }
.gh .site-card-shows { display: grid; gap: 4px; margin: 2px 0 0; padding: 0; list-style: none; font-size: 14px; line-height: 1.4; color: var(--paper); }
.gh .site-card-shows li { position: relative; padding-left: 16px; }
.gh .site-card-shows li::before { content: ""; position: absolute; left: 2px; top: 0.55em; width: 5px; height: 5px; transform: rotate(45deg); background: var(--brass); }
.gh .site-card-shows[data-chips] { display: flex; flex-wrap: wrap; gap: 6px; }
.gh .site-card-shows[data-chips] li { padding: 2px 10px; border: 1px solid var(--hair-2); border-radius: 999px; font: 12.5px/1.5 var(--mono); color: var(--muted); }
.gh .site-card-shows[data-chips] li::before { display: none; }
.gh .site-acts { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 6px 0 0; padding: 0; list-style: none; }
.gh .site-act {
  display: flex; flex-direction: column; justify-content: center; min-height: 52px; padding: 6px 8px; width: 100%;
  border-radius: var(--r-sm); border: 1px solid var(--hair-2); background: var(--raise); color: var(--brass-hi);
  font: 400 15px/1.15 var(--display); text-align: left; text-decoration: none; cursor: pointer;
}
.gh .site-act span { font: 12.5px/1.2 var(--body); color: var(--muted); }
.gh .site-act:hover { background: var(--raise-2); border-color: var(--brass-line); }
.gh .site-card-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: auto; padding-top: 10px; }
.gh .site-open {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: var(--r-sm);
  border: 1px solid var(--brass); background: var(--brass-wash); color: var(--brass-hi); font: 500 15px var(--body); text-decoration: none; cursor: pointer;
}
.gh .site-open:hover { background: rgba(220, 182, 98, 0.26); color: var(--paper); }
.gh .site-card-link { min-width: 0; font: 12px var(--mono); color: var(--faint); overflow-wrap: anywhere; }

@media (min-width: 1101px) { .gh .site-demos { width: min(1100px, calc(100% - 2 * 176px)); } }
@media (min-width: 561px) and (max-width: 1100px) {
  .gh .site-layer { align-items: flex-end; padding-top: 72px; }
  .gh .site-demos { width: min(1100px, calc(100% - 32px)); max-height: 100%; margin-bottom: 16px; }
}
@media (min-width: 760px) {
  .gh .site-card[data-feature] { grid-column: 1 / -1; }
  .gh .site-card[data-feature] article { flex-direction: row; }
  .gh .site-card[data-feature] .site-card-art { width: 50%; flex: none; aspect-ratio: auto; min-height: 100%; border-bottom: 0; border-right: 1px solid var(--hair); }
  .gh .site-card[data-feature] .site-card-body { padding: 22px 24px; }
  .gh .site-card[data-feature] .site-card-title { font-size: 30px; }
}
@media (max-width: 560px) {
  .gh .site-layer { align-items: flex-end; }
  .gh .site-demos { width: 100%; max-height: calc(100% - 44px); border-radius: 14px 14px 0 0; border-bottom: 0; }
  .gh .site-demos::before { border-radius: 14px 14px 0 0; }
  .gh .site-demos-head { padding: 14px 8px 10px 16px; }
  .gh .site-demos-scroll { padding: 12px 16px calc(24px + env(safe-area-inset-bottom)); }
  .gh .site-demos-lede { display: none; }
  .gh .site-shelf { margin-top: 18px; }
  .gh .site-demos-scroll > .site-shelf:first-child { margin-top: 4px; }
  .gh .site-cards { grid-template-columns: 1fr; gap: 12px; }
  .gh .site-card-art { aspect-ratio: 16 / 7; }
  .gh .site-card-shows:not([data-chips]) { display: none; }
  .gh .site-act { align-items: center; padding: 6px 2px; text-align: center; }
  .gh .site-act span { display: none; }
}

/* ── How it's built ─────────────────────────────────────────────── */
.gh .site-page {
  position: absolute; inset: 0; z-index: 30; overflow-y: auto; overscroll-behavior: contain; color: var(--muted);
  font: 17px/1.6 var(--body); scroll-behavior: auto;
  background: radial-gradient(1200px 520px at 50% -180px, rgba(220, 182, 98, 0.09), transparent 70%), var(--ink-solid);
}
.gh .site-page a { color: var(--brass-hi); text-underline-offset: 3px; text-decoration-color: var(--brass-line); }
.gh .site-page a:hover { color: var(--paper); text-decoration-color: currentColor; }
.gh .site-page strong { font-weight: 500; color: var(--paper); }
.gh .site-page code { font: 0.86em var(--mono); color: var(--paper); background: var(--raise); padding: 1px 5px; border-radius: 4px; overflow-wrap: break-word; }
.gh .site-skip { position: absolute; left: 16px; top: -60px; z-index: 5; padding: 8px 14px; background: var(--ink-raised); border: 1px solid var(--brass-line); border-radius: var(--r-sm); }
.gh .site-skip:focus { top: 16px; }
.gh .site-page-top { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; min-height: 76px; padding: 16px 16px 10px 196px; background: var(--ink-solid); border-bottom: 1px solid var(--hair); }
.gh .site-back { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 15px; text-decoration: none; background: none; border: 0; cursor: pointer; color: var(--muted); }
.gh .site-back:hover { color: var(--paper); }
.gh .site-back-arrow { display: grid; transform: scaleX(-1); }
/* the top nav of the long pages, right of the crest */
.gh .site-topnav ul { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 0; padding: 0; list-style: none; }
.gh .site-topnav-link {
  position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px;
  font: 400 14px/1 var(--display); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; color: var(--muted);
}
.gh .site-page .site-topnav-link { color: var(--muted); text-decoration: none; }
.gh .site-page .site-topnav-link:hover { color: var(--paper); }
.gh .site-page .site-topnav-link[aria-current="page"] { color: var(--brass-hi); }
.gh .site-topnav-link[aria-current="page"]::after { content: ""; position: absolute; left: 12px; right: 12px; bottom: 6px; height: 1px; background: var(--brass); }
.gh .site-topnav-short { display: none; }

/* the Harbour: the demo cards, one repo each */
.gh .site-article.site-harbour { max-width: 1100px; }
.gh .site-harbour .site-hero { max-width: 832px; }
.gh .site-harbour-count { margin: 22px 0 0; font: 14px var(--mono); color: var(--faint); }
.gh .site-harbour-cards { margin: 28px 0 0; }
.gh .site-harbour .site-card-title { font-size: 20px; text-transform: none; font-variant: all-small-caps; letter-spacing: 0.05em; }
.gh .site-harbour-owner { color: var(--muted); }
.gh .site-harbour-figures { margin: 0; font: 13px/1.5 var(--mono); color: var(--brass); }
.gh .site-harbour-empty { margin: 28px 0 0; padding: 18px 20px; font-size: 16px; color: var(--muted); }

/* Connect a source */
.gh .site-sources {
  position: relative; z-index: 1; display: flex; flex-direction: column;
  width: min(640px, calc(100% - 32px)); max-height: calc(100% - 48px); padding: 0; overflow: hidden; background: var(--ink-solid);
}
.gh .site-sources-scroll { overflow-y: auto; padding: 16px 20px 20px var(--site-pad, 20px); display: grid; gap: 16px; font-size: 15px; line-height: 1.55; color: var(--muted); }
.gh .site-sources-scroll p { margin: 0; }
.gh .site-sources-lede { font: 17px/1.5 var(--serif); }
.gh .site-sources-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.gh .site-sources-list li { display: grid; gap: 1px; padding: 8px 12px; border: 1px solid var(--hair); border-radius: var(--r-sm); background: var(--raise); }
.gh .site-sources-list b { font: 400 16px/1.2 var(--display); letter-spacing: 0.04em; color: var(--paper); }
.gh .site-steps { display: grid; gap: 12px; margin: 0; padding-left: 22px; }
.gh .site-steps b { font-weight: 500; color: var(--paper); }
.gh .site-sources code { font: 0.86em var(--mono); color: var(--paper); background: var(--raise); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
.gh .site-sources-note { padding: 10px 12px; border-left: 2px solid var(--brass); background: var(--brass-wash); }
.gh .site-sources-note b { font-weight: 500; color: var(--paper); }
@media (max-width: 560px) {
  .gh .site-layer:has(.site-sources) { align-items: flex-end; }
  .gh .site-sources { width: 100%; max-height: calc(100% - 44px); border-radius: 14px 14px 0 0; border-bottom: 0; }
  .gh .site-topnav-link { padding: 0 8px; font-size: 12px; letter-spacing: 0.06em; }
  .gh .site-topnav-long { display: none; }
  .gh .site-topnav-short { display: inline; }
  .gh .site-topnav-link[aria-current="page"]::after { left: 8px; right: 8px; }
}
.gh .site-article { max-width: 832px; margin: 0 auto; padding: 0 16px 56px; outline: none; }
.gh .site-hero { padding: 24px 0 8px; }
.gh .site-hero h1 { margin: 6px 0 0; font: 400 clamp(36px, 7vw, 56px)/1.1 var(--display); letter-spacing: 0.02em; color: var(--paper); text-wrap: balance; }
.gh .site-rule { display: block; width: 72px; height: 1px; margin: 22px 0; background: linear-gradient(90deg, var(--brass), transparent); }
.gh .site-lede { margin: 0; max-width: 62ch; font: 20px/1.55 var(--serif); color: var(--muted); }
.gh .site-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 32px 0 0; padding: 0; list-style: none; background: var(--hair); border: 1px solid var(--hair); }
.gh .site-stats li { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; background: var(--ink-solid); }
.gh .site-stat-n { font: 28px/1.1 var(--mono); font-variant-numeric: tabular-nums; color: var(--brass-hi); }
.gh .site-stat-n small { font-size: 14px; color: var(--faint); }
.gh .site-stat-l { font-size: 14px; line-height: 1.35; color: var(--muted); }
.gh .site-built-note { margin: 12px 0 0; font-size: 14px; line-height: 1.5; color: var(--faint); }
.gh .site-toc { margin-top: 40px; }
.gh .site-toc ol { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 24px; margin: 0; padding: 0; list-style: none; counter-reset: toc; border-top: 1px solid var(--hair); }
.gh .site-toc li { counter-increment: toc; border-bottom: 1px solid var(--hair); }
.gh .site-toc a { display: flex; align-items: baseline; gap: 12px; min-height: 44px; padding: 10px 0; color: var(--paper); text-decoration: none; }
.gh .site-toc a::before { content: counter(toc, upper-roman); min-width: 2.4em; font: 14px var(--display); color: var(--brass); }
.gh .site-toc a:hover { color: var(--brass-hi); }
.gh .site-sec { padding-top: 64px; scroll-margin-top: 88px; }
.gh .site-sec-num { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; font: 15px var(--display); letter-spacing: 0.14em; color: var(--brass); }
.gh .site-sec-num::after { content: ""; flex: 1; height: 1px; background: var(--hair); }
.gh .site-sec h2 { margin: 0 0 16px; font: 400 clamp(28px, 4.6vw, 36px)/1.15 var(--display); letter-spacing: 0.02em; color: var(--paper); text-wrap: balance; }
.gh .site-sec h3 { margin: 32px 0 10px; font: 400 21px/1.2 var(--display); letter-spacing: 0.02em; color: var(--paper); }
.gh .site-sec p { margin: 0 0 16px; max-width: 68ch; }
.gh .site-prose-list { margin: 0 0 16px; padding-left: 20px; max-width: 68ch; }
.gh .site-prose-list li { margin: 0 0 10px; padding-left: 4px; }
.gh .site-prose-list li::marker { color: var(--brass); }
.gh .site-plaque { margin: 28px 0; padding: 18px 20px; background: var(--ink-raised); backdrop-filter: none; -webkit-backdrop-filter: none; }
.gh .site-plaque figcaption, .gh .site-plaque caption { margin: 0 0 14px; font: 15px var(--display); letter-spacing: 0.06em; color: var(--paper); text-align: left; }
.gh .site-sec .site-fig-note { margin: 14px 0 0; max-width: none; font-size: 13.5px; line-height: 1.5; color: var(--faint); }
.gh .site-table-wrap { overflow-x: auto; }
.gh .site-table-wrap table { width: 100%; border-collapse: collapse; font-size: 15px; }
.gh .site-table-wrap th, .gh .site-table-wrap td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--hair); vertical-align: baseline; }
.gh .site-table-wrap thead th { font-weight: 500; font-size: 13px; letter-spacing: 0.04em; color: var(--faint); border-bottom-color: var(--hair-2); }
.gh .site-table-wrap tbody th { font-weight: 500; color: var(--paper); }
.gh .site-table-wrap tbody tr:last-child > * { border-bottom: 0; }
.gh .site-table-wrap .n { text-align: right; font: 14px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.gh .site-table-wrap thead .n { font-family: var(--body); font-size: 13px; }
.gh .site-table-wrap td.win { color: var(--brass-hi); }
.gh .site-bars { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.gh .site-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: baseline; }
.gh .site-bar-label { font-size: 15px; color: var(--paper); }
.gh .site-bar-label small { display: block; font-size: 13px; color: var(--faint); }
.gh .site-bar-value { text-align: right; font: 15px var(--mono); font-variant-numeric: tabular-nums; color: var(--paper); white-space: nowrap; }
.gh .site-bar-track { grid-column: 1 / -1; height: 10px; border-radius: 5px; background: var(--raise); overflow: hidden; }
.gh .site-bar-track i { display: block; height: 100%; min-width: 4px; border-radius: 5px; background: var(--faint); }
.gh .site-bar[data-win] .site-bar-track i { background: var(--brass); }
.gh .site-map { display: grid; grid-template-columns: minmax(150px, 0.34fr) 1fr; gap: 0; margin: 0; }
.gh .site-map dt, .gh .site-map dd { margin: 0; padding: 10px 0; border-top: 1px solid var(--hair); }
.gh .site-map dt { padding-right: 16px; font-weight: 500; color: var(--paper); }
.gh .site-map dt:first-of-type, .gh .site-map dt:first-of-type + dd { border-top: 0; padding-top: 0; }
.gh .site-techs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin: 20px 0; padding: 0; list-style: none; }
.gh .site-techs li { padding: 14px 16px; border: 1px solid var(--hair); border-radius: var(--r); background: var(--raise); }
.gh .site-techs h4 { margin: 0 0 6px; font: 400 17px/1.2 var(--display); letter-spacing: 0.03em; color: var(--brass-hi); }
.gh .site-techs p { margin: 0; font-size: 15.5px; line-height: 1.5; }
.gh .site-shot { max-width: 640px; margin: 28px 0; } /* 1280 px art at 2×: sharp on a Retina screen */
.gh .site-hero .ui-eyebrow { font: 400 var(--t-md)/1.2 var(--display); letter-spacing: 0.14em; text-transform: none; color: var(--brass); }
.gh .site-shot img { display: block; width: 100%; height: auto; border-radius: var(--r); border: 1px solid var(--hair-2); background: var(--ink-deep); }
.gh .site-shot figcaption { margin-top: 8px; font-size: 13.5px; line-height: 1.45; color: var(--faint); }
.gh .site-try { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; }
.gh .site-try-label { font: 14px var(--display); letter-spacing: 0.14em; color: var(--brass); }
.gh .site-try p { flex-basis: 100%; margin: 4px 0 0; font-size: 15px; }
.gh .site-posts { display: grid; gap: 20px; margin: 28px 0 0; padding: 0; list-style: none; }
.gh .site-post { display: grid; grid-template-columns: 38% 1fr; overflow: hidden; background: var(--ink-raised); backdrop-filter: none; -webkit-backdrop-filter: none; }
.gh .site-post > img { width: 100%; height: 100%; min-height: 160px; object-fit: cover; border-right: 1px solid var(--hair); background: var(--ink-deep); }
.gh .site-post-body { padding: 18px 20px; min-width: 0; }
.gh .site-post-n { margin: 0 0 4px !important; font: 13px var(--display) !important; letter-spacing: 0.14em; color: var(--brass); }
.gh .site-sec .site-post h3 { margin: 0 0 8px; font-size: 22px; }
.gh .site-post-sum { font-size: 16px; }
.gh .site-post details { margin-top: 4px; }
.gh .site-post summary { display: inline-flex; align-items: center; min-height: 44px; padding: 0 2px; color: var(--brass-hi); font-weight: 500; cursor: pointer; }
.gh .site-post summary:hover { color: var(--paper); }
.gh .site-post-text { padding-top: 6px; border-top: 1px solid var(--hair); }
.gh .site-post-text p { font: 17px/1.6 var(--serif); }
.gh .site-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--hair); font-size: 15px; color: var(--faint); }
.gh .site-foot p { margin: 0; }

@media (max-width: 640px) {
  .gh .site-page { font-size: 16.5px; }
  .gh .site-page-top { min-height: 56px; padding: 12px 12px 4px 68px; }
  .gh .site-lede { font-size: 18px; }
  .gh .site-stats { grid-template-columns: 1fr; }
  .gh .site-stats li { display: grid; grid-template-columns: 116px 1fr; align-items: baseline; gap: 14px; }
  .gh .site-stat-n { font-size: 24px; white-space: nowrap; }
  .gh .site-toc ol, .gh .site-techs { grid-template-columns: 1fr; }
  .gh .site-sec { padding-top: 48px; }
  .gh .site-plaque { padding: 14px; }
  .gh .site-map { grid-template-columns: 1fr; }
  .gh .site-map dt { padding: 10px 0 0; border-top: 1px solid var(--hair); }
  .gh .site-map dd { padding: 2px 0 10px; border-top: 0; }
  .gh .site-map dt:first-of-type { border-top: 0; padding-top: 0; }
  .gh .site-post { grid-template-columns: 1fr; }
  .gh .site-post > img { height: 170px; border-right: 0; border-bottom: 1px solid var(--hair); }
}

@media (prefers-reduced-motion: no-preference) {
  .gh .site-open, .gh .site-card article, .gh .site-act, .gh .site-menu-item, .gh .site-crest-btn, .gh .site-link, .gh .site-input {
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .gh .site-welcome-card, .gh .site-menu, .gh .site-demos { animation: site-rise 0.22s ease-out both; }
  .gh .site-welcome-card { transition: width 0.2s ease, padding 0.2s ease; }
  .gh .site-scrim { animation: site-fade 0.2s ease-out both; }
  @keyframes site-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes site-fade { from { opacity: 0; } to { opacity: 1; } }
}
`

let users = 0
let node: HTMLStyleElement | null = null

/** Adds the site sheet (after `holdUiStyle`'s tokens) while at least one holder needs it. */
export function holdSiteStyle(): () => void {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "site"
    node.textContent = SITE_CSS
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
