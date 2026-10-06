import { type CSSProperties, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { EVENT_KINDS, type EventKind, worldEventsOf } from "../guild/events.ts"
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
import { Pennant } from "./Parties.tsx"

const NOTE_GLYPH: Record<NotableKind, keyof typeof Icon> = {
  plea: "plea",
  flaw: "fail",
  fall: "fail",
  rise: "summon",
  renown: "crown",
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
  // One book per party: the followed one first, else the newest. A chooser when there are several.
  const parties = store.parties
  const [chosen, setChosen] = useState<string | undefined>(() => store.focalParty?.id)
  const book = parties.find((p) => p.id === chosen) ?? store.focalParty
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  // Shows the probe hook forced (dev / probe builds only; empty otherwise).
  const forced = worldEventsOf(store).forced
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt when the story moves, not per render
  const legend = useMemo(
    () => legendOf(store.moments.history, store.party(book?.id), forced),
    [store, store.moments.epoch, history.length, second, status, forced.length, book?.id],
  )

  /** Tabs: arrows move between the books (and open the one reached), Home and End jump. */
  function onTabKey(event: KeyboardEvent, index: number) {
    const last = parties.length - 1
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1
    if (next < 0) return
    event.preventDefault()
    setChosen(parties[next]?.id)
    tabs.current[next]?.focus()
  }

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
        {parties.length > 1 && (
          <div className="legends-books" role="tablist" aria-label="One book per party">
            {parties.map((party, i) => {
              const selected = party.id === book?.id
              return (
                <button
                  key={party.id}
                  ref={(el) => {
                    tabs.current[i] = el
                  }}
                  type="button"
                  role="tab"
                  id={`legends-tab-${i}`}
                  aria-selected={selected}
                  aria-controls="legends-body"
                  tabIndex={selected ? 0 : -1}
                  className="legends-book"
                  onClick={() => setChosen(party.id)}
                  onKeyDown={(event) => onTabKey(event, i)}
                >
                  <Pennant color={party.color} size={15} />
                  <span>{party.name}</span>
                </button>
              )
            })}
          </div>
        )}
        <span className="visually-hidden" aria-live="polite">
          {copied === "done" ? "Legend copied as Markdown" : copied === "failed" ? "Could not copy" : ""}
        </span>

        <div
          className="legends-body"
          id="legends-body"
          {...(parties.length > 1
            ? {
                role: "tabpanel",
                "aria-labelledby": `legends-tab-${Math.max(0, parties.indexOf(book as (typeof parties)[number]))}`,
              }
            : {})}
        >
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
              <RenownList legend={legend} />
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

/**
 * Deeds of Renown (guild/events.ts): the secret world events this session has earned, as wax seals,
 * and a cryptic hint for each one still unsung — something to hunt for.
 */
function RenownList({ legend }: { legend: Legend }) {
  const kinds = new Set(legend.renown.filter((r) => !r.forced).map((r) => r.kind)).size
  return (
    <section className="renown" aria-labelledby="renown-h">
      <h3 id="renown-h" className="renown-h">
        <span>Deeds of Renown</span>
        <span className="renown-tally">
          {kinds} of {EVENT_KINDS.length}
        </span>
      </h3>
      <ul className="renown-list">
        {legend.renown.map((r) => (
          <li key={r.id} className="renown-deed" data-kind={r.kind} data-earned="true">
            <span className="renown-seal" aria-hidden="true">
              <RenownGlyph kind={r.kind} />
            </span>
            <div className="renown-words">
              <p className="renown-name">
                {r.title}
                {r.count > 1 && <span className="renown-count">×{r.count}</span>}
                {r.forced && <span className="renown-forced">forced</span>}
              </p>
              <p className="renown-text">{r.text}</p>
            </div>
          </li>
        ))}
        {legend.unsung.map((u) => (
          <li key={u.kind} className="renown-deed" data-kind={u.kind} data-earned="false">
            <span className="renown-seal" aria-hidden="true">
              ?
            </span>
            <div className="renown-words">
              <p className="renown-name">
                <span className="visually-hidden">Not yet earned: </span>Unsung
              </p>
              <p className="renown-text">{u.hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One small engraved mark per deed of renown (1.5px strokes on a 16px grid, like hud/icons.tsx). */
function RenownGlyph({ kind }: { kind: EventKind }) {
  return (
    <svg
      className="glyph"
      width={18}
      height={18}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {RENOWN_PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

const RENOWN_PATHS: Record<EventKind, readonly string[]> = {
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
