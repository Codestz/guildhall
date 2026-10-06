import type { ReactNode } from "react"
import { GLYPH_PATHS, type GlyphPath } from "./glyphs.ts"

/** A small hand-drawn glyph set (1.5px strokes on a 16px grid). Decorative: always paired with text. */
function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="glyph"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** A glyph whose strokes come from glyphs.ts, shared with the scene's deed sigils. */
function Shared({ name }: { name: GlyphPath }) {
  return (
    <Glyph>
      {GLYPH_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </Glyph>
  )
}

export const Icon = {
  gear: () => (
    <Glyph>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
      <circle cx="8" cy="8" r="4.3" />
    </Glyph>
  ),
  /* HUD modes: one pane (minimal), panes (detailed), closed eye (hidden). */
  minimal: () => (
    <Glyph>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M4.5 5h3" />
    </Glyph>
  ),
  detailed: () => (
    <Glyph>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6 2.5v11M10 2.5v11M7.5 11h1" />
    </Glyph>
  ),
  hidden: () => (
    <Glyph>
      <path d="M2 8s2.4 3.5 6 3.5S14 8 14 8M3.6 10.2 2.5 11.6M12.4 10.2l1.1 1.4M8 11.5V13" />
    </Glyph>
  ),
  expand: () => (
    <Glyph>
      <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
    </Glyph>
  ),
  collapse: () => (
    <Glyph>
      <path d="M13.5 6.5h-4v-4M9.5 6.5 14 2M2.5 9.5h4v4M6.5 9.5 2 14" />
    </Glyph>
  ),
  crest: () => (
    <Glyph size={28}>
      <path d="M8 1.5 13.5 4v4.2c0 3-2.3 5.3-5.5 6.3-3.2-1-5.5-3.3-5.5-6.3V4z" />
      <path d="M5.2 9.5V7.2L8 5.4l2.8 1.8v2.3" />
      <path d="M6.6 9.5V8.3h2.8v1.2" />
    </Glyph>
  ),
  copy: () => (
    <Glyph>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
    </Glyph>
  ),
  check: () => (
    <Glyph>
      <path d="m3.5 8.5 3 3 6-7" />
    </Glyph>
  ),
  close: () => (
    <Glyph>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Glyph>
  ),
  chevron: () => (
    <Glyph>
      <path d="m4 6 4 4 4-4" />
    </Glyph>
  ),
  play: () => (
    <Glyph>
      <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
    </Glyph>
  ),
  pause: () => (
    <Glyph>
      <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2.2" />
    </Glyph>
  ),
  eye: () => (
    <Glyph>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </Glyph>
  ),
  crown: () => (
    <Glyph>
      <path d="M2.5 12h11M3 10.5 2 5l3.5 2.5L8 3l2.5 4.5L14 5l-1 5.5z" />
    </Glyph>
  ),
  /* Verbs on the name chips: what someone is doing, by shape. */
  read: () => <Shared name="read" />,
  edit: () => <Shared name="edit" />,
  search: () => <Shared name="search" />,
  test: () => <Shared name="test" />,
  run: () => <Shared name="run" />,
  /* Status / kind glyphs: shape carries the meaning, colour only reinforces it. */
  work: () => <Shared name="work" />,
  /** Dispatching: the guildmaster summons someone to a quest. */
  summon: () => <Shared name="star" />,
  /** Consulting the web or an outside tool. */
  globe: () => <Shared name="globe" />,
  plea: () => (
    <Glyph>
      <path d="M8 1.8 14.2 8 8 14.2 1.8 8z" />
      <path d="M8 5v3.6M8 10.8v.1" strokeWidth="1.8" />
    </Glyph>
  ),
  loot: () => (
    <Glyph>
      <path d="M2.5 6.5h11v6.5h-11zM2.5 6.5 4 3.5h8l1.5 3M6.5 9h3" />
    </Glyph>
  ),
  idle: () => (
    <Glyph>
      <path d="M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z" />
    </Glyph>
  ),
  fail: () => (
    <Glyph>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
    </Glyph>
  ),
  quest: () => (
    <Glyph>
      <path d="M4 2.5h7.5v11H4a1.5 1.5 0 0 1 0-3h7.5M6 5.5h3.5" />
    </Glyph>
  ),
  deed: () => (
    <Glyph>
      <path d="M3 13 9.5 6.5M8 3.5l4.5 4.5M10 2l4 4-2 2-4-4z" />
    </Glyph>
  ),
  thought: () => <Shared name="thought" />,
  join: () => (
    <Glyph>
      <path d="M9.5 2.5h3v11h-3M2.5 8h7M7 5.5 9.5 8 7 10.5" />
    </Glyph>
  ),
  walk: () => (
    <Glyph>
      <path d="M2.5 13.5c2-1 2.5-4 5.5-4s3.5-3 5.5-6" strokeDasharray="1.5 2" />
    </Glyph>
  ),
  pending: () => (
    <Glyph>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2.4" />
    </Glyph>
  ),
  running: () => (
    <Glyph>
      <path className="spin" d="M8 2.5A5.5 5.5 0 1 1 2.5 8" />
    </Glyph>
  ),
  completed: () => (
    <Glyph>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.3 8.2 1.9 1.9 3.6-4" />
    </Glyph>
  ),
}

export type IconName = keyof typeof Icon
