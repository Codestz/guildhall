import { type CSSProperties, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  type Chapter,
  clockOf,
  costOf,
  duration,
  type Legend,
  legendMarkdown,
  legendOf,
  NOTABLE_LABEL,
  type NotableKind,
  tokensOf,
} from "../guild/legends.ts"
import type { GuildStore } from "../guild/store.ts"
import { spell } from "../guild/story.ts"
import { Icon } from "./icons.tsx"

const NOTE_GLYPH: Record<NotableKind, keyof typeof Icon> = {
  plea: "plea",
  flaw: "fail",
  fall: "fail",
  rise: "summon",
}

/**
 * The Legends book (guild/story.ts `legendOf`): the session's story as chapters, on parchment.
 * A modal over the hall: focus starts on the title and stays inside, Esc (or the close button, or a
 * click outside) closes it and the HUD returns focus to the book button. "Copy as text" puts the
 * legend on the clipboard as Markdown — the thing to paste into a PR, a chat, a post.
 *
 * It reads the moment history and the party, so after a seek it still tells the story so far. It
 * rebuilds at most once a second of story time (the HUD re-renders it ~10×/s while open).
 */
export function Legends({ store, onClose }: { store: GuildStore; onClose: () => void }) {
  const head = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")
  const history = store.moments.history
  const second = Math.floor(store.time / 1000)
  const status = store.views.map((v) => v.phase).join()

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt when the story moves, not per render
  const legend = useMemo(
    () => legendOf(store.moments.history, store.party()),
    [store, store.moments.epoch, history.length, second, status],
  )

  useEffect(() => {
    head.current?.focus()
  }, [])

  useEffect(() => {
    if (copied === "idle") return
    const timer = setTimeout(() => setCopied("idle"), 2400)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    if (!legend) return
    const text = legendMarkdown(legend)
    try {
      await navigator.clipboard.writeText(text)
      setCopied("done")
    } catch {
      setCopied(fallbackCopy(text) ? "done" : "failed")
    }
  }

  /** Keep Tab inside the book while it is open. */
  function trap(event: KeyboardEvent) {
    if (event.key !== "Tab" || !panel.current) return
    const stops = [...panel.current.querySelectorAll<HTMLElement>("button, [href], [tabindex='0']")].filter(
      (el) => !el.hasAttribute("disabled"),
    )
    const first = stops[0]
    const last = stops.at(-1)
    if (!first || !last) return
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === head.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim's click is a mouse shortcut; Esc and the close button are the keyboard's
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className="legends-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <article
        ref={panel}
        className="legends"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legends-h"
        onKeyDown={trap}
      >
        <header className="legends-head">
          <div className="legends-titles">
            <p className="legends-eyebrow">{legend ? "The Legend of" : "Legends"}</p>
            <h2 id="legends-h" ref={head} tabIndex={-1}>
              {legend ? legend.title : "No legend yet"}
            </h2>
            {legend && <p className="legends-meta">{metaOf(legend)}</p>}
          </div>
          <div className="legends-tools">
            <button
              type="button"
              className="legends-copy"
              onClick={copy}
              disabled={!legend}
              aria-describedby="legends-copy-note"
            >
              {copied === "done" ? <Icon.check /> : <Icon.copy />}
              <span>
                {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy as text"}
              </span>
            </button>
            <span id="legends-copy-note" className="visually-hidden">
              Copies the legend as Markdown
            </span>
            <button
              type="button"
              className="legends-close"
              onClick={onClose}
              aria-label="Close the book (Esc)"
            >
              <Icon.close />
            </button>
          </div>
        </header>
        <span className="visually-hidden" aria-live="polite">
          {copied === "done" ? "Legend copied as Markdown" : copied === "failed" ? "Could not copy" : ""}
        </span>

        <div className="legends-body">
          {!legend ? (
            <p className="legends-empty">
              When the guildmaster takes up a quest, its story is written here, chapter by chapter.
            </p>
          ) : (
            <>
              <p className="legends-opening">{legend.opening}</p>
              <ol className="chapters">
                {legend.chapters.map((chapter) => (
                  <ChapterView key={`${chapter.numeral}-${chapter.id}`} chapter={chapter} />
                ))}
              </ol>
              <footer className="legends-end">
                <span className="fleuron" aria-hidden="true">
                  ❦
                </span>
                {legend.lastWord && (
                  <blockquote className="last-word">
                    <p>{legend.lastWord}</p>
                    <cite>The Guildmaster’s last word</cite>
                  </blockquote>
                )}
                <p className="legends-closing">{legend.closing}</p>
              </footer>
            </>
          )}
        </div>
      </article>
    </div>
  )
}

function ChapterView({ chapter: c }: { chapter: Chapter }) {
  const facts = [
    c.sentBy ? `${c.resumed ? "Called back by" : "Sent by"} the ${c.sentBy}` : "At the quest board",
    c.end !== undefined
      ? `${clockOf(c.begin)}–${clockOf(c.end)} · ${duration(c.end - c.begin)}`
      : `from ${clockOf(c.begin)}`,
    c.tokens
      ? `${tokensOf(c.tokens)}${c.cost ? ` · ${costOf(c.cost)}` : ""}${c.usageNote ? ` ${c.usageNote}` : ""}`
      : "",
  ].filter(Boolean)
  return (
    <li className="chapter" data-outcome={c.outcome}>
      <header className="ch-head">
        <span className="ch-num" aria-hidden="true">
          {c.numeral}
        </span>
        <div className="ch-titles">
          <h3>
            <span className="visually-hidden">Chapter {c.numeral}: </span>
            <i className="ch-pip" style={{ "--role": c.color } as CSSProperties} aria-hidden="true" />
            The {c.who}
            {c.outcome !== "done" && (
              <span className="ch-state">{c.outcome === "fallen" ? "Fallen" : "At work"}</span>
            )}
          </h3>
          <p className="ch-quest">{c.sentBy ? <q>{c.quest}</q> : "Their own hand on the quest"}</p>
        </div>
      </header>
      <p className="ch-meta">{facts.join(" · ")}</p>
      {c.deeds.length > 0 && (
        <p className="ch-deeds">
          <span className="ch-label">Deeds</span> {c.deeds.map((d) => d.label).join(" · ")}
        </p>
      )}
      {c.notables.length > 0 && (
        <ul className="ch-notes">
          {c.notables.map((n) => {
            const Glyph = Icon[NOTE_GLYPH[n.kind]]
            return (
              <li key={`${n.kind}-${n.at}`} data-kind={n.kind}>
                <Glyph />
                <span>
                  <b>{NOTABLE_LABEL[n.kind]}</b> <span className="ch-at">{clockOf(n.at)}</span> {n.text}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {c.loot && (
        <blockquote className="ch-loot">
          <span className="ch-label">Loot</span>
          <p>{c.loot}</p>
        </blockquote>
      )}
    </li>
  )
}

function metaOf(legend: Legend): string {
  return [
    `A party of ${spell(legend.party)}`,
    duration(legend.span),
    ...(legend.tokens > 0 ? [tokensOf(legend.tokens)] : []),
    ...(legend.cost > 0 ? [costOf(legend.cost)] : []),
    legend.outcome === "complete" ? "Complete" : legend.outcome === "lost" ? "Lost" : "Underway",
  ].join(" · ")
}

/** For browsers that refuse the async clipboard (an insecure origin, an old WebView). */
function fallbackCopy(text: string): boolean {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
