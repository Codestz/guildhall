/**
 * The chronicle (V1's hud/Chronicle.tsx), fed by props: the story so far, newest on top. Pleas and
 * failures carry a band; ordinary deeds stay quiet. Folded, it is a few toasts over a "Chronicle"
 * button, bottom-left.
 */
import type { CSSProperties, ReactNode } from "react"
import { clock } from "./format.ts"
import { Glyphs, KIND_GLYPH, Pennant } from "./glyphs.tsx"
import { Empty, FoldPanel } from "./parts.tsx"
import type { ChronicleEntry, PartyView, ToastItem } from "./types.ts"

/** The newest this many lines are shown. */
export const CHRONICLE_SHOWN = 12
/** A toast fades over its last this many ms. */
const FADE_MS = 1200

function Banner({ entry, parties }: { entry: ChronicleEntry; parties: readonly PartyView[] }) {
  if (parties.length < 2) return null
  const party = parties.find((p) => p.id === entry.party)
  return party ? <Pennant colour={party.colour} size={13} /> : null
}

function Line({ entry, parties }: { entry: ChronicleEntry; parties: readonly PartyView[] }) {
  return (
    <>
      <Banner entry={entry} parties={parties} />
      {entry.who && (
        <>
          <b style={{ "--banner": entry.banner } as CSSProperties}>{entry.who}</b>{" "}
        </>
      )}
      {entry.text}
    </>
  )
}

export interface ChronicleFeedProps {
  /** The log, oldest first (as it grows). */
  entries: readonly ChronicleEntry[]
  /** Story time now, for the head. */
  time: number
  parties?: readonly PartyView[]
  open: boolean
  onToggle?: () => void
  compact?: boolean
  /** A line was pressed: the hero it is about. */
  onPick?: (hero: string) => void
  /** How a line's time reads (default: session time, `clock`); a history passes dates. */
  when?: (at: number) => string
  /** The head's stamp, in place of `clock(time)`. */
  stamp?: string
  /** Under the list: links onward (the Legends, the card). */
  foot?: ReactNode
  /** The line for an empty log. */
  empty?: string
  className?: string
}

export function ChronicleFeed({
  entries,
  time,
  parties = [],
  open,
  onToggle,
  compact,
  onPick,
  when = clock,
  stamp,
  foot,
  empty = "Nothing written yet. The first deed will appear here.",
  className,
}: ChronicleFeedProps) {
  const shown = entries.slice(-CHRONICLE_SHOWN).reverse()
  return (
    <FoldPanel
      label="Chronicle"
      meta={<span className="num">{stamp ?? clock(time)}</span>}
      open={open}
      onToggle={onToggle}
      compact={compact}
      className={`hud-chronicle${className ? ` ${className}` : ""}`}
    >
      {/* a log: new lines are announced politely, older ones are never re-read */}
      <ol
        className="hud-chron-list"
        role="log"
        aria-label="Recent events, newest first"
        aria-relevant="additions"
      >
        {shown.length === 0 && (
          <li>
            <Empty>{empty}</Empty>
          </li>
        )}
        {shown.map((e) => {
          const Glyph = KIND_GLYPH[e.kind]
          const text = (
            <>
              <span className="hud-chron-glyph">
                <Glyph />
              </span>
              <span className="hud-chron-text">
                <Line entry={e} parties={parties} />
              </span>
              <time className="hud-chron-at num">{when(e.at)}</time>
            </>
          )
          return (
            <li key={e.key} className="hud-chron-item" data-kind={e.kind}>
              {e.hero && onPick ? (
                <button
                  type="button"
                  className="hud-chron-row"
                  onClick={() => e.hero && onPick(e.hero)}
                  aria-label={`${when(e.at)} ${e.who} ${e.text}. Open.`}
                >
                  {text}
                </button>
              ) : (
                <div className="hud-chron-row">{text}</div>
              )}
            </li>
          )
        })}
      </ol>
      {foot && <div className="hud-chron-foot">{foot}</div>}
    </FoldPanel>
  )
}

export interface ToastsProps {
  /** What to show now, oldest first (`pickToasts` chooses them and their time left). */
  items: readonly ToastItem[]
  time: number
  parties?: readonly PartyView[]
  /** The "Chronicle" button: unfold the full feed. */
  onExpand: () => void
  onPick?: (hero: string) => void
  /** Captions already speak these beats: show them, but don't announce them twice. */
  quiet?: boolean
  /** The chip's stamp, in place of `clock(time)`. */
  stamp?: string
  /** The chip's word (default "Chronicle"). */
  label?: string
  /** A short screen: the chip is smaller and drops its stamp, so it takes little of the corner. */
  compact?: boolean
}

/** The chronicle folded away: the last moments that matter, fading on their own. */
export function Toasts({
  items,
  time,
  parties = [],
  onExpand,
  onPick,
  quiet = false,
  stamp,
  label = "Chronicle",
  compact = false,
}: ToastsProps) {
  return (
    <section
      className="hud-toasts"
      aria-label="Latest in the chronicle"
      data-compact={compact ? "" : undefined}
    >
      <ol
        className="hud-toast-list"
        role="log"
        aria-live={quiet ? "off" : "polite"}
        aria-relevant="additions"
      >
        {items.map((entry) => {
          const Glyph = KIND_GLYPH[entry.kind]
          const fade = entry.left === undefined ? 1 : Math.max(0, Math.min(1, entry.left / FADE_MS))
          const body = (
            <>
              <span className="hud-chron-glyph">
                <Glyph />
              </span>
              <span className="hud-toast-text">
                <Line entry={entry} parties={parties} />
              </span>
            </>
          )
          return (
            <li key={entry.key} className="hud-toast" data-kind={entry.kind} style={{ opacity: fade }}>
              {entry.hero && onPick ? (
                <button
                  type="button"
                  className="ui-panel hud-toast-btn"
                  onClick={() => entry.hero && onPick(entry.hero)}
                >
                  {body}
                </button>
              ) : (
                <div className="ui-panel hud-toast-btn">{body}</div>
              )}
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        className="ui-panel hud-chron-open"
        onClick={onExpand}
        aria-label={`Expand the ${label.toLowerCase()}`}
      >
        <Glyphs.quest size={14} />
        <span>{label}</span>
        <span className="num">{stamp ?? clock(time)}</span>
      </button>
    </section>
  )
}
