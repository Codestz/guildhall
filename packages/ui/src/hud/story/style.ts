/**
 * The story and sharing sheet: V1's hall.css rules for the Legends book, the Chronicle card dialog, the
 * captions, the chapter chip, the town dossier and the repo door's badge, rebuilt on the `.gh` tokens.
 *
 * The book is parchment, ink on paper (V1's vellum): every text colour ≥ 7:1 on --vellum but the umber
 * eyebrows (5.6:1). Everything else is the HUD's ink. On a phone (≤ 720 px) the book, the card and the
 * place are bottom sheets, one at a time, inside the safe area; captions are one short line everywhere.
 */
export const STORY_CSS = /* css */ `
/* ── overlays ───────────────────────────────────────────────────── */
.st-scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  /* one definite cell, so the dialog's max-height of 100% is the scrim's, and its body scrolls */
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  place-items: center;
  padding: 28px var(--s4);
  background: rgba(10, 7, 5, 0.52);
  animation: st-fade 0.25s ease-out both;
}
.st-scrim-card { z-index: 41; background: rgba(10, 7, 5, 0.6); }
@keyframes st-fade { from { opacity: 0; } }
@keyframes st-rise { from { opacity: 0; transform: translateY(12px) scale(0.985); } }

/* ── the Legends book ───────────────────────────────────────────── */
.st-book {
  --vellum: #f4ead3;
  --vellum-edge: #e3cfa5;
  --ink-text: #2a1e14;
  --ink-soft: #54412e;
  --umber: #765115;
  --rubric: #8a2c1a;
  --verdant: #2e5a2a;
  --rule: rgba(110, 78, 34, 0.3);
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: 100%;
  border-radius: 6px;
  color: var(--ink-text);
  background:
    radial-gradient(ellipse 120% 80% at 50% 0%, rgba(255, 252, 240, 0.7), transparent 60%),
    radial-gradient(ellipse 140% 100% at 50% 50%, transparent 55%, rgba(170, 128, 60, 0.22) 100%),
    var(--vellum);
  box-shadow:
    0 0 0 1px rgba(90, 62, 26, 0.45),
    0 0 0 5px var(--vellum-edge),
    0 0 0 6px rgba(90, 62, 26, 0.5),
    0 30px 80px -20px rgba(0, 0, 0, 0.8);
  font: 16.5px/1.5 var(--serif);
  animation: st-rise 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.st-book :focus-visible { outline: 2px solid var(--umber); outline-offset: 2px; border-radius: 4px; }
.st-book h2:focus, .st-book [data-page-head]:focus { outline: none; }
.st-book [data-page-head]:focus-visible { outline: 2px solid var(--umber); outline-offset: 3px; }
.st-book-head { display: flex; align-items: flex-start; gap: 16px; padding: 26px 22px 18px 40px; border-bottom: 1px solid var(--rule); }
.st-book-titles { flex: 1; min-width: 0; }
.st-book-eyebrow { margin: 0 0 2px; font: 400 13px/1.3 var(--display); letter-spacing: 0.16em; color: var(--umber); }
.st-book-head h2 { margin: 0; font: 600 27px/1.2 var(--serif); color: var(--ink-text); text-wrap: balance; }
/* plain case: Marcellus draws digits as letters ("107k" reads "IO7K") */
.st-book-meta { margin: 6px 0 0; font: 14px/1.4 var(--body); font-variant-numeric: lining-nums; letter-spacing: 0.02em; color: var(--ink-soft); }
.st-book-tools { flex: none; display: flex; align-items: center; gap: 6px; }
.st-book-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 14px 0 11px;
  border-radius: 5px;
  border: 1px solid rgba(90, 62, 26, 0.55);
  background: rgba(255, 250, 236, 0.6);
  font: 500 14px/1 var(--body);
  color: var(--ink-text);
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.st-book-btn .hud-glyph { color: var(--umber); }
.st-book-btn:hover:not(:disabled) { background: #fffaee; border-color: var(--umber); }
.st-book-btn:disabled { opacity: 0.5; cursor: default; }
.st-book-btn-end { margin: 18px auto 4px; }
.st-book-close { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 5px; background: none; color: var(--ink-soft); cursor: pointer; }
.st-book-close:hover { background: rgba(110, 78, 34, 0.12); color: var(--ink-text); }
.st-book-tabs { display: flex; gap: 4px; padding: 10px 40px 0; border-bottom: 1px solid var(--rule); }
.st-book-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  margin-bottom: -1px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 5px 5px 0 0;
  background: none;
  font: 400 14px/1 var(--display);
  letter-spacing: 0.08em;
  color: var(--ink-soft);
  cursor: pointer;
}
.st-book-tab:hover { color: var(--ink-text); background: rgba(110, 78, 34, 0.08); }
.st-book-tab[aria-selected="true"] { color: var(--ink-text); border-color: var(--rule); background: var(--vellum); }
.st-book-tab[aria-selected="true"] .hud-glyph { color: var(--umber); }
.st-book-body { min-height: 0; overflow-y: auto; padding: 20px 40px 30px; scrollbar-width: thin; scrollbar-color: rgba(110, 78, 34, 0.4) transparent; }
.st-book-empty { margin: 8px 0 4px; font-style: italic; color: var(--ink-soft); }
.st-book-opening { margin: 0 0 8px; font-size: 17.5px; font-style: italic; text-wrap: pretty; }
.st-chapters, .st-years, .st-annals { list-style: none; margin: 0; padding: 0; }
.st-chapter { padding: 18px 0 16px; border-top: 1px solid var(--rule); scroll-margin-top: 12px; }
.st-chapter:first-child { margin-top: 14px; }
.st-ch-head { display: flex; align-items: baseline; gap: 14px; }
.st-ch-num { flex: none; min-width: 34px; font: 400 20px/1 var(--display); color: var(--umber); text-align: right; }
.st-ch-titles { min-width: 0; }
.st-ch-titles h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 9px; margin: 0; font: 400 18px/1.3 var(--display); letter-spacing: 0.05em; color: var(--ink-text); }
.st-ch-pip { width: 9px; height: 9px; transform: rotate(45deg); background: var(--role); box-shadow: 0 0 0 1px rgba(42, 30, 20, 0.55); }
.st-ch-state { padding: 1px 7px; border-radius: 3px; border: 1px solid var(--rule); font: 12px/1.4 var(--body); letter-spacing: 0.04em; color: var(--ink-soft); }
.st-chapter[data-outcome="fallen"] .st-ch-state { color: var(--rubric); border-color: rgba(138, 44, 26, 0.45); }
.st-ch-quest { margin: 1px 0 0; font-style: italic; color: var(--ink-text); }
.st-ch-quest q { quotes: "“" "”"; }
.st-chapter > :not(.st-ch-head) { margin-left: 48px; }
.st-ch-meta { margin-top: 4px; margin-bottom: 0; font: 13.5px/1.4 var(--body); color: var(--ink-soft); }
.st-ch-deeds { margin-top: 8px; margin-bottom: 0; font-size: 15.5px; }
.st-ch-label { margin-right: 6px; font: 400 12px/1 var(--display); letter-spacing: 0.14em; color: var(--umber); }
.st-ch-notes { list-style: none; margin-top: 8px; margin-bottom: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 15.5px; }
.st-ch-notes li { display: flex; gap: 8px; align-items: baseline; }
.st-ch-notes .hud-glyph { position: relative; top: 2px; flex: none; color: var(--umber); }
.st-ch-notes li:is([data-kind="flaw"], [data-kind="fall"]) :is(.hud-glyph, b) { color: var(--rubric); }
.st-ch-notes li[data-kind="rise"] :is(.hud-glyph, b) { color: var(--verdant); }
.st-ch-notes li[data-kind="renown"] :is(.hud-glyph, b) { color: #8a5a0c; }
.st-ch-notes b { font: 400 13px/1 var(--display); letter-spacing: 0.1em; color: var(--umber); }
.st-ch-at { font: 12px/1 var(--mono); color: var(--ink-soft); }
.st-ch-loot { margin: 10px 0 0 48px; padding: 2px 0 2px 14px; border-left: 2px solid var(--verdant); }
.st-ch-loot .st-ch-label { color: var(--verdant); }
.st-ch-loot p { margin: 1px 0 0; font-style: italic; font-size: 15.5px; overflow-wrap: anywhere; }
.st-book-end { padding-top: 10px; border-top: 1px solid var(--rule); text-align: center; scroll-margin-top: 12px; }
.st-fleuron { display: block; font-size: 22px; line-height: 1; color: var(--umber); }
.st-last-word { margin: 14px auto 0; max-width: 52ch; }
.st-last-word p { margin: 0; font-size: 17px; font-style: italic; text-wrap: balance; }
.st-last-word p::before { content: "“"; }
.st-last-word p::after { content: "”"; }
.st-last-word cite { display: block; margin-top: 4px; font: normal 400 12px/1.3 var(--display); letter-spacing: 0.12em; color: var(--ink-soft); }
.st-book-closing { margin: 14px auto 0; max-width: 54ch; font-size: 17.5px; font-variant-numeric: lining-nums; color: var(--ink-text); text-wrap: balance; }

/* Deeds of Renown: wax seals, and a hint for each one still unsung */
.st-renown { margin: 4px 0 18px; padding-top: 16px; border-top: 1px solid var(--rule); scroll-margin-top: 12px; }
.st-renown-h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 10px; font: 400 18px/1.3 var(--display); letter-spacing: 0.05em; color: var(--ink-text); }
.st-renown-tally { font: 13.5px/1 var(--body); font-variant-numeric: lining-nums; letter-spacing: 0.02em; color: var(--ink-soft); }
.st-renown-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px 22px; }
.st-renown-deed { display: flex; gap: 11px; align-items: flex-start; min-width: 0; }
.st-renown-seal {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-top: 1px;
  border-radius: 50%;
  color: #fff4d8;
  background: radial-gradient(circle at 35% 30%, #a94a32, #7a2a18 70%);
  box-shadow: 0 0 0 2px rgba(122, 42, 24, 0.25), inset 0 -2px 0 rgba(0, 0, 0, 0.18);
  font: 16px/1 var(--display);
}
.st-renown-deed:is([data-kind="festival"], [data-kind="comet"], [data-kind="rainbow"]) .st-renown-seal {
  color: #2a1e14;
  background: radial-gradient(circle at 35% 30%, #f1d590, #c99a3c 72%);
  box-shadow: 0 0 0 2px rgba(150, 110, 40, 0.3), inset 0 -2px 0 rgba(0, 0, 0, 0.14);
}
.st-renown-deed[data-kind="ghost-ship"] .st-renown-seal { background: radial-gradient(circle at 35% 30%, #4c7a5c, #24493a 72%); }
.st-renown-deed[data-kind="raid"] .st-renown-seal { background: radial-gradient(circle at 35% 30%, #4a3f36, #1f1813 72%); }
.st-renown-deed[data-earned="false"] .st-renown-seal { color: var(--umber); background: transparent; box-shadow: none; border: 1.5px dashed rgba(118, 81, 21, 0.55); }
.st-renown-words { min-width: 0; }
.st-renown-name { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; margin: 0; font: 15px/1.3 var(--display); letter-spacing: 0.05em; color: var(--ink-text); }
.st-renown-deed[data-earned="false"] .st-renown-name { color: var(--umber); }
.st-renown-count { font: 13px/1 var(--body); font-variant-numeric: lining-nums; letter-spacing: 0; color: var(--ink-soft); }
.st-renown-forced { padding: 0 6px; border-radius: 3px; border: 1px solid var(--rule); font: 11.5px/1.4 var(--body); color: var(--ink-soft); }
.st-renown-text { margin: 1px 0 0; font-size: 15px; line-height: 1.42; color: var(--ink-text); text-wrap: pretty; }
.st-renown-deed[data-earned="false"] .st-renown-text { font-style: italic; color: var(--ink-soft); }

/* History: the repo's annals, a year to a page */
.st-year { padding: 14px 0 6px; scroll-margin-top: 12px; }
.st-year + .st-year { border-top: 1px solid var(--rule); }
.st-year-h { margin: 0 0 8px; font: 400 22px/1.2 var(--display); letter-spacing: 0.08em; color: var(--umber); }
.st-annal { display: grid; grid-template-columns: 84px 22px 1fr; gap: 0 10px; align-items: baseline; padding: 6px 0; }
.st-annal-day { font: 13px/1.4 var(--body); font-variant-numeric: lining-nums; color: var(--ink-soft); text-align: right; white-space: nowrap; }
.st-annal-mark { color: var(--umber); align-self: start; padding-top: 3px; }
.st-annal[data-kind="release"] .st-annal-mark { color: #8a5a0c; }
.st-annal[data-kind="session"][data-outcome="lost"] .st-annal-mark { color: var(--rubric); }
.st-annal-words { min-width: 0; }
.st-annal-title { margin: 0; font-size: 16px; line-height: 1.4; color: var(--ink-text); overflow-wrap: anywhere; }
.st-annal-title b { margin-right: 4px; font: 400 12.5px/1 var(--display); letter-spacing: 0.12em; color: var(--umber); }
.st-annal-title q { font-style: italic; quotes: "“" "”"; }
.st-annal-outcome { margin-left: 8px; padding: 0 6px; border-radius: 3px; border: 1px solid var(--rule); font: 12px/1.5 var(--body); color: var(--ink-soft); white-space: nowrap; }
.st-annal[data-outcome="lost"] .st-annal-outcome { color: var(--rubric); border-color: rgba(138, 44, 26, 0.45); }
.st-annal[data-outcome="complete"] .st-annal-outcome { color: var(--verdant); border-color: rgba(46, 90, 42, 0.4); }
.st-annal-text { margin: 1px 0 0; font: 14px/1.45 var(--body); color: var(--ink-soft); }
.st-annal-open { margin-top: 4px; padding: 2px 0; border: 0; background: none; font: 500 13.5px/1.4 var(--body); color: var(--umber); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.st-annal-open:hover { color: var(--ink-text); }
/* a repo's eras: the island as it was, a lede, the annals */
.st-era > .st-era-island { margin: 12px 0 4px; }
.st-era-island {
  position: relative;
  aspect-ratio: 16 / 7;
  overflow: hidden;
  border-radius: 4px;
  background: #22394a;
  box-shadow: 0 0 0 1px rgba(90, 62, 26, 0.5), 0 0 0 4px var(--vellum-edge), 0 0 0 5px rgba(90, 62, 26, 0.35);
}
/* a still that fails to load leaves the sea-blue frame, not its alt text */
.st-era-island img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: 50% 55%; color: transparent; }
.st-era-island[data-empty="true"] { aspect-ratio: 16 / 4; display: grid; place-items: center; background: rgba(110, 78, 34, 0.08); color: var(--umber); }
.st-era-island figcaption {
  position: absolute;
  left: 10px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(244, 234, 211, 0.92);
  font: 12.5px/1.5 var(--body);
  color: var(--ink-soft);
}
.st-era-island figcaption .num { font: inherit; font-variant-numeric: lining-nums tabular-nums; color: var(--ink-text); }
.st-era-lede { margin-top: 8px; margin-bottom: 4px; font-size: 16.5px; font-style: italic; text-wrap: pretty; }
.st-era .st-ch-meta { margin-top: 2px; }
.st-era .st-annal { grid-template-columns: 70px 22px 1fr; }
.st-code { padding: 0 3px; border-radius: 3px; background: rgba(110, 78, 34, 0.1); font: 0.84em/1.3 var(--mono); color: #3d2b14; overflow-wrap: anywhere; }
h3 .st-code { font-size: 0.8em; letter-spacing: 0; }

/* the footer: turning pages */
.st-book-foot { display: flex; align-items: center; gap: 10px; padding: 8px 18px 10px; border-top: 1px solid var(--rule); }
.st-page-btn { flex: none; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 1px solid rgba(90, 62, 26, 0.4); border-radius: 5px; background: rgba(255, 250, 236, 0.5); color: var(--ink-text); cursor: pointer; }
.st-page-btn:hover:not([aria-disabled="true"]) { background: #fffaee; border-color: var(--umber); }
.st-page-btn[aria-disabled="true"] { opacity: 0.35; cursor: default; }
.st-page-label { flex: 1; min-width: 0; margin: 0; display: flex; align-items: baseline; justify-content: center; gap: 10px; text-align: center; }
.st-page-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 14px/1.3 var(--display); letter-spacing: 0.06em; color: var(--ink-text); }
.st-page-count { flex: none; font: 13px/1 var(--body); font-variant-numeric: lining-nums; color: var(--ink-soft); }

/* ── the Chronicle card dialog: ink, a layer above the book ─────── */
.st-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(640px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 22px 24px 20px;
  border-radius: var(--r);
  border: 1px solid var(--brass-line);
  background: var(--ink-solid);
  box-shadow: var(--shadow), 0 30px 80px -20px rgba(0, 0, 0, 0.8);
  color: var(--paper);
  scrollbar-width: thin;
  scrollbar-color: var(--hair-2) transparent;
  animation: st-rise 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.st-card h2:focus { outline: none; }
.st-card-head { display: flex; align-items: flex-start; gap: 16px; }
.st-card-head > div { flex: 1; min-width: 0; }
.st-card-head h2 { margin: 2px 0 0; font: 600 25px/1.2 var(--serif); color: var(--paper); }
.st-card-sub { margin: 4px 0 0; font-size: var(--t-lg); color: var(--muted); text-wrap: pretty; }
.st-card-at { font-size: 13px; color: var(--brass-hi); }
.st-card-formats { display: flex; gap: 8px; margin: 0; padding: 0; border: 0; }
.st-card-format {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px 0 11px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  font-size: 14.5px;
  color: var(--muted);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.st-card-format small { margin-left: 2px; font-size: 11.5px; color: var(--faint); }
.st-card-format input { position: absolute; opacity: 0; pointer-events: none; }
.st-card-format:hover { color: var(--paper); background: var(--raise); }
.st-card-format[data-checked="true"] { color: var(--paper); border-color: var(--brass-line); background: var(--brass-wash); }
.st-card-format[data-checked="true"] .st-shape { color: var(--brass-hi); }
.st-card-format:has(input:focus-visible) { outline: 2px solid var(--brass-hi); outline-offset: 2px; }
.st-card-preview { position: relative; margin: 0; width: 100%; overflow: hidden; border-radius: var(--r-sm); background: radial-gradient(ellipse at 70% 40%, rgba(220, 182, 98, 0.08), transparent 70%), #0f0c09; box-shadow: 0 0 0 1px var(--hair-2); }
.st-card-preview[data-format="portrait"] { width: auto; height: min(56dvh, 560px); align-self: center; }
.st-card-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
.st-card-drawing { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; font-size: var(--t-lg); color: var(--muted); }
.st-spinner { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--brass-wash); border-top-color: var(--brass); animation: st-spin 0.9s linear infinite; }
@keyframes st-spin { to { transform: rotate(1turn); } }
.st-card-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.st-card-actions .ui-btn { min-height: 40px; padding: 0 16px 0 13px; font-size: var(--t-lg); gap: 8px; text-decoration: none; }
.st-card-note { margin: -4px 0 0; font-size: 13px; color: var(--faint); overflow-wrap: anywhere; }
.st-card-note[data-tone="warn"] { color: var(--warn); }
.st-card-file { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── captions: V1's pill, two balanced lines at most, lower centre ── */
.st-captions { display: flex; justify-content: center; max-width: 100%; pointer-events: none; }
.st-captions[data-visible="false"] { display: none; }
.st-caption {
  margin: 0;
  min-width: 0;
  min-width: 0;
  max-width: min(100%, 576px);
  padding: 8px 20px 9px;
  border-radius: 10px;
  background: rgba(14, 10, 7, 0.8);
  box-shadow: 0 0 0 1px rgba(220, 182, 98, 0.16), 0 12px 32px -14px rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  font: 19px/1.36 var(--serif);
  color: var(--paper);
  text-align: center;
  animation: st-caption-in 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transition: opacity 0.65s ease, translate 0.65s ease;
}
@keyframes st-caption-in { from { opacity: 0; translate: 0 6px; } }
.st-caption[data-leaving="true"] { opacity: 0; translate: 0 -3px; }
.st-caption b { font-weight: 600; color: #fff7e6; text-decoration: underline; text-decoration-color: var(--role, var(--brass)); text-decoration-thickness: 2px; text-underline-offset: 4px; }
.st-caption q { font-style: italic; quotes: "“" "”" "‘" "’"; }
/* the beat's tone, a small diamond before the line: decorative, the words say it */
.st-caption-row { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* a name's underline sits under the row's box: room for it, so the cut never clips it */
.st-caption-row { padding-bottom: 3px; margin-bottom: -3px; }
.st-caption-row:first-child::before { content: ""; display: inline-block; width: 7px; height: 7px; margin: 0 11px 2px 0; transform: rotate(45deg); vertical-align: middle; background: var(--tone, var(--brass)); }
.st-caption[data-kind="plea"] { --tone: var(--warn); }
.st-caption:is([data-kind="fall"], [data-kind="flaw"]) { --tone: var(--fail); }
.st-caption:is([data-kind="loot"], [data-kind="complete"], [data-kind="rise"]) { --tone: var(--ok); }
.st-caption[data-kind="quest"] { --tone: var(--info); }
.st-caption[data-kind="renown"] { --tone: var(--brass-hi); box-shadow: 0 0 0 1px rgba(241, 213, 144, 0.55), 0 0 26px -6px rgba(241, 213, 144, 0.45), 0 12px 32px -14px rgba(0, 0, 0, 0.75); }
.st-caption[data-kind="complete"] { box-shadow: 0 0 0 1px rgba(166, 221, 143, 0.32), 0 12px 32px -14px rgba(0, 0, 0, 0.75); }
/* a chapter's title card: V1's three lines, the act in small caps, its title large, its tagline in italic */
.st-caption[data-kind="chapter"] { display: grid; justify-items: center; gap: 2px; padding: 12px 34px 13px; background: rgba(14, 10, 7, 0.86); --tone: var(--brass-hi); box-shadow: 0 0 0 1px rgba(241, 213, 144, 0.5), 0 0 30px -8px rgba(241, 213, 144, 0.4), 0 14px 36px -14px rgba(0, 0, 0, 0.8); }
.st-caption[data-kind="chapter"] small { font: 400 13px/1.3 var(--display); letter-spacing: 0.22em; color: var(--brass); }
.st-caption-title { font: 400 30px/1.1 var(--display); letter-spacing: 0.04em; color: var(--brass-hi); }
.st-caption[data-kind="chapter"] em { font-size: 17px; color: var(--paper); opacity: 0.86; }

/* ── the chapter chip ───────────────────────────────────────────── */
.st-chapter-chip { position: relative; display: inline-block; }
.st-chapter-btn {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  line-height: 32px;
  font-size: 13px;
  color: var(--paper);
  cursor: pointer;
}
.st-chapter-btn:hover { border-color: var(--brass-line); }
.st-chapter-btn[aria-expanded="true"] { border-color: var(--brass-line); background: rgba(38, 29, 19, 0.92); }
.st-chapter-numeral { min-width: 2.2ch; font-family: var(--display); letter-spacing: 0.08em; color: var(--brass); }
.st-chapter-title { font-family: var(--display); letter-spacing: 0.04em; color: var(--brass-hi); }
.st-chapter-chip[data-compact="true"] .st-chapter-btn { width: 36px; padding: 0; justify-content: center; }
.st-chapter-chip[data-compact="true"] .st-chapter-btn .st-chapter-title { display: none; }
.st-chapter-chip[data-compact="true"] .st-chapter-btn .st-chapter-numeral { min-width: 0; }
.st-chapter-pop { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 5; width: max-content; min-width: 250px; max-width: min(320px, calc(100vw - 32px)); max-height: min(60vh, 420px); overflow-y: auto; padding: 6px; background: rgba(20, 15, 11, 0.94); }
.st-chapter-list { margin: 0; padding: 0; list-style: none; }
.st-chapter-list button { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; width: 100%; min-height: 40px; padding: 7px 10px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
.st-chapter-list button .st-chapter-title { font-size: 14px; }
.st-chapter-list button small { grid-column: 2; color: var(--paper); opacity: 0.72; font-style: italic; font-size: 12.5px; }
.st-chapter-list button:hover, .st-chapter-list button:focus-visible { background: var(--brass-wash); }
.st-chapter-list button[aria-current="step"] { box-shadow: inset 2px 0 0 var(--brass-hi); background: rgba(220, 182, 98, 0.08); }

/* ── the place dossier ──────────────────────────────────────────── */
.st-place { display: flex; flex-direction: column; gap: 12px; width: 372px; max-width: 100%; max-height: 100%; overflow-y: auto; padding: 14px 14px 16px; scrollbar-width: thin; scrollbar-color: var(--hair-2) transparent; animation: st-rise 0.22s ease-out both; }
.st-place-head { display: flex; align-items: flex-start; gap: 10px; }
.st-place-mark { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--brass-line); background: radial-gradient(circle at 50% 35%, rgba(220, 182, 98, 0.18), transparent 70%); color: var(--brass-hi); }
.st-place-id { flex: 1; min-width: 0; display: grid; gap: 2px; }
.st-place-id h2 { margin: 0; font: 400 var(--t-2xl)/1.1 var(--display); letter-spacing: 0.05em; color: var(--brass-hi); }
.st-place-pkg { font-size: var(--t-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-place-about { margin: 0; font-size: var(--t-md); color: var(--muted); }
.st-place section { display: grid; gap: 6px; }
.st-place .hud-sub-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.st-spark { display: block; width: 100%; height: 44px; border-radius: var(--r-sm); background: var(--raise); }
.st-spark-line { fill: none; stroke: var(--brass-hi); stroke-width: 1.6; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.st-spark-area { fill: var(--brass-wash); stroke: none; }
.st-place-heroes, .st-place-deeds, .st-place-files { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.st-place-hero { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 8px 4px 4px; border: 0; border-radius: var(--r-sm); background: none; text-align: left; }
button.st-place-hero { cursor: pointer; }
button.st-place-hero:hover { background: var(--raise-2); }
.st-place-hero-id { flex: 1; min-width: 0; display: grid; }
.st-place-hero-id b { font-weight: 500; color: var(--paper); }
.st-place-hero-id .num { font-size: 11.5px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-place-deeds li { display: grid; grid-template-columns: 42px 10px 1fr; gap: 8px; align-items: baseline; padding: 3px 4px; font-size: var(--t-md); }
.st-place-at { font-size: 11.5px; color: var(--faint); text-align: right; }
.st-place-pip { width: 8px; height: 8px; transform: rotate(45deg); background: var(--banner); box-shadow: 0 0 0 1px rgba(12, 9, 7, 0.8); }
.st-place-deed { min-width: 0; overflow-wrap: anywhere; color: var(--muted); }
.st-place-deed b { font-weight: 500; color: var(--paper); }
.st-place-deed .num { font-size: 12px; }
.st-place-fail { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; color: var(--fail); font-size: var(--t-sm); }
.st-place-annals li { grid-template-columns: 64px 1fr; }
.st-place-facts .ui-stat-rows, .st-place-facts dl { margin: 0; }
.st-place-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 32px; margin: -6px 0 -4px -4px; padding: 0 8px; border: 0; border-radius: var(--r-sm); background: none; color: var(--brass-hi); font: 400 var(--t-md)/1 var(--display); letter-spacing: 0.08em; cursor: pointer; }
.st-place-back:hover { background: var(--raise-2); }
.st-place-files li { display: flex; justify-content: space-between; gap: 10px; padding: 3px 4px; font-size: 12px; }
.st-place-file { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.st-place-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px 0 10px; color: var(--brass-hi); cursor: pointer; }
.st-place-chip:hover { border-color: var(--brass-line); }
.st-place-chip-name { font: 400 var(--t-lg)/1 var(--display); letter-spacing: 0.06em; }
.st-place-chip-heroes { display: inline-flex; align-items: center; gap: 1px; color: var(--muted); font-size: 11.5px; }

/* ── the README badge ───────────────────────────────────────────── */
.st-badge { position: relative; display: inline-block; }
.st-badge-pop { position: absolute; right: 0; top: calc(100% + 8px); z-index: 5; width: min(380px, calc(100vw - 32px)); display: grid; gap: 10px; padding: 12px 14px 14px; background: rgba(20, 15, 11, 0.96); }
.st-badge[data-placement="above"] .st-badge-pop { top: auto; bottom: calc(100% + 8px); right: auto; left: 0; }
.st-badge-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.st-badge-head h2 { margin: 0; }
.st-badge-preview { margin: 0; min-height: 20px; }
.st-badge-preview img { display: block; height: 20px; }
.st-badge-md { width: 100%; resize: none; padding: 8px 10px; border-radius: var(--r-sm); border: 1px solid var(--hair-2); background: var(--ink-deep); font-size: 11.5px; line-height: 1.45; color: var(--paper); }
.st-badge-actions { display: flex; justify-content: flex-end; }

/* ── phones: bottom sheets, one at a time, inside the safe area ── */
@media (max-width: 720px) {
  .st-scrim { padding: calc(24px + env(safe-area-inset-top)) 0 0; place-items: end stretch; }
  .st-book, .st-card {
    width: 100%;
    max-height: 100%;
    border-radius: 12px 12px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .st-book { height: 100%; box-shadow: 0 0 0 1px rgba(90, 62, 26, 0.45), 0 -20px 50px -20px rgba(0, 0, 0, 0.8); }
  .st-book-head { padding: 14px 10px 10px 18px; flex-wrap: wrap; gap: 8px; }
  .st-book-titles { flex-basis: calc(100% - 56px); }
  .st-book-tools { order: -1; width: 100%; justify-content: space-between; }
  .st-book-head h2 { font-size: 21px; }
  .st-book-tabs { padding: 8px 18px 0; }
  .st-book-body { padding: 12px 18px 22px; }
  .st-ch-num { min-width: 24px; font-size: 17px; }
  .st-chapter > :not(.st-ch-head), .st-ch-loot { margin-left: 38px; }
  .st-era > .st-era-island { margin: 10px 0 4px; aspect-ratio: 16 / 9; }
  .st-era .st-annal { grid-template-columns: 1fr; }
  .st-annal { grid-template-columns: 1fr; }
  .st-annal-day { text-align: left; }
  .st-annal-mark { display: none; }
  .st-book-foot { padding: 6px 12px calc(8px + env(safe-area-inset-bottom)); }
  .st-card { padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); border-width: 1px 0 0; }
  .st-card-head h2 { font-size: 21px; }
  .st-card-formats { display: grid; grid-template-columns: 1fr 1fr; }
  .st-card-format { justify-content: center; min-height: 44px; padding: 0 8px; }
  .st-card-format small { display: none; }
  .st-card-preview[data-format="portrait"] { height: min(44dvh, 440px); }
  .st-card-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .st-card-actions > :first-child { grid-column: 1 / -1; }
  .st-card-actions .ui-btn { min-height: 44px; }
  .st-caption { font-size: 16px; padding: 7px 14px 8px; }
  .st-caption-title { font-size: 24px; }
  .st-chapter-btn { height: 40px; line-height: 38px; }
  .st-chapter-chip[data-compact="true"] .st-chapter-btn { width: 40px; }
  .st-place { width: 100%; border-radius: 12px 12px 0 0; padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
  .st-place-chip { min-height: 44px; }
}
@media (hover: none) and (pointer: coarse) {
  .st-book-btn, .st-book-close, .st-page-btn, .st-book-tab { min-height: 44px; }
  .st-book-close, .st-page-btn { width: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .st-scrim, .st-book, .st-card, .st-place { animation: none; }
  .st-caption { animation: none; transition: opacity 0.3s linear; }
  .st-caption[data-leaving="true"] { translate: none; }
  .st-spinner { animation-duration: 2.4s; }
}
`
