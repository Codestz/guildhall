/**
 * Guildhall's design tokens, carried over from V1's HUD (legacy/packages/hall/src/hall.css `:root`, the
 * site's demos.css and loader.css): warm ink plaques, brass hairlines, three faces. Scoped to `.gh` so
 * a page opts in by class. Contrast on `--ink-solid` (V1's measurements): paper 15.6:1, muted 10.6:1,
 * faint 7.3:1, brass-hi 11.9:1, ink on brass 9.4:1.
 */

/**
 * V1's faces: Marcellus SC for titles, Alegreya Sans for text, JetBrains Mono for numbers and ids, and
 * Alegreya (the serif) for what is told: the Legends book, the captions, the Chronicle card.
 */
export const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Marcellus+SC&family=Alegreya:ital,wght@0,400;0,500;0,600;1,400&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap"

/** Faces the UI uses, loaded before a screen reports ready so shots never catch the fallback. */
export const FACES = [
  '400 17px "Marcellus SC"',
  '400 14px "Alegreya Sans"',
  '500 13px "JetBrains Mono"',
  '400 16px "Alegreya"',
  'italic 400 16px "Alegreya"',
  '600 16px "Alegreya"',
]

export const TOKENS_CSS = /* css */ `
.gh {
  /* surfaces */
  --ink: rgba(20, 15, 11, 0.86);
  --ink-deep: rgba(12, 9, 7, 0.6);
  --ink-solid: #15110d;
  --ink-raised: #1d1712;
  --raise: rgba(255, 238, 205, 0.05);
  --raise-2: rgba(255, 238, 205, 0.09);
  --hair: rgba(243, 233, 212, 0.1);
  --hair-2: rgba(243, 233, 212, 0.16);

  /* text */
  --paper: #f3e9d4;
  --muted: #cdbfa3;
  --faint: #ab9e85;

  /* brass */
  --brass: #dcb662;
  --brass-hi: #f1d590;
  --brass-line: rgba(220, 182, 98, 0.34);
  --brass-wash: rgba(220, 182, 98, 0.16);
  --on-brass: #1a130c;

  /* tones: always paired with a glyph or a word, never colour alone */
  --warn: #ffc451;
  --fail: #ff8b7b;
  --ok: #a6dd8f;
  --info: #8fd0e6;

  /* type */
  --display: "Marcellus SC", "Cormorant SC", Georgia, serif;
  --body: "Alegreya Sans", "Gill Sans", "Trebuchet MS", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --serif: "Alegreya", "Iowan Old Style", Georgia, serif;
  --t-xs: 10.5px;
  --t-sm: 12px;
  --t-md: 13.5px;
  --t-lg: 15px;
  --t-xl: 19px;
  --t-2xl: 24px;
  --track-caps: 0.12em;

  /* rhythm */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 20px;
  --r: 7px;
  --r-sm: 5px;
  --hit: 32px;
  --shadow: 0 1px 0 rgba(255, 240, 210, 0.06) inset, 0 18px 40px -18px rgba(0, 0, 0, 0.7),
    0 2px 8px rgba(0, 0, 0, 0.28);
  --ring: 0 0 0 2px var(--ink-solid), 0 0 0 4px var(--brass-hi);

  font: 14px/1.4 var(--body);
  color: var(--paper);
  -webkit-font-smoothing: antialiased;
}
/* a phone is touch: hit targets are 44 px (viewer/style.ts sizes what fixes its own, site/style.ts the site's) */
.gh[data-phone], .gh [data-phone] { --hit: 44px; }
.gh *, .gh *::before, .gh *::after { box-sizing: border-box; }
/* V1's bare-element reset at no specificity: a class's own face, size, weight and colour on a button
   (the Chronicle chip's Marcellus, a segment's muted label) win over it, as they did in V1 */
:where(.gh) :where(button, input, select) { font: inherit; color: inherit; }
.gh ::-webkit-scrollbar { width: 8px; height: 8px; }
.gh ::-webkit-scrollbar-thumb { background: var(--hair-2); border-radius: 4px; }
.gh ::-webkit-scrollbar-track { background: transparent; }
.gh .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
`
