/**
 * The sketch hall's notice (sketch.ts): a small card under the top row, in the HUD's ink and brass,
 * saying the island is a sketch and offering the one way to the real one. It never blocks the island:
 * it folds away (✕, remembered for the repo), and gives way while a panel or a phone's menu is open.
 */
import { openRequestFor, type RequestResult } from "@guildhall/sim"
import { Glyphs } from "@guildhall/ui"
import { useEffect, useState } from "react"
import { dismiss, type SketchNotice as Notice, noticeWords, wasDismissed } from "./sketch.ts"

/** One search per repo while the page lives (GitHub allows ten a minute without a token). */
const asked = new Map<string, Promise<RequestResult>>()
function openRequest(slug: string): Promise<RequestResult> {
  const key = slug.toLowerCase()
  let ask = asked.get(key)
  if (!ask) {
    const [owner = "", repo = ""] = slug.split("/")
    ask = openRequestFor(owner, repo, { timeoutMs: 6000 })
    asked.set(key, ask)
  }
  return ask
}

export interface SketchNoticeProps {
  notice: Notice
  /** Out of the way for now (a panel, a phone's menu open): not drawn, not dismissed. */
  away: boolean
  onRetry?: () => void
}

export function SketchNotice({ notice, away, onRetry }: SketchNoticeProps) {
  const [gone, setGone] = useState(() => notice.kind === "not-chronicled" && wasDismissed(notice.slug))
  const [pending, setPending] = useState<RequestResult | null>(null)
  // asked already? a public search, failing soft into the plain notice
  useEffect(() => {
    if (notice.kind !== "not-chronicled" || gone) return
    let live = true
    void openRequest(notice.slug).then((r) => live && setPending(r))
    return () => {
      live = false
    }
  }, [notice, gone])
  if (gone || away) return null
  const words = noticeWords(notice, pending)
  const close = () => {
    if (notice.kind === "not-chronicled") dismiss(notice.slug)
    setGone(true)
  }
  const { action } = words
  return (
    <section className="ui-panel hall-sketch" aria-label={words.title} data-kind={notice.kind}>
      <header className="hall-sketch-head">
        <i
          className="hud-source-dot"
          data-tone={pending?.status === "open" ? "history" : "sketch"}
          aria-hidden="true"
        />
        <h2 className="hall-sketch-title">{words.title}</h2>
        <button type="button" className="ui-icon-btn hall-sketch-close" aria-label="Dismiss" onClick={close}>
          <Glyphs.close size={14} />
        </button>
      </header>
      <p className="hall-sketch-body">{words.body}</p>
      <div className="hall-sketch-act">
        {"href" in action ? (
          <a
            className="ui-btn"
            data-variant={pending?.status === "open" ? "outline" : "primary"}
            data-size="sm"
            href={action.href}
            target="_blank"
            rel="noreferrer"
          >
            {action.label}
            <span className="ui-visually-hidden"> (opens GitHub in a new tab)</span>
          </a>
        ) : (
          onRetry && (
            <button type="button" className="ui-btn" data-variant="primary" data-size="sm" onClick={onRetry}>
              <Glyphs.retry size={14} />
              {action.label}
            </button>
          )
        )}
        {words.foot && <small className="hall-sketch-foot">{words.foot}</small>}
      </div>
    </section>
  )
}
