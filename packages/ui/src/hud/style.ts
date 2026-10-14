import { AVATAR_CSS } from "./avatar/style.ts"
import { CHIPS_CSS } from "./chips.style.ts"
import { STORY_CSS } from "./story/style.ts"

/**
 * The HUD panels' sheet: V1's hall.css rules for the roster, chronicle, toasts, dossier, pleas, settings,
 * brand and tape, rebuilt on the `.gh` tokens (theme/tokens.ts) and the `ui-*` pieces (Panel's plaque,
 * Button, Segmented, Toggle, Kbd). Tones: work muted, plea warn, loot ok, quest info, fail fail, idle
 * faint; always with a glyph and a word. A panel with `hud-sheet` becomes a bottom sheet on a phone.
 */
export const HUD_CSS = /* css */ `
.gh .hud-glyph { flex: none; display: block; }
.gh .hud-pennant { flex: none; display: inline-block; vertical-align: -2px; color: var(--muted); }
.hud-faint { color: var(--faint); font-size: var(--t-sm); }
.hud-eyebrow { font: 400 var(--t-sm)/1.2 var(--display); letter-spacing: 0.12em; color: var(--brass); }
.hud-empty { margin: 0; padding: var(--s3) var(--s4) var(--s4); color: var(--faint); font-style: italic; font-size: var(--t-md); }
.hud-tab-dot { position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 2px var(--ink-solid); }

/* ── folding panel ──────────────────────────────────────────────── */
.hud-panel { display: flex; flex-direction: column; min-height: 0; max-height: 100%; }
.hud-panel-head { margin: 0; font: inherit; }
.hud-panel-head button, .hud-panel-static {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-height: 44px;
  padding: 0 var(--s3) 0 var(--s4);
  border: 0;
  background: none;
  text-align: left;
  border-radius: var(--r);
  cursor: pointer;
}
.hud-panel-static { cursor: default; }
.hud-panel-head button:hover .hud-fold { color: var(--paper); }
.hud-panel-label { font: 400 var(--t-lg)/1.2 var(--display); letter-spacing: 0.1em; color: var(--brass-hi); white-space: nowrap; }
.hud-panel-meta { flex: 1; min-width: 0; font-size: var(--t-sm); color: var(--faint); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-meta-plea { color: var(--warn); font-weight: 700; }
.hud-fold { display: grid; place-items: center; color: var(--faint); transition: transform 0.2s; }
.hud-panel[data-open="false"] .hud-fold[data-compact="false"] { transform: rotate(-90deg); }
.hud-panel-body { min-height: 0; overflow-y: auto; border-top: 1px solid var(--hair); scrollbar-width: thin; scrollbar-color: var(--hair-2) transparent; }
.hud-panel-body[hidden] { display: none; }

/* ── sigil, status, tags ────────────────────────────────────────── */
.hud-sigil { --size: 30px; flex: none; position: relative; display: grid; place-items: center; width: var(--size); height: var(--size); color: #120d09; }
.hud-sigil::before {
  content: "";
  position: absolute;
  inset: 13%;
  transform: rotate(45deg);
  border-radius: 3px;
  background: var(--banner);
  box-shadow: 0 0 0 1.5px rgba(20, 15, 11, 0.9), 0 0 0 2.5px color-mix(in srgb, var(--banner) 55%, transparent);
}
.hud-sigil .hud-glyph { position: relative; stroke-width: 1.9; }
.hud-sigil[data-size="sm"] { --size: 18px; }
.hud-sigil[data-size="lg"] { --size: 48px; }
.hud-sigil-num {
  position: absolute;
  right: -3px;
  bottom: -2px;
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
.hud-sigil[data-size="lg"] .hud-sigil-num { font-size: 11.5px; line-height: 15px; min-width: 17px; }

.hud-status { display: inline-flex; align-items: center; gap: 5px; font-size: var(--t-sm); font-weight: 500; white-space: nowrap; color: var(--tone, var(--muted)); }
[data-tone="work"] { --tone: var(--muted); }
[data-tone="plea"] { --tone: var(--warn); }
[data-tone="loot"] { --tone: var(--ok); }
[data-tone="idle"] { --tone: var(--faint); }
[data-tone="fail"] { --tone: var(--fail); }

.hud-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px 0 6px;
  border-radius: 999px;
  border: 1px solid var(--hair-2);
  background: var(--raise);
  font-size: var(--t-sm);
  color: var(--muted);
  white-space: nowrap;
}
.hud-tag[data-kind="banner"] i { width: 10px; height: 10px; border-radius: 2px; transform: rotate(45deg); background: var(--banner); box-shadow: 0 0 0 1px rgba(12, 9, 7, 0.8); margin: 0 2px; }

/* ── brand ──────────────────────────────────────────────────────── */
.hud-brand { flex: none; width: 304px; max-width: 100%; display: grid; gap: 10px; padding: 10px 14px 12px 10px; }
.hud-brand-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.hud-crest {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--brass-line);
  background: radial-gradient(circle at 50% 35%, rgba(220, 182, 98, 0.18), transparent 70%);
  color: var(--brass-hi);
}
button.hud-crest { cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
button.hud-crest:hover { border-color: var(--brass); box-shadow: 0 0 18px -6px rgba(220, 182, 98, 0.6); }
button.hud-crest:focus-visible { border-radius: 50%; }
.hud-brand-id { min-width: 0; display: grid; gap: 3px; }
.hud-brand-name { margin: 0; font: 400 var(--t-xl)/1.05 var(--display); letter-spacing: 0.06em; color: var(--brass-hi); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-status-line { margin: 0; display: flex; align-items: center; min-width: 0; font-size: var(--t-sm); color: var(--muted); white-space: nowrap; overflow: hidden; }
.hud-source { font-weight: 500; color: var(--paper); }
.hud-source[data-tone="lost"] { color: var(--fail); }
.hud-source[data-tone="wait"] { color: var(--muted); }
.hud-sl-part { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hud-sl-part::before { content: "·"; margin: 0 6px; color: var(--faint); }
.hud-sl-name { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
.hud-sl-plea { flex: none; color: var(--warn); font-weight: 700; }
.hud-source-dot { flex: none; width: 8px; height: 8px; margin-right: 7px; border-radius: 50%; border: 1.5px solid var(--faint); }
.hud-source-dot[data-tone="live"] { background: var(--ok); border-color: var(--ok); box-shadow: 0 0 8px var(--ok); animation: hud-live 2.4s ease-out infinite; }
.hud-source-dot[data-tone="replay"] { background: var(--info); border-color: var(--info); }
.hud-source-dot[data-tone="story"] { border-color: var(--warn); }
.hud-source-dot[data-tone="lost"] { background: var(--fail); border-color: var(--fail); }
@keyframes hud-live { 0% { box-shadow: 0 0 0 0 rgba(166, 221, 143, 0.55); } 70%, 100% { box-shadow: 0 0 0 6px rgba(166, 221, 143, 0); } }
.hud-brand .ui-figures { padding-top: 9px; border-top: 1px solid var(--hair); gap: 6px 22px; }
.hud-brand-alert { display: grid; gap: 8px; padding: 8px 10px; border-radius: var(--r-sm); background: rgba(255, 139, 123, 0.1); border: 1px solid rgba(255, 139, 123, 0.4); font-size: var(--t-md); color: var(--paper); }
.hud-brand-alert > span { display: flex; gap: 7px; align-items: flex-start; }
.hud-brand-alert > span .hud-glyph { margin-top: 2px; color: var(--fail); }
.hud-brand-alert .ui-btn { justify-self: start; }
.hud-brand[data-crest="false"] { padding: 9px 12px 10px 14px; gap: 8px; }
.hud-brand[data-compact="true"]:not([data-open="true"]) { width: auto; min-width: 220px; }
.hud-brand-toggle {
  display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px; margin: -2px -4px; padding: 2px 4px;
  border: 0; border-radius: var(--r-sm); background: none; color: inherit; text-align: left; cursor: pointer;
}
.hud-brand-toggle:hover .hud-brand-name { color: var(--paper); }
.hud-brand-toggle .hud-fold { color: var(--faint); transition: transform 0.2s; }
.hud-brand-toggle[aria-expanded="false"] .hud-fold { transform: rotate(-90deg); }
/* the top row's repo chip: a small pill of its own width beside the site's crest (the same height and ink) */
.hud-repo-chip {
  flex: none; display: inline-flex; align-items: center; gap: 0; max-width: 100%; min-width: 0; height: 44px; padding: 0 14px 0 16px;
  border-radius: 999px; cursor: pointer; color: var(--paper); text-align: left;
}
.hud-repo-chip:hover, .hud-repo-chip[data-open="true"] { border-color: var(--brass-line); }
.hud-repo-chip:hover .hud-repo-name { color: var(--paper); }
.hud-repo-chip:focus-visible { outline: none; box-shadow: var(--ring); }
.hud-repo-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 16px/1 var(--display); letter-spacing: 0.05em; color: var(--brass-hi); }
.hud-repo-chip .hud-source-dot { margin: 0 0 0 10px; }
.hud-repo-source { margin-left: 6px; font-size: var(--t-sm); color: var(--muted); white-space: nowrap; }
.hud-repo-plea { display: grid; place-items: center; margin-left: 8px; color: var(--warn); }
.hud-brand-more { gap: 8px; }
.hud-brand-more .hud-about { padding-top: 8px; }
.hud-source-dot[data-tone="history"] { background: var(--brass); border-color: var(--brass); box-shadow: 0 0 6px rgba(220, 182, 98, 0.55); }
.hud-source-dot[data-tone="sketch"] { border-style: dashed; border-color: var(--muted); }
.hud-source[data-tone="sketch"] { color: var(--muted); }
.hud-chron-foot { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px var(--s3) 10px var(--s4); border-top: 1px solid var(--hair); }
.hud-about { display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--hair); font-size: var(--t-md); color: var(--muted); }
.hud-about[hidden] { display: none; }
.hud-about p { margin: 0; }

/* ── roster ─────────────────────────────────────────────────────── */
.hud-roster { width: 304px; max-width: 100%; }
.hud-roster-group { display: flex; align-items: center; gap: 7px; margin: 0; padding: 10px 14px 2px 12px; font: 400 var(--t-sm)/1.2 var(--display); letter-spacing: 0.12em; color: var(--brass); }
.hud-roster-group .hud-glyph { color: var(--brass); }
.hud-roster-group span:first-of-type { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-roster-group-n { flex: none; min-width: 22px; padding: 0 6px; border-radius: 9px; background: var(--raise-2); color: var(--muted); font: 700 11px/18px var(--body); letter-spacing: 0; text-align: center; font-variant-numeric: tabular-nums; }
.hud-roster-list { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.hud-roster-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px 10px 6px 6px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.hud-roster-row:hover { background: var(--raise); }
.hud-roster-row[aria-pressed="true"] { background: var(--brass-wash); border-color: var(--brass-line); }
.hud-roster-row[data-tone="plea"] { background: rgba(255, 196, 81, 0.09); }
.hud-roster-row[data-tone="fail"] { background: rgba(255, 139, 123, 0.08); }
.hud-roster-row[data-tone="idle"] .hud-sigil { opacity: 0.6; }
.hud-roster-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hud-roster-name { display: flex; align-items: center; gap: 5px; min-width: 0; font-weight: 700; font-size: 14.5px; color: var(--paper); }
.hud-roster-title { flex: none; }
.hud-roster-source { min-width: 0; font-weight: 400; font-size: var(--t-sm); color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-crown { display: inline-flex; color: var(--brass); }
.hud-on-camera { display: inline-flex; color: var(--info); }
.hud-roster-doing { font: 11.5px/1.4 var(--mono); color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-roster-row .hud-status { align-self: flex-start; margin-top: 2px; }
.hud-roster-row[data-tone="work"] .hud-status { font-weight: 400; }
.hud-roster-folds { padding-top: 0; }
.hud-roster-folds::before { content: ""; display: block; margin: 0 6px 4px; border-top: 1px solid var(--hair); }
.hud-roster-fold-head { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 4px 10px 4px 6px; border: 0; border-radius: var(--r-sm); background: none; text-align: left; cursor: pointer; }
.hud-roster-fold-head:hover { background: var(--raise); }
.hud-roster-fold-head[aria-expanded="true"] { position: sticky; top: 0; z-index: 1; background: var(--ink-solid); box-shadow: 0 1px 0 var(--hair); }
.hud-roster-fold-head[aria-expanded="false"] .hud-fold { transform: rotate(-90deg); }
.hud-fold-mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--brass-line); color: var(--brass-hi); }
.hud-roster-fold-name { flex: 1; min-width: 0; font-weight: 700; font-size: 14.5px; }
.hud-role-mark { display: inline-flex; align-items: center; gap: 3px; color: var(--tone); font-size: var(--t-sm); font-weight: 700; }
.hud-roster-members { padding: 2px 0 6px 14px; }
.hud-roster-members[hidden] { display: none; }

/* badges: the roster folded */
.hud-badges { flex: none; display: flex; align-items: center; gap: 2px; padding: 4px; max-width: 100%; }
.hud-badge-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px; min-width: 0; }
.hud-badge-group { display: flex; align-items: center; gap: 2px; }
.hud-badge-group[data-banner="true"] + .hud-badge-group { margin-left: 3px; padding-left: 4px; border-left: 1px solid var(--hair); }
.hud-badge-party { display: grid; place-items: center; width: 16px; }
.hud-badge {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
  transition: background 0.15s;
}
.hud-badge:hover { background: var(--raise-2); }
.hud-badge[aria-pressed="true"] { background: var(--brass-wash); box-shadow: inset 0 0 0 1px var(--brass-line); }
.hud-badge[data-tone="idle"] .hud-sigil { opacity: 0.55; }
.hud-badge-mark { position: absolute; top: 1px; right: 1px; display: grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: var(--ink-solid); color: var(--tone); }
.hud-badge[data-tone="plea"] .hud-badge-mark { animation: hud-ring 1.6s ease-out infinite; }
.hud-badge-role .hud-fold-mark { width: 28px; height: 28px; }
.hud-badge-count { position: absolute; right: 0; bottom: 0; min-width: 16px; height: 15px; padding: 0 3px; border-radius: 8px; background: var(--ink-solid); box-shadow: 0 0 0 1px var(--brass-line); color: var(--brass-hi); font-size: 10.5px; line-height: 15px; text-align: center; }
@keyframes hud-ring { 0% { box-shadow: 0 0 0 0 rgba(255, 196, 81, 0.6); } 80%, 100% { box-shadow: 0 0 0 7px rgba(255, 196, 81, 0); } }
.hud-tip {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 5px 9px;
  border-radius: var(--r-sm);
  background: var(--ink-solid);
  border: 1px solid var(--hair-2);
  white-space: nowrap;
  font-size: var(--t-sm);
  line-height: 1.3;
  color: var(--muted);
  opacity: 0;
  transform: translateY(-3px);
  pointer-events: none;
  transition: opacity 0.15s, transform 0.15s;
}
.hud-tip b { color: var(--paper); font-size: var(--t-md); }
.hud-badge:hover .hud-tip, .hud-badge:focus-visible .hud-tip { opacity: 1; transform: none; }
.hud-badge-empty { padding: 0 8px; font-size: var(--t-sm); font-style: italic; color: var(--faint); }
.hud-badges-expand { margin-left: 2px; width: 32px; height: 40px; border-left: 1px solid var(--hair); border-radius: 0 var(--r-sm) var(--r-sm) 0; }
.hud-badges-expand[data-more] { width: auto; min-width: 40px; padding: 0 6px; }
.hud-badges-more { font: 600 13px/1 var(--body); color: var(--brass-hi); }

/* ── chronicle ──────────────────────────────────────────────────── */
.hud-chronicle { width: 400px; max-width: 100%; }
.hud-chron-list { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 1px; }
.hud-chron-item { animation: hud-ink 0.35s ease-out both; }
@keyframes hud-ink { from { opacity: 0; transform: translateY(-4px); } }
.hud-chron-row {
  width: 100%;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: start;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  text-align: left;
  font-size: var(--t-md);
  line-height: 1.35;
  color: var(--muted);
}
button.hud-chron-row { cursor: pointer; }
button.hud-chron-row:hover { background: var(--raise); }
.hud-chron-glyph { padding-top: 1px; color: var(--faint); }
.hud-chron-text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.hud-chron-text b, .hud-toast-text b { color: var(--paper); font-weight: 700; }
.hud-chron-text b::before, .hud-toast-text b::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin: 0 6px 1px 1px;
  transform: rotate(45deg);
  background: var(--banner);
}
.hud-chron-text .hud-pennant, .hud-toast-text .hud-pennant { margin-right: 4px; }
.hud-chron-at { font-size: 11px; color: var(--faint); padding-top: 2px; }
.hud-chron-item[data-kind="thought"] .hud-chron-text { font-style: italic; }
[data-kind="quest"] > * > .hud-chron-glyph { color: var(--info); }
[data-kind="loot"] > * > .hud-chron-glyph { color: var(--ok); }
[data-kind="join"] > * > .hud-chron-glyph { color: var(--brass); }
.hud-chron-item[data-kind="plea"], .hud-toast[data-kind="plea"] { --band: rgba(255, 196, 81, 0.13); --tone-c: var(--warn); }
.hud-chron-item[data-kind="fail"], .hud-toast[data-kind="fail"] { --band: rgba(255, 139, 123, 0.13); --tone-c: var(--fail); }
.hud-chron-item:is([data-kind="plea"], [data-kind="fail"]) .hud-chron-row { color: var(--paper); background: var(--band); box-shadow: inset 2px 0 0 0 var(--tone-c); border-radius: 2px var(--r-sm) var(--r-sm) 2px; }
:is(.hud-chron-item, .hud-toast):is([data-kind="plea"], [data-kind="fail"]) .hud-chron-glyph { color: var(--tone-c); }
/* older lines settle back so the newest reads first (muted stays above 4.5:1 at the lowest step) */
.hud-chron-item:nth-child(n + 6) { opacity: 0.85; }
.hud-chron-item:nth-child(n + 10) { opacity: 0.8; }

/* toasts: the chronicle folded */
.hud-toasts { width: 400px; max-width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.hud-toast-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; max-width: 100%; }
.hud-toast { max-width: 100%; transition: opacity 0.2s linear; animation: hud-rise 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes hud-rise { from { opacity: 0; transform: translateY(8px); } }
.hud-toast-btn { max-width: 100%; display: flex; align-items: center; gap: 9px; min-height: 36px; padding: 6px 12px 6px 10px; text-align: left; font-size: var(--t-md); color: var(--muted); }
.hud-toast-btn::before { display: none; }
button.hud-toast-btn { cursor: pointer; }
button.hud-toast-btn:hover { color: var(--paper); border-color: var(--brass-line); }
.hud-toast-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-toast:is([data-kind="plea"], [data-kind="fail"]) .hud-toast-btn { color: var(--paper); border-color: var(--tone-c); box-shadow: inset 3px 0 0 0 var(--tone-c), var(--shadow); }
.hud-chron-open { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px 0 10px; font: 400 13px/1 var(--display); letter-spacing: 0.1em; color: var(--brass-hi); cursor: pointer; }
.hud-chron-open::before { display: none; }
.hud-chron-open .hud-glyph { color: var(--brass); }
.hud-chron-open .num { font-size: 11.5px; letter-spacing: 0; color: var(--faint); }
.hud-chron-open:hover { border-color: var(--brass-line); }
/* a short screen: the chip is the small mark of where the log is, not a plate over the corner */
.hud-toasts[data-compact] .hud-chron-open { height: 28px; gap: 6px; padding: 0 9px 0 8px; font-size: 12px; opacity: 0.85; }
.hud-toasts[data-compact] .hud-chron-open .hud-glyph { width: 12px; height: 12px; }
.hud-toasts[data-compact] .hud-chron-open .num { display: none; }
.hud-toasts[data-compact] .hud-chron-open:is(:hover, :focus-visible) { opacity: 1; }

/* ── dossier ────────────────────────────────────────────────────── */
.hud-dossier { width: 372px; max-width: 100%; max-height: 100%; display: flex; flex-direction: column; min-height: 0; background: rgba(20, 15, 11, 0.93); animation: hud-slide 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes hud-slide { from { opacity: 0; transform: translateX(14px); } }
.hud-dossier-head { display: flex; align-items: flex-start; gap: var(--s3); padding: var(--s4) var(--s2) var(--s3) var(--s4); }
.hud-dossier-head > .hud-sigil { margin-top: 4px; }
.hud-dossier-id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.hud-dossier-id .hud-eyebrow { font-size: 11px; color: var(--faint); }
.hud-dossier-id h2 { margin: 0; font: 400 var(--t-2xl)/1.1 var(--display); letter-spacing: 0.04em; color: var(--paper); overflow-wrap: anywhere; }
.hud-dossier-source { font: 400 var(--t-md) var(--body); letter-spacing: 0; color: var(--faint); }
.hud-dossier-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 4px; }
.hud-dossier-tags .hud-status { margin-right: 2px; }
.hud-quest-card { margin: 0 var(--s4) var(--s3); padding: 10px 12px; border-radius: var(--r-sm); background: var(--raise); border: 1px solid var(--hair); }
.hud-quest-card p { margin: 4px 0 0; font-size: 14px; color: var(--paper); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.hud-ledger { margin: 0 var(--s4) var(--s3); display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--hair); border-radius: var(--r-sm); }
.hud-ledger div { min-width: 0; padding: 7px 10px; }
.hud-ledger div + div { border-left: 1px solid var(--hair); }
.hud-ledger dt { font: 500 var(--t-md)/1.2 var(--body); font-variant: all-small-caps; letter-spacing: 0.08em; color: var(--faint); }
.hud-ledger dd { margin: 2px 0 0; font-size: 14px; color: var(--paper); white-space: nowrap; }
.hud-sub-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: var(--s2) var(--s4) 6px; border-top: 1px solid var(--hair); }
.hud-now { display: inline-flex; align-items: center; gap: 5px; font-size: var(--t-sm); color: var(--muted); }
.hud-now .hud-glyph { color: var(--brass); }
.hud-now b { color: var(--brass-hi); font-weight: 500; }
.hud-places { flex: none; }
.hud-file-list { list-style: none; margin: 0; padding: 0 var(--s4) var(--s3); display: grid; gap: 3px; }
.hud-file-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: baseline; font-size: var(--t-sm); }
.hud-file { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.hud-file-place { color: var(--paper); white-space: nowrap; }
.hud-file-place > span[aria-hidden] { margin-right: 4px; color: var(--faint); }
.hud-transcript { list-style: none; margin: 0; padding: 2px var(--s3) var(--s4) var(--s4); min-height: 80px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; scrollbar-width: thin; scrollbar-color: var(--hair-2) transparent; border-radius: 0 0 var(--r) var(--r); }
.hud-transcript:focus-visible { outline-offset: -2px; }
.hud-t { font-size: var(--t-md); line-height: 1.4; }
.hud-t p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.hud-t-label { display: inline-flex; align-items: center; gap: 5px; font: 500 var(--t-md)/1.2 var(--body); font-variant: all-small-caps; letter-spacing: 0.08em; color: var(--faint); }
.hud-t[data-kind="prompt"] { padding: 8px 10px; border-radius: var(--r-sm); border: 1px dashed var(--brass-line); color: var(--muted); }
.hud-t[data-kind="prompt"] p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; }
.hud-t[data-kind="thinking"] { padding: 2px 0 2px 10px; border-left: 1px solid var(--hair-2); color: var(--faint); }
.hud-t[data-kind="thinking"] p { font-style: italic; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.hud-t[data-kind="reply"] { padding: 8px 10px; border-radius: var(--r-sm); background: var(--raise-2); color: var(--paper); }
.hud-t[data-kind="reply"] .hud-t-label { color: var(--brass); }
.hud-t[data-kind="tool"] { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 8px; align-items: start; padding: 3px 0; }
.hud-t-state { padding-top: 1px; color: var(--faint); }
.hud-t[data-state="running"] .hud-t-state { color: var(--info); }
.hud-t[data-state="completed"] .hud-t-state { color: var(--ok); }
.hud-t[data-state="failed"] .hud-t-state { color: var(--fail); }
.hud-t-call { display: flex; gap: 8px; min-width: 0; align-items: baseline; }
.hud-t-name { font-size: 12.5px; color: var(--brass-hi); }
.hud-t-target { font-size: var(--t-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-t-note { grid-column: 2; font-size: 12.5px; color: var(--faint); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.hud-t[data-state="failed"] .hud-t-note { color: var(--fail); }
.hud-spin { transform-origin: 8px 8px; animation: hud-spin 0.9s linear infinite; }
@keyframes hud-spin { to { transform: rotate(360deg); } }

/* ── pleas ──────────────────────────────────────────────────────── */
.hud-pleas { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.hud-pleas:empty { display: none; }
.hud-plea-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(460px, 100%);
  padding: 8px 8px 8px 12px;
  border-radius: var(--r);
  text-align: left;
  background: rgba(30, 21, 10, 0.95);
  border: 1px solid rgba(255, 196, 81, 0.55);
  box-shadow: 0 0 0 4px rgba(255, 196, 81, 0.1), 0 0 28px -4px rgba(255, 196, 81, 0.45), var(--shadow);
  color: var(--paper);
  cursor: pointer;
  animation: hud-drop 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes hud-drop { from { opacity: 0; transform: translateY(-10px); } }
.hud-plea-mark { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: var(--warn); animation: hud-ring 1.6s ease-out infinite; }
.hud-plea-text { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 14px; }
.hud-plea-text b { color: #ffd98a; }
.hud-plea-sub { font: 11.5px/1.5 var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-plea-go { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: var(--r-sm); background: var(--warn); color: var(--on-brass); font-weight: 700; font-size: var(--t-md); }
.hud-plea-card:hover .hud-plea-go { background: #ffd98a; }
.hud-plea-more { padding: 0 5px; border-radius: 8px; background: rgba(26, 19, 12, 0.18); font-size: 11px; }

/* ── settings ───────────────────────────────────────────────────── */
.hud-settings { width: 372px; max-width: 100%; max-height: 100%; display: flex; flex-direction: column; min-height: 0; background: rgba(20, 15, 11, 0.95); animation: hud-slide 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.hud-settings-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 8px 18px; border-bottom: 1px solid var(--hair); }
.hud-settings-head h2 { margin: 0; font: 400 var(--t-xl)/1.2 var(--display); letter-spacing: 0.08em; color: var(--brass-hi); }
.hud-settings-head h2:focus { outline: none; }
.hud-settings-body { min-height: 0; overflow-y: auto; padding: 0 18px 14px; scrollbar-width: thin; scrollbar-color: var(--hair-2) transparent; }
.hud-set-section { display: grid; gap: 12px; padding: 14px 0 16px; }
.hud-set-section + .hud-set-section { border-top: 1px solid var(--hair); }
.hud-set-section .ui-section-head .meta { font-style: italic; }
.hud-keys summary { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; cursor: pointer; font-size: var(--t-md); color: var(--muted); border-radius: var(--r-sm); list-style: none; }
.hud-keys summary::-webkit-details-marker { display: none; }
.hud-keys summary:hover { color: var(--paper); }
.hud-keys:not([open]) summary .hud-glyph { transform: rotate(-90deg); }
.hud-keys dl { display: grid; gap: 6px; margin: 8px 0 0; }
.hud-keys dl div { display: grid; grid-template-columns: 110px 1fr; gap: 10px; align-items: center; }
.hud-keys dd { margin: 0; font-size: var(--t-md); color: var(--muted); }

/* ── timeline ───────────────────────────────────────────────────── */
.hud-timeline { position: relative; width: min(680px, 100%); height: 60px; }
.hud-tape { position: absolute; inset: 0; display: flex; align-items: center; gap: var(--s3); padding: 0 10px 0 10px; transition: opacity 0.2s, transform 0.2s; }
.hud-play {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--on-brass);
  background: var(--brass);
  box-shadow: 0 0 0 3px rgba(20, 15, 11, 0.9), 0 0 0 4px var(--brass-line);
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.hud-play:hover { background: var(--brass-hi); }
.hud-play:active { transform: scale(0.94); }
.gh .hud-play:focus-visible { outline-offset: 4px; border-radius: 50%; }
.hud-tape-time { flex: none; display: grid; min-width: 92px; line-height: 1.15; }
.hud-tape-time b { font: 500 var(--t-md)/1.2 var(--mono); color: var(--paper); white-space: nowrap; }
.hud-tape-time small { font-size: 11px; color: var(--faint); white-space: nowrap; }
.hud-track { position: relative; flex: 1; min-width: 80px; height: 44px; }
.hud-track-rail { position: absolute; left: 7px; right: 7px; top: 19px; height: 4px; border-radius: 2px; background: rgba(243, 233, 212, 0.16); }
.hud-track-fill { position: absolute; inset: 0 auto 0 0; width: calc(var(--p) * 100%); border-radius: inherit; background: var(--brass); }
.hud-beat { position: absolute; top: 50%; width: 2px; height: 11px; margin: -15px 0 0 -1px; border-radius: 1px; background: var(--c, var(--muted)); opacity: 0.6; pointer-events: none; }
.hud-beat[data-past="true"] { opacity: 1; }
.hud-beat[data-kind="quest"] { --c: var(--info); }
.hud-beat[data-kind="loot"] { --c: var(--ok); }
.hud-beat[data-kind="release"] { --c: var(--brass-hi); width: 3px; }
.hud-beat[data-kind="born"] { --c: var(--brass); }
.hud-beat:is([data-kind="plea"], [data-kind="fail"]) { width: 7px; height: 7px; margin: -14px 0 0 -3.5px; transform: rotate(45deg); }
.hud-beat[data-kind="plea"] { --c: var(--warn); }
.hud-beat[data-kind="fail"] { --c: var(--fail); }
.hud-ticks { position: absolute; left: 7px; right: 7px; top: 27px; margin: 0; padding: 0; list-style: none; height: 14px; pointer-events: none; }
.hud-ticks li { position: absolute; translate: -50% 0; font: 10.5px/14px var(--mono); color: var(--faint); white-space: nowrap; }
.hud-ticks li::before { content: ""; position: absolute; left: 50%; top: -6px; width: 1px; height: 4px; background: var(--hair-2); }
.hud-track input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; background: transparent; appearance: none; -webkit-appearance: none; cursor: pointer; }
.hud-track input::-webkit-slider-runnable-track { height: 100%; background: transparent; }
.hud-track input::-moz-range-track { background: transparent; }
.hud-track input::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: 13px; border-radius: 50%; background: var(--brass-hi); border: 3px solid var(--ink-solid); box-shadow: 0 0 0 1px var(--brass); }
.hud-track input::-moz-range-thumb { width: 10px; height: 10px; border-radius: 50%; background: var(--brass-hi); border: 3px solid var(--ink-solid); box-shadow: 0 0 0 1px var(--brass); }
.hud-track input:focus-visible { outline: none; }
.hud-track input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--brass), 0 0 0 5px rgba(241, 213, 144, 0.55); }
.hud-track input:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 1px var(--brass), 0 0 0 5px rgba(241, 213, 144, 0.55); }
.hud-rate { flex: none; min-width: 40px; height: 30px; padding: 0 8px; border: 1px solid var(--hair-2); border-radius: 999px; background: var(--ink-deep); color: var(--paper); font: 500 var(--t-sm)/1 var(--mono); cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.hud-rate:hover { border-color: var(--brass-line); background: var(--raise); }
.hud-live { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(166, 221, 143, 0.4); background: rgba(166, 221, 143, 0.08); color: var(--ok); font: 700 var(--t-sm)/1 var(--body); letter-spacing: 0.06em; cursor: pointer; }
.hud-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.hud-live:disabled { cursor: default; }
.hud-live[data-behind="true"] { color: var(--paper); border-color: var(--hair-2); background: var(--raise); }
.hud-live[data-behind="true"] i { background: var(--faint); box-shadow: none; }
.hud-live[data-behind="true"]:hover { border-color: var(--brass-line); }
.hud-scale { flex: none; display: flex; gap: 2px; margin: 0; padding: 2px; border: 1px solid var(--hair); border-radius: var(--r-sm); background: var(--ink-deep); min-width: 0; }
.hud-scale button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 0; border-radius: 4px; background: none; color: var(--muted); font-size: var(--t-md); cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s; }
.hud-scale button:hover:not(:disabled) { color: var(--paper); background: var(--raise); }
.hud-scale button[aria-pressed="true"] { color: var(--on-brass); background: var(--brass); font-weight: 700; }
.hud-scale button:disabled { opacity: 0.45; cursor: not-allowed; }
.hud-timeline-hint { position: absolute; left: 50%; bottom: 6px; width: 180px; height: 6px; margin-left: -90px; padding: 1px; border: 0; border-radius: 4px; background: var(--ink); box-shadow: 0 0 0 1px var(--hair-2); cursor: pointer; transition: opacity 0.2s; }
/* a finger's worth of target round the 6 px line */
.hud-timeline-hint::after { content: ""; position: absolute; inset: -16px -10px -6px; }
.hud-timeline-hint i { display: block; height: 100%; width: calc(var(--p) * 100%); border-radius: 3px; background: var(--brass); }
.hud-timeline[data-pinned="true"] .hud-timeline-hint { display: none; }
.hud-timeline[data-pinned="false"] .hud-tape { opacity: 0; transform: translateY(8px); pointer-events: none; }
.hud-timeline[data-pinned="false"]:is(:hover, :focus-within, [data-open="true"]) .hud-tape { opacity: 1; transform: none; pointer-events: auto; }
.hud-timeline[data-pinned="false"]:is(:hover, :focus-within, [data-open="true"]) .hud-timeline-hint { opacity: 0; }

/* ── phone: panels become bottom sheets, controls grow to touch size ── */
@media (max-width: 720px) {
  .hud-sheet { width: 100%; max-height: 62vh; background: rgba(20, 15, 11, 0.95); border-radius: 14px 14px var(--r) var(--r); }
  .hud-brand { width: auto; padding: 8px 12px 8px 8px; gap: 8px; }
  .hud-brand-name { font-size: 17px; }
  .hud-brand .ui-figures { display: none; }
  .hud-status-line:has(.hud-sl-plea) .hud-sl-name { display: none; }
  .hud-toast-list .hud-toast:nth-last-child(n + 3) { display: none; }
  .hud-timeline { width: 100%; height: 52px; }
  .hud-tape { gap: 8px; padding: 0 8px; }
  .hud-tape-time { min-width: 0; }
  .hud-tape-time small, .hud-ticks { display: none; }
  .hud-track-rail { top: 50%; margin-top: -2px; }
  .hud-track input::-webkit-slider-thumb { margin-top: 0; }
  .hud-track { height: 40px; }
  .hud-beat { margin-top: -14px; }
  .hud-scale-word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .hud-scale button { min-width: 40px; min-height: 36px; justify-content: center; padding: 0 8px; }
  .hud-rate { min-width: 44px; height: 36px; }
  .hud-ledger div { padding: 6px 8px; }
  .gh .ui-seg button { min-height: 38px; }
}
@media (prefers-reduced-motion: reduce) {
  .hud-chron-item, .hud-toast, .hud-dossier, .hud-settings, .hud-plea-card { animation: none; }
  .hud-plea-mark, .hud-badge[data-tone="plea"] .hud-badge-mark, .hud-source-dot[data-tone="live"] { animation: none; }
  .hud-spin { animation-duration: 3s; }
  .hud-fold, .hud-tape, .hud-tip, .hud-timeline-hint { transition: none; }
}
`

let users = 0
let node: HTMLStyleElement | null = null

/**
 * Adds the HUD sheet (after the tokens and component sheet `holdUiStyle` adds) while at least one holder
 * needs it. Release it on unmount.
 */
export function holdHudStyle(): () => void {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "hud"
    node.textContent = HUD_CSS + AVATAR_CSS + CHIPS_CSS + STORY_CSS
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
