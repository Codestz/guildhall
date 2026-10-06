import type { CSSProperties } from "react"
import type { GuildStore } from "../guild/store.ts"
import { clock, LOG_TONE } from "./format.ts"
import { Icon } from "./icons.tsx"
import { Panel } from "./parts.tsx"

const SHOWN = 10

/** The story so far, newest on top. Pleas and failures carry a band; ordinary deeds stay quiet. */
export function Chronicle({
  store,
  open,
  onToggle,
  className,
}: {
  store: GuildStore
  open: boolean
  onToggle: () => void
  className?: string
}) {
  const entries = store.log.slice(-SHOWN).reverse()

  return (
    <Panel
      label="Chronicle"
      meta={<span className="mono">{clock(store.time)}</span>}
      open={open}
      onToggle={onToggle}
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
