/**
 * The HUD's glyphs (V1's hud/icons.tsx and glyphs.ts): 1.5 px strokes on a 16-unit grid, in
 * `currentColor`. Decorative: every one goes with a word, so meaning never rests on the shape alone.
 * The five family marks are new: a hat, a helm, a bow, an axe and a dagger.
 */
import type { CSSProperties, ReactNode } from "react"
import type { EntryKind, Family, ToolState } from "./types.ts"

function Glyph({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="hud-glyph"
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

type G = (props: { size?: number }) => ReactNode

const glyph =
  (body: ReactNode): G =>
  ({ size }) => <Glyph size={size}>{body}</Glyph>

export const Glyphs = {
  plea: glyph(
    <>
      <path d="M8 1.8 14.2 8 8 14.2 1.8 8z" />
      <path d="M8 5v3.6M8 10.8v.1" strokeWidth="1.8" />
    </>,
  ),
  loot: glyph(<path d="M2.5 6.5h11v6.5h-11zM2.5 6.5 4 3.5h8l1.5 3M6.5 9h3" />),
  idle: glyph(<path d="M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z" />),
  fail: glyph(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
    </>,
  ),
  quest: glyph(<path d="M4 2.5h7.5v11H4a1.5 1.5 0 0 1 0-3h7.5M6 5.5h3.5" />),
  deed: glyph(<path d="M3 13 9.5 6.5M8 3.5l4.5 4.5M10 2l4 4-2 2-4-4z" />),
  join: glyph(<path d="M9.5 2.5h3v11h-3M2.5 8h7M7 5.5 9.5 8 7 10.5" />),
  thought: glyph(
    <>
      <path d="M4.5 10.5a3.5 3.5 0 0 1 .4-7 4 4 0 0 1 7 1.4 2.8 2.8 0 0 1-.4 5.6z" />
      <circle cx="4" cy="13.2" r="0.9" />
    </>,
  ),
  work: glyph(<path d="m9.5 2.5 4 4-1.5 1.5-4-4zM8 6 2.5 11.5l2 2L10 8" />),
  crown: glyph(<path d="M2.5 12h11M3 10.5 2 5l3.5 2.5L8 3l2.5 4.5L14 5l-1 5.5z" />),
  eye: glyph(
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>,
  ),
  gear: glyph(
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
      <circle cx="8" cy="8" r="4.3" />
    </>,
  ),
  expand: glyph(<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />),
  collapse: glyph(<path d="M13.5 6.5h-4v-4M9.5 6.5 14 2M2.5 9.5h4v4M6.5 9.5 2 14" />),
  chevron: glyph(<path d="m4 6 4 4 4-4" />),
  /** HUD modes (V1): one pane (minimal), panes (detailed), a closed eye (hidden). */
  minimal: glyph(
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M4.5 5h3" />
    </>,
  ),
  detailed: glyph(
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6 2.5v11M10 2.5v11M7.5 11h1" />
    </>,
  ),
  hidden: glyph(<path d="M2 8s2.4 3.5 6 3.5S14 8 14 8M3.6 10.2 2.5 11.6M12.4 10.2l1.1 1.4M8 11.5V13" />),
  close: glyph(<path d="m4 4 8 8M12 4l-8 8" />),
  menu: glyph(<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />),
  play: glyph(<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />),
  pause: glyph(<path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2.2" />),
  island: glyph(
    <path d="M3 10.5c1-2.6 2.8-4 5-4s4 1.4 5 4M8 6.5V3l2.6 1.2L8 5.4M1.5 13c1.1 0 1.6-.8 2.7-.8s1.6.8 2.7.8 1.6-.8 2.7-.8 1.6.8 2.7.8 1.1-.4 2.2-.8" />,
  ),
  fast: glyph(<path d="M2 4.2v7.6L7.4 8zM8.4 4.2v7.6L13.8 8z" fill="currentColor" strokeWidth="1" />),
  retry: glyph(
    <>
      <path d="M12.8 6.2A5 5 0 1 0 13 9.5" />
      <path d="M13.2 2.8v3.6H9.6" />
    </>,
  ),
  /** A map pin: a place on the island. */
  place: glyph(
    <>
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" />
      <circle cx="8" cy="6.5" r="1.6" />
    </>,
  ),
  /** Years: a calendar leaf. */
  history: glyph(
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>,
  ),
  /** Minutes: an hourglass. */
  session: glyph(
    <path d="M4 2.5h8M4 13.5h8M5 2.5c0 3 6 3.5 6 5.5s-6 2.5-6 5.5M11 2.5c0 3-6 3.5-6 5.5s6 2.5 6 5.5" />,
  ),
  pending: glyph(<circle cx="8" cy="8" r="5.5" strokeDasharray="2 2.4" />),
  running: glyph(<path className="hud-spin" d="M8 2.5A5.5 5.5 0 1 1 2.5 8" />),
  completed: glyph(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.3 8.2 1.9 1.9 3.6-4" />
    </>,
  ),
} satisfies Record<string, G>

/** The guild's crest (V1): a shield with a hall on it. */
export const Crest = ({ size = 22 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M8 1.5 13.5 4v4.2c0 3-2.3 5.3-5.5 6.3-3.2-1-5.5-3.3-5.5-6.3V4z" />
    <path d="M5.2 9.5V7.2L8 5.4l2.8 1.8v2.3" />
    <path d="M6.6 9.5V8.3h2.8v1.2" />
  </Glyph>
)

/** A family's mark, drawn in ink on the banner diamond. Bolder strokes: it is read at 12–20 px. */
export const FAMILY_GLYPH: Readonly<Record<Family, G>> = {
  // a pointed hat with a brim
  mage: glyph(<path d="M8 1.8 11.6 11H4.4zM2.2 11.2c1.6 1.2 3.6 1.7 5.8 1.7s4.2-.5 5.8-1.7M7.4 6.4h2" />),
  // a flat-topped great helm with a T visor
  knight: glyph(<path d="M3.8 2.8h8.4v8l-4.2 3.4-4.2-3.4zM5.4 6.6h5.2M8 6.6v4.6" />),
  // a bow, its string and a nocked arrow
  ranger: glyph(<path d="M5.2 2c4.4 2.2 4.4 9.8 0 12M5.2 2v12M2.4 8h10.4M10.8 6l2 2-2 2" />),
  // a bearded axe on a haft
  barbarian: glyph(<path d="M4 14.2 10.6 3.4M8.6 3.2c1.7-1.5 4.2-1.5 5.6.4-.2 2.3-2 3.9-4.4 4z" />),
  // a dagger: blade, guard, grip
  rogue: glyph(<path d="M13.6 2.4 7.4 8.6l-1-1zM5 7.2l3.8 3.8M6.9 9.1l-4.3 4.3" />),
}

/** A chronicle line's glyph, by kind. */
export const KIND_GLYPH: Readonly<Record<EntryKind, G>> = {
  join: Glyphs.join,
  quest: Glyphs.quest,
  deed: Glyphs.deed,
  fail: Glyphs.fail,
  plea: Glyphs.plea,
  loot: Glyphs.loot,
  thought: Glyphs.thought,
}

export const TOOL_GLYPH: Readonly<Record<ToolState, G>> = {
  pending: Glyphs.pending,
  running: Glyphs.running,
  completed: Glyphs.completed,
  failed: Glyphs.fail,
}

/** A party's banner (V1): a swallowtail pennant on a staff, in the party's colour. */
export function Pennant({ colour, size = 16 }: { colour: string; size?: number }) {
  return (
    <svg
      className="hud-pennant"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ "--banner": colour } as CSSProperties}
    >
      <path d="M3 1.6v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path
        d="M3.7 2.2h9.6l-2.9 3.15 2.9 3.15H3.7z"
        fill="var(--banner)"
        stroke="rgba(12,9,7,0.7)"
        strokeWidth="0.8"
      />
    </svg>
  )
}
