/**
 * The story's glyphs (V1's hud/icons.tsx, Legends.tsx and Recap.tsx): 1.5 px strokes on a 16-unit grid,
 * in `currentColor`, decorative (every one sits beside a word).
 */
import type { ReactNode } from "react"

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

export const StoryGlyphs = {
  book: glyph(
    <>
      <path d="M8 4.2C6.6 3.2 4.6 2.8 2 3v9.4c2.6-.2 4.6.2 6 1.2 1.4-1 3.4-1.4 6-1.2V3c-2.6-.2-4.6.2-6 1.2z" />
      <path d="M8 4.2v9.4" />
    </>,
  ),
  copy: glyph(
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
    </>,
  ),
  check: glyph(<path d="m3.5 8.5 3 3 6-7" />),
  link: glyph(
    <>
      <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
      <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
    </>,
  ),
  /** A summoning star: a rise, a quest sent. */
  rise: glyph(<path d="M8 2 9.4 6.6 14 8 9.4 9.4 8 14 6.6 9.4 2 8 6.6 6.6zM12.9 1.6v2.6M11.6 2.9h2.6" />),
  /** A card with a picture on it: the Chronicle card. */
  card: glyph(
    <>
      <rect x="1.75" y="3" width="12.5" height="10" rx="1.5" />
      <path d="m2.5 11.5 3.3-3.3 2.4 2.3 1.8-1.7 3.5 3.2" />
      <circle cx="10.6" cy="6.1" r="1.1" />
    </>,
  ),
  download: glyph(<path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 13.5h10" />),
  share: glyph(
    <path d="M8 10V2.5M5 5.2 8 2.3l3 2.9M5.5 7.5H4a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5a1 1 0 0 0-1-1h-1.5" />,
  ),
  /** A copied picture: a card over a card. */
  image: glyph(
    <>
      <rect x="4.5" y="4.5" width="9.5" height="8" rx="1.3" />
      <path d="M11.5 2.5h-8a1.5 1.5 0 0 0-1.5 1.5v6" />
      <path d="m5.2 11.6 2.3-2.3 1.7 1.6 1.3-1.2 2.6 2.3" />
    </>,
  ),
  /** An island on a wave: the README badge links there. */
  island: glyph(
    <>
      <path d="M3 10.5c1-2.6 2.8-4 5-4s4 1.4 5 4" />
      <path d="M8 6.5V3l2.6 1.2L8 5.4" />
      <path d="M1.5 13c1.1 0 1.6-.8 2.7-.8s1.6.8 2.7.8 1.6-.8 2.7-.8 1.6.8 2.7.8 1.1-.4 2.2-.8" />
    </>,
  ),
  prev: glyph(<path d="M10 3.5 5.5 8l4.5 4.5" />),
  next: glyph(<path d="M6 3.5 10.5 8 6 12.5" />),
  /** A ship's sail: the GitHub sea's news. */
  sail: glyph(<path d="M2 10.5h12l-1.8 2.5H3.8zM8 2.5v8M8 3.4c2.6 1 3.6 3.3 3.4 6.1H8" />),
  /** A sprouting seed: a package born. */
  born: glyph(
    <path d="M8 14V8M8 8c0-3 2-4.5 5-4.5 0 3-2 4.5-5 4.5zM8 10c0-2.2-1.5-3.3-4-3.3 0 2.2 1.5 3.3 4 3.3z" />,
  ),
}

/** One small engraved mark per deed of renown (V1 Legends.tsx RENOWN_PATHS). */
export const RENOWN_PATHS: Readonly<Record<string, readonly string[]>> = {
  festival: [
    "M8 1.5v2",
    "M4.8 5.4c0-1.1 1.4-1.9 3.2-1.9s3.2.8 3.2 1.9v4.4c0 1.1-1.4 1.9-3.2 1.9s-3.2-.8-3.2-1.9z",
    "M8 3.5v8.2M4.9 7.6h6.2",
    "M8 11.7v2.8",
  ],
  "ghost-ship": [
    "M2 10.5h12l-1.8 2.5H3.8z",
    "M8 2.5v8",
    "M8 3.4c2.6 1 3.6 3.3 3.4 6.1H8",
    "M8 4.6c-2 .9-2.8 2.7-2.6 4.9H8",
    "M1.5 15c1.2 0 1.2-.7 2.4-.7s1.2.7 2.4.7",
  ],
  rainbow: [
    "M1.8 12a6.2 6.2 0 0 1 12.4 0",
    "M4.4 12a3.6 3.6 0 0 1 7.2 0",
    "M10.5 13.5h3.6a1.5 1.5 0 0 0-.6-2.9 2 2 0 0 0-3.6.6 1.2 1.2 0 0 0 .6 2.3z",
  ],
  raid: ["M4 14.5V1.8", "M4 2.6h8.6l-2 2.7 2 2.7H4", "M6.4 4l2.6 2.4M9 4 6.4 6.4"],
  comet: ["M14 2 7.2 8.8", "M11 1.8 6 6.8", "M14.2 5 9.2 10", "M4.6 13.6a2.3 2.3 0 1 0 0-.01"],
  dragon: [
    "M1.8 13.2C3 8.6 6.6 4.4 14 2.2c-1.3 2.6-1.5 4.8-1 7-1.8-.9-3.4-.6-4.5.7-1.2-1-2.8-.9-4 .3-1 .7-1.9 1.8-2.7 3z",
    "M14 2.2 8.5 10M14 2.2l-9.5 8.2",
  ],
}

export function RenownGlyph({ kind }: { kind: string }) {
  const paths = RENOWN_PATHS[kind] ?? RENOWN_PATHS.comet ?? []
  return (
    <Glyph size={18}>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </Glyph>
  )
}
