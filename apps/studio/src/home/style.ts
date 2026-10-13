/** The home page's layout, on the studio's `.gh` tokens (browser/style.ts: V1's HUD look). */
const CSS = /* css */ `
.gh-home {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background:
    radial-gradient(900px 520px at 78% 8%, rgba(232, 160, 80, 0.10), transparent 65%),
    radial-gradient(1100px 700px at 12% -12%, rgba(220, 182, 98, 0.08), transparent 60%),
    linear-gradient(#1b1611, #100c09 900px);
  font-size: 15px;
}
.gh-home :focus-visible { outline: 2px solid var(--brass-hi); outline-offset: 3px; }
.gh-home a { color: inherit; }
.gh-home-page { max-width: 1280px; margin: 0 auto; padding: 0 40px 28px; }

/* ── hero ───────────────────────────────────────────────────────── */
.gh-hero {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 52px;
  align-items: center;
  padding: 40px 0 30px;
}
.gh-hero .copy { max-width: 520px; }
.gh-hero h1 {
  margin: 14px 0 0;
  font: 400 62px/0.98 var(--display);
  letter-spacing: 0.035em;
  color: var(--paper);
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
}
.gh-hero h1 span { display: block; color: var(--brass); }
.gh-hero .pitch { margin: 22px 0 0; font: 500 26px/1.2 var(--body); color: var(--paper); }
.gh-hero .lede { margin: 12px 0 0; font: 400 16.5px/1.6 var(--body); color: var(--muted); }
.gh-hero .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.gh-hero .hint { margin: 16px 0 0; font-size: 13.5px; color: var(--faint); }
.gh-hero .hint .gh-kbd { margin: 0 2px; }

.gh-btn {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  height: 42px;
  padding: 0 18px;
  border: 1px solid var(--brass-line);
  border-radius: 7px;
  background: var(--raise);
  color: var(--paper);
  font: 500 15px/1 var(--body);
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.gh-btn:hover { background: var(--raise-2); border-color: var(--brass); }
.gh-btn.primary {
  border-color: #f1d590;
  background: linear-gradient(#ebcb7c, #cfa64f);
  color: #1a130b;
  font-weight: 700;
  box-shadow: 0 1px 0 rgba(255, 245, 220, 0.5) inset, 0 10px 24px -12px rgba(220, 182, 98, 0.7);
}
.gh-btn.primary:hover { background: linear-gradient(#f3d88f, #d8b05a); }

.gh-home .gh-kbd {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--hair-2);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--raise);
  color: var(--muted);
  font: 500 11px/1 var(--mono);
  vertical-align: 1px;
}

/* The diorama, set like a museum plate: brass hairline, corner marks, a caption strip. */
.gh-hero .plate {
  position: relative;
  margin: 0;
  border: 1px solid var(--brass-line);
  border-radius: 10px;
  background: #0f0b08;
  box-shadow: 0 1px 0 rgba(255, 240, 210, 0.07) inset, 0 40px 80px -36px rgba(0, 0, 0, 0.95),
    0 0 0 6px rgba(20, 15, 11, 0.6);
  overflow: hidden;
}
.gh-hero .plate::before, .gh-hero .plate::after {
  content: "";
  position: absolute;
  z-index: 1;
  width: 18px;
  height: 18px;
  border: 0 solid var(--brass-hi);
  opacity: 0.8;
  pointer-events: none;
}
.gh-hero .plate::before { top: 10px; left: 10px; border-top-width: 1.5px; border-left-width: 1.5px; }
.gh-hero .plate::after { top: 10px; right: 10px; border-top-width: 1.5px; border-right-width: 1.5px; }
.gh-hero .plate .stage { position: relative; aspect-ratio: 16 / 10.5; cursor: grab; }
.gh-hero .plate .stage:active { cursor: grabbing; }
/* A lamp-lit vignette, so the sky's edges fall away into the page. */
.gh-hero .plate .stage::after {
  content: "";
  position: absolute;
  z-index: 1;
  inset: 0;
  background: radial-gradient(120% 95% at 50% 42%, transparent 58%, rgba(20, 14, 9, 0.5) 100%);
  pointer-events: none;
}
.gh-hero .plate canvas { position: absolute; inset: 0; }
.gh-hero figcaption {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid var(--brass-line);
  background: rgba(20, 15, 11, 0.94);
  color: var(--muted);
  font: 400 13.5px/1.35 var(--body);
}
.gh-hero .live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--brass);
  font: 500 10.5px/1 var(--mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.gh-hero .live::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8fdc7a;
  box-shadow: 0 0 8px rgba(143, 220, 122, 0.8);
  animation: gh-pulse 2.4s ease-in-out infinite;
}
@keyframes gh-pulse { 50% { opacity: 0.35; } }

/* ── stats ──────────────────────────────────────────────────────── */
.gh-home-stats dl {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  border: 1px solid var(--hair-2);
  border-radius: 9px;
  background: rgba(20, 15, 11, 0.7);
  overflow: hidden;
}
.gh-home-stats dl > div {
  display: flex;
  flex-direction: column-reverse;
  gap: 6px;
  padding: 16px 20px 15px;
}
.gh-home-stats dl > div + div { border-left: 1px solid var(--hair); }
.gh-home-stats dt { color: var(--faint); font: 500 11px/1.2 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; }
.gh-home-stats dd { margin: 0; color: var(--paper); font: 500 28px/1 var(--mono); font-variant-numeric: tabular-nums; }

/* ── tools ──────────────────────────────────────────────────────── */
.gh-section-head { padding: 64px 0 8px; }
.gh-section-head h2 { margin: 10px 0 0; font: 400 32px/1.1 var(--display); letter-spacing: 0.04em; color: var(--paper); }

.gh-group-row {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 32px;
  padding: 28px 0;
}
.gh-group-row + .gh-group-row { border-top: 1px solid var(--hair); }
.gh-group-row header { padding-top: 4px; }
.gh-group-row h3 { margin: 0; font: 400 21px/1.1 var(--display); letter-spacing: 0.06em; color: var(--brass-hi); }
.gh-group-row header p { margin: 8px 0 0; color: var(--faint); font-size: 14.5px; line-height: 1.5; }
.gh-group-row .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }

.gh-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hair-2);
  border-radius: 9px;
  background: rgba(20, 15, 11, 0.86);
  box-shadow: 0 1px 0 rgba(255, 240, 210, 0.05) inset, 0 16px 30px -22px rgba(0, 0, 0, 0.9);
  overflow: hidden;
  text-decoration: none;
  transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
}
a.gh-card:hover {
  border-color: var(--brass-line);
  transform: translateY(-2px);
  box-shadow: 0 1px 0 rgba(255, 240, 210, 0.07) inset, 0 22px 40px -22px rgba(0, 0, 0, 0.95);
}
.gh-card .shot {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-bottom: 1px solid var(--hair);
  background: #0e0b08;
}
.gh-card .shot img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
a.gh-card:hover .shot img { transform: scale(1.035); }
.gh-card .shot .blank {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background:
    repeating-linear-gradient(135deg, rgba(220, 182, 98, 0.06) 0 1px, transparent 1px 11px),
    radial-gradient(circle at 50% 45%, rgba(220, 182, 98, 0.1), transparent 70%);
}
.gh-card .shot .blank svg { opacity: 0.55; }
.gh-card .body { display: flex; flex-direction: column; flex: 1; padding: 13px 15px 14px; }
.gh-card h4 { display: flex; align-items: center; gap: 8px; margin: 0; font: 400 17px/1.15 var(--display); letter-spacing: 0.05em; color: var(--paper); }
.gh-card p { flex: 1; margin: 6px 0 12px; color: var(--muted); font-size: 14px; line-height: 1.45; }
.gh-card .go { display: flex; align-items: center; gap: 6px; color: var(--faint); transition: color 0.15s; }
.gh-card .go code { font: 11.5px/1 var(--mono); }
a.gh-card:hover .go { color: var(--brass-hi); }
.gh-card .soon {
  padding: 3px 6px 2px;
  border: 1px solid var(--brass-line);
  border-radius: 4px;
  color: var(--brass);
  font: 500 9.5px/1 var(--mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.gh-card[data-soon="true"] { background: rgba(20, 15, 11, 0.5); border-style: dashed; }
.gh-card[data-soon="true"] h4 { color: var(--muted); }

/* ── how it's made ──────────────────────────────────────────────── */
.gh-made .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding-top: 22px; }
.gh-made article {
  padding: 20px 22px 18px;
  border: 1px solid var(--hair-2);
  border-top: 2px solid var(--brass-line);
  border-radius: 9px;
  background: rgba(20, 15, 11, 0.7);
}
.gh-made h3 { margin: 0; font: 400 19px/1.1 var(--display); letter-spacing: 0.05em; color: var(--paper); }
.gh-made p { margin: 10px 0 0; color: var(--muted); font-size: 14.5px; line-height: 1.6; }
.gh-made .sources { margin: 12px 0 0; padding: 0; list-style: none; }
.gh-made .sources li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 7px 0; border-top: 1px solid var(--hair); }
.gh-made .sources a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--brass-hi);
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: var(--brass-line);
  text-underline-offset: 3px;
}
.gh-made .sources a:hover { text-decoration-color: var(--brass-hi); }
.gh-made .sources span { color: var(--faint); font-size: 13.5px; }

.gh-home-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 28px;
  margin-top: 56px;
  padding-top: 20px;
  border-top: 1px solid var(--hair);
  color: var(--faint);
  font-size: 13.5px;
}
.gh-home-foot .brand { display: inline-flex; align-items: center; gap: 9px; color: var(--muted); font: 400 14px/1 var(--display); letter-spacing: 0.08em; }
.gh-home-foot a { color: var(--muted); text-decoration: underline; text-decoration-color: var(--hair-2); text-underline-offset: 3px; }
.gh-home-foot a:hover { color: var(--paper); }
.gh-home-foot .copy { margin-left: auto; font-size: 13px; }

/* ── narrower windows ───────────────────────────────────────────── */
@media (max-width: 1180px) {
  .gh-hero h1 { font-size: 54px; }
  .gh-group-row { grid-template-columns: 170px minmax(0, 1fr); gap: 24px; }
  .gh-group-row .cards { gap: 12px; }
}
@media (max-width: 980px) {
  .gh-home-page { padding: 0 24px 24px; }
  .gh-hero { grid-template-columns: minmax(0, 1fr); gap: 32px; padding-top: 28px; }
  .gh-home-stats dl { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .gh-home-stats dl > div:nth-child(4) { border-left: 0; }
  .gh-home-stats dl > div:nth-child(n + 4) { border-top: 1px solid var(--hair); }
  .gh-group-row { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .gh-group-row .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gh-made .cols { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .gh-home-page { padding: 0 16px 20px; }
  .gh-hero h1 { font-size: 44px; }
  .gh-home-stats dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gh-home-stats dl > div:nth-child(n) { border-left: 0; border-top: 1px solid var(--hair); }
  .gh-home-stats dl > div:nth-child(even) { border-left: 1px solid var(--hair); }
  .gh-home-stats dl > div:nth-child(-n + 2) { border-top: 0; }
  .gh-group-row .cards { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .gh-home *, .gh-home *::before { transition: none !important; animation: none !important; }
  a.gh-card:hover { transform: none; }
}
`

let users = 0
let node: HTMLStyleElement | null = null

/** Adds the home stylesheet while the home page is mounted. */
export function holdHomeStyle(): { ready: Promise<void>; release(): void } {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "home"
    node.textContent = CSS
    document.head.append(node)
  }
  let released = false
  return {
    ready: Promise.resolve(),
    release() {
      if (released) return
      released = true
      if (--users > 0) return
      node?.remove()
      node = null
    },
  }
}
