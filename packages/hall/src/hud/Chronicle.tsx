import { type CSSProperties, useRef } from "react"
import type { GuildStore, LogEntry } from "../guild/store.ts"
import { clock, LOG_TONE } from "./format.ts"
import { Icon } from "./icons.tsx"
import { Panel } from "./parts.tsx"

const SHOWN = 10

/** The story so far, newest on top. Pleas and failures carry a band; ordinary deeds stay quiet. */
export function Chronicle({
  store,
  open,
  onToggle,
  compact = false,
  className,
}: {
  store: GuildStore
  open: boolean
  onToggle: () => void
  /** Collapsing returns to the compact form (badges / toasts). */
  compact?: boolean
  className?: string
}) {
  const entries = store.log.slice(-SHOWN).reverse()

  return (
    <Panel
      label="Chronicle"
      meta={<span className="mono">{clock(store.time)}</span>}
      open={open}
      onToggle={onToggle}
      compact={compact}
      className={`chronicle ${className ?? ""}`}
    >
      {entries.length === 0 ? (
        <p className="empty">Nothing written yet. The first deed will appear here.</p>
      ) : (
        <ol className="chron-list" aria-label="Recent events, newest first">
          {entries.map((e) => {
            const tone = LOG_TONE[e.kind]
            const Glyph = Icon[tone]
            return (
              <li key={e.key} className="chron-item" data-kind={e.kind}>
                <button
                  type="button"
                  className="chron-row"
                  onClick={() => store.select(e.id)}
                  aria-label={`${clock(e.at)} ${e.title} ${e.text}. Open dossier.`}
                >
                  <span className="chron-glyph">
                    <Glyph />
                  </span>
                  <span className="chron-text">
                    <b style={{ "--role": e.color } as CSSProperties}>{e.title}</b> {e.text}
                  </span>
                  <time className="chron-at mono">{clock(e.at)}</time>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}

/** What earns a toast, and for how long (real ms). Ordinary deeds and thoughts stay on the chips. */
const LIFE: Partial<Record<LogEntry["kind"], number>> = {
  join: 5000,
  quest: 6000,
  loot: 6000,
  fail: 11_000,
  plea: 11_000,
}
const TOASTS = 3
const FADE = 1200

/**
 * The chronicle folded away: the last few moments that matter, fading on their own. Lifetimes run
 * on the viewer's clock (not story time), so a paused story still clears its toasts.
 */
export function Toasts({
  store,
  onExpand,
  quiet = false,
}: {
  store: GuildStore
  onExpand: () => void
  /** Story captions are speaking these beats already: show the toasts, don't announce them twice. */
  quiet?: boolean
}) {
  const seen = useRef(new Map<string, number>())
  const now = performance.now()
  const shown: { entry: LogEntry; left: number }[] = []

  for (let i = store.log.length - 1; i >= 0 && shown.length < TOASTS; i--) {
    const entry = store.log[i]
    if (!entry) continue
    const life = LIFE[entry.kind]
    if (!life) continue
    // Keys restart with each story or seek; the moment itself (when, who, what) does not.
    const id = `${entry.at}:${entry.id}:${entry.kind}:${entry.text}`
    let first = seen.current.get(id)
    if (first === undefined) {
      first = now
      seen.current.set(id, now)
    }
    const left = life - (now - first)
    if (left > 0) shown.push({ entry, left })
  }
  // Forget the oldest once the map outgrows the log.
  if (seen.current.size > 200) seen.current = new Map([...seen.current].slice(-100))

  return (
    <section className="toasts" aria-label="Latest in the chronicle">
      <ol className="toast-list" aria-live={quiet ? "off" : "polite"} aria-relevant="additions">
        {shown.reverse().map(({ entry, left }) => {
          const tone = LOG_TONE[entry.kind]
          const Glyph = Icon[tone]
          return (
            <li
              key={entry.key}
              className="toast"
              data-kind={entry.kind}
              style={{ opacity: Math.min(1, left / FADE) }}
            >
              <button type="button" className="plaque toast-btn" onClick={() => store.select(entry.id)}>
                <span className="chron-glyph">
                  <Glyph />
                </span>
                <span className="toast-text">
                  <b style={{ "--role": entry.color } as CSSProperties}>{entry.title}</b> {entry.text}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        className="plaque chron-open"
        onClick={onExpand}
        aria-label="Expand the chronicle"
      >
        <Icon.quest />
        <span>Chronicle</span>
        <span className="mono faint">{clock(store.time)}</span>
      </button>
    </section>
  )
}
