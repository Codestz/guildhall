/**
 * The Legends book (V1's hud/Legends.tsx), fed by props: the session's story as chapters on parchment
 * (sim `legendOf`), and, when given, the repo's History: its past sessions and milestones. A modal:
 * focus starts on the title and stays inside, Esc (the close button, a click on the scrim) closes it
 * and focus goes back to whatever opened it. ← and → turn the page: chapter to chapter (a year to the
 * next in History), Home and End to the first and last; the footer's buttons too. "Copy as text" puts the sim's Markdown on the clipboard.
 */
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react"
import { Glyphs } from "../glyphs.tsx"
import { copyText } from "./clipboard.ts"
import { trapTab, useModalFocus } from "./focus.ts"
import { RenownGlyph, StoryGlyphs } from "./glyphs.tsx"
import type { LegendChapter, LegendView, Milestone, NotableKind, PastSession, RepoHistory } from "./types.ts"
import { clockOf, costOf, dayOf, duration, isoDay, spell, tokensOf, yearOf } from "./words.ts"

export type BookView = "session" | "history"

export interface LegendsBookProps {
  /** This session's book; undefined before the guildmaster has a quest. */
  legend?: LegendView
  /** The legend as Markdown (sim `legendMarkdown`), for "Copy as text"; no button without it. */
  markdown?: string
  /** The repo's past sessions and milestones: a History tab when given. */
  history?: RepoHistory
  /** Which book opens. */
  view?: BookView
  /** Opens the Chronicle card (the sharing picture); no button without it. */
  onCard?: () => void
  /** Opens a past session's own book, from History. */
  onSession?: (id: string) => void
  onClose: () => void
}

const NOTE_LABEL: Record<NotableKind, string> = {
  plea: "Plea",
  flaw: "Failure",
  fall: "Fall",
  rise: "Rise",
  renown: "Renown",
}

const NOTE_GLYPH: Record<NotableKind, (p: { size?: number }) => React.ReactNode> = {
  plea: Glyphs.plea,
  flaw: Glyphs.fail,
  fall: Glyphs.fail,
  rise: StoryGlyphs.rise,
  renown: Glyphs.crown,
}

const OUTCOME: Record<LegendView["outcome"], string> = {
  complete: "Complete",
  lost: "Lost",
  underway: "Underway",
}

/** A page of the book: what the footer names, and where it starts. */
interface Page {
  id: string
  label: string
}

export function LegendsBook({
  legend,
  markdown,
  history,
  view: initial = "session",
  onCard,
  onSession,
  onClose,
}: LegendsBookProps) {
  const id = useId()
  const head = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  /** Until when a turn's own scroll is under way: the page it turned to stands, whatever passes by. */
  const turning = useRef(0)
  const [view, setView] = useState<BookView>(history ? initial : "session")
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")
  const [page, setPage] = useState(0)
  const [said, setSaid] = useState("")
  useModalFocus(head)

  const pages = useMemo<Page[]>(() => {
    if (view === "history")
      return history ? yearsOf(history).map(([year]) => ({ id: `y${year}`, label: String(year) })) : []
    if (!legend) return []
    return [
      ...legend.chapters.map((c) => ({ id: `c${c.numeral}`, label: `Chapter ${c.numeral} · The ${c.who}` })),
      { id: "renown", label: "Deeds of Renown" },
      { id: "end", label: "The end" },
    ]
  }, [view, legend, history])

  useEffect(() => {
    if (copied === "idle") return
    const timer = setTimeout(() => setCopied("idle"), 2400)
    return () => clearTimeout(timer)
  }, [copied])

  // A new view starts on its first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a view change only
  useEffect(() => {
    setPage(0)
    body.current?.scrollTo({ top: 0 })
  }, [view])

  /** The page whose top has scrolled past the body's top: the one being read. */
  function track() {
    const el = body.current
    if (!el || performance.now() < turning.current) return
    const top = el.getBoundingClientRect().top
    let at = 0
    pages.forEach((p, i) => {
      const node = el.querySelector<HTMLElement>(`[data-page="${p.id}"]`)
      if (node && node.getBoundingClientRect().top - top <= 48) at = i
    })
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) at = pages.length - 1
    setPage(Math.max(0, at))
  }

  function turn(to: number) {
    const el = body.current
    const target = pages[to]
    if (!el || !target) return
    const node = el.querySelector<HTMLElement>(`[data-page="${target.id}"]`)
    if (!node) return
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12
    // held until the scroll ends (or a long smooth scroll's worth of time, where `scrollend` is missing)
    turning.current = performance.now() + (still ? 50 : 1600)
    el.scrollTo({ top, behavior: still ? "auto" : "smooth" })
    node.querySelector<HTMLElement>("[data-page-head]")?.focus({ preventScroll: true })
    setPage(to)
    setSaid(`${target.label}, page ${to + 1} of ${pages.length}`)
  }

  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation()
      onClose()
      return
    }
    if (panel.current) trapTab(event, panel.current)
    const target = event.target as HTMLElement
    if (target.closest('[role="tablist"], input, textarea, select')) return
    if (event.key === "ArrowRight" && page < pages.length - 1) {
      event.preventDefault()
      turn(page + 1)
    } else if (event.key === "ArrowLeft" && page > 0) {
      event.preventDefault()
      turn(page - 1)
    } else if ((event.key === "Home" || event.key === "End") && pages.length > 1) {
      event.preventDefault()
      turn(event.key === "Home" ? 0 : pages.length - 1)
    }
  }

  /** Tabs: ← → move between the books (and open the one reached), Home and End jump. */
  function onTabKey(event: KeyboardEvent, index: number) {
    const order: BookView[] = ["session", "history"]
    const next =
      event.key === "ArrowRight" || event.key === "ArrowLeft"
        ? 1 - index
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? 1
            : -1
    if (next < 0) return
    event.preventDefault()
    setView(order[next] as BookView)
    tabs.current[next]?.focus()
  }

  async function copy() {
    if (!markdown) return
    setCopied((await copyText(markdown)) ? "done" : "failed")
  }

  const reading = view === "history" && history
  const title = reading ? history.repo : legend ? legend.title : "No legend yet"
  const eyebrow = reading ? "The Chronicle of" : legend ? "The Legend of" : "Legends"
  const meta = reading ? historyMeta(history) : legend ? metaOf(legend) : undefined
  const current = pages[page]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim's click is a mouse shortcut; Esc and the close button are the keyboard's
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className="st-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <article
        ref={panel}
        className="st-book"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        onKeyDown={onKey}
      >
        <header className="st-book-head">
          <div className="st-book-titles">
            <p className="st-book-eyebrow">{eyebrow}</p>
            <h2 id={`${id}-h`} ref={head} tabIndex={-1}>
              {title}
            </h2>
            {meta && <p className="st-book-meta">{meta}</p>}
          </div>
          <div className="st-book-tools">
            {onCard && (
              <button
                type="button"
                className="st-book-btn"
                onClick={onCard}
                disabled={!legend}
                aria-haspopup="dialog"
                title="A picture of this session to share"
              >
                <StoryGlyphs.card />
                <span>Chronicle card</span>
              </button>
            )}
            {markdown !== undefined && (
              <button
                type="button"
                className="st-book-btn"
                onClick={copy}
                disabled={!legend}
                aria-describedby={`${id}-copy`}
              >
                {copied === "done" ? <StoryGlyphs.check /> : <StoryGlyphs.copy />}
                <span>
                  {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy as text"}
                </span>
              </button>
            )}
            <span id={`${id}-copy`} className="ui-visually-hidden">
              Copies the legend as Markdown
            </span>
            <button
              type="button"
              className="st-book-close"
              onClick={onClose}
              aria-label="Close the book (Esc)"
            >
              <Glyphs.close />
            </button>
          </div>
        </header>

        {history && (
          <div className="st-book-tabs" role="tablist" aria-label="Which book">
            {(["session", "history"] as const).map((v, i) => (
              <button
                key={v}
                ref={(el) => {
                  tabs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${v}`}
                aria-selected={view === v}
                aria-controls={`${id}-body`}
                tabIndex={view === v ? 0 : -1}
                className="st-book-tab"
                onClick={() => setView(v)}
                onKeyDown={(event) => onTabKey(event, i)}
              >
                {v === "session" ? <StoryGlyphs.book /> : <Glyphs.history />}
                <span>{v === "session" ? "This session" : "History"}</span>
              </button>
            ))}
          </div>
        )}

        <div
          ref={body}
          className="st-book-body"
          id={`${id}-body`}
          onScroll={() => requestAnimationFrame(track)}
          onScrollEnd={() => {
            turning.current = 0
          }}
          // A stop of its own (it scrolls): a tab panel, or a labelled region.
          {...(history
            ? { role: "tabpanel", "aria-labelledby": `${id}-tab-${view}` }
            : { role: "region", "aria-labelledby": `${id}-h` })}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
          tabIndex={0}
        >
          {reading ? (
            <HistoryPages history={history} onSession={onSession} />
          ) : !legend ? (
            <p className="st-book-empty">
              When the guildmaster takes up a quest, its story is written here, chapter by chapter.
            </p>
          ) : (
            <>
              <p className="st-book-opening">{legend.opening}</p>
              <ol className="st-chapters">
                {legend.chapters.map((chapter) => (
                  <ChapterPage key={`${chapter.numeral}-${chapter.id}`} chapter={chapter} />
                ))}
              </ol>
              <RenownPage legend={legend} />
              <footer className="st-book-end" data-page="end">
                <span className="st-fleuron" aria-hidden="true">
                  ❦
                </span>
                <h3 className="ui-visually-hidden" data-page-head tabIndex={-1}>
                  The end
                </h3>
                {legend.lastWord && (
                  <blockquote className="st-last-word">
                    <p>{legend.lastWord}</p>
                    <cite>The Guildmaster’s last word</cite>
                  </blockquote>
                )}
                <p className="st-book-closing">{legend.closing}</p>
                {onCard && legend.outcome === "complete" && (
                  <button
                    type="button"
                    className="st-book-btn st-book-btn-end"
                    onClick={onCard}
                    aria-haspopup="dialog"
                  >
                    <StoryGlyphs.card />
                    <span>Make the Chronicle card</span>
                  </button>
                )}
              </footer>
            </>
          )}
        </div>

        {pages.length > 1 && (
          <nav className="st-book-foot" aria-label="Pages">
            <button
              type="button"
              className="st-page-btn"
              onClick={() => page > 0 && turn(page - 1)}
              // aria-disabled, not disabled: a focused button that turns disabled drops focus out of the dialog
              aria-disabled={page === 0}
              aria-label="Previous page (←)"
            >
              <StoryGlyphs.prev />
            </button>
            <p className="st-page-label">
              <span className="st-page-name">{current?.label}</span>
              <span className="st-page-count">
                {page + 1} of {pages.length}
              </span>
            </p>
            <button
              type="button"
              className="st-page-btn"
              onClick={() => page < pages.length - 1 && turn(page + 1)}
              aria-disabled={page === pages.length - 1}
              aria-label="Next page (→)"
            >
              <StoryGlyphs.next />
            </button>
          </nav>
        )}
        <span className="ui-visually-hidden" aria-live="polite">
          {copied === "done" ? "Legend copied as Markdown" : copied === "failed" ? "Could not copy" : said}
        </span>
      </article>
    </div>
  )
}

function ChapterPage({ chapter: c }: { chapter: LegendChapter }) {
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
    <li className="st-chapter" data-outcome={c.outcome} data-page={`c${c.numeral}`}>
      <header className="st-ch-head">
        <span className="st-ch-num" aria-hidden="true">
          {c.numeral}
        </span>
        <div className="st-ch-titles">
          <h3 data-page-head tabIndex={-1}>
            <span className="ui-visually-hidden">Chapter {c.numeral}: </span>
            <i className="st-ch-pip" style={{ "--role": c.color } as CSSProperties} aria-hidden="true" />
            The {c.who}
            {c.outcome !== "done" && (
              <span className="st-ch-state">{c.outcome === "fallen" ? "Fallen" : "At work"}</span>
            )}
          </h3>
          <p className="st-ch-quest">{c.sentBy ? <q>{c.quest}</q> : "Their own hand on the quest"}</p>
        </div>
      </header>
      <p className="st-ch-meta">{facts.join(" · ")}</p>
      {c.deeds.length > 0 && (
        <p className="st-ch-deeds">
          <span className="st-ch-label">Deeds</span> {c.deeds.map((d) => d.label).join(" · ")}
        </p>
      )}
      {c.notables.length > 0 && (
        <ul className="st-ch-notes">
          {c.notables.map((n) => {
            const Glyph = NOTE_GLYPH[n.kind]
            return (
              <li key={`${n.kind}-${n.at}-${n.text}`} data-kind={n.kind}>
                <Glyph />
                <span>
                  <b>{NOTE_LABEL[n.kind]}</b> <span className="st-ch-at">{clockOf(n.at)}</span> {n.text}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {c.loot && (
        <blockquote className="st-ch-loot">
          <span className="st-ch-label">Loot</span>
          <p>{c.loot}</p>
        </blockquote>
      )}
    </li>
  )
}

/** Deeds of Renown: wax seals for the world events earned, a cryptic hint for each one still unsung. */
function RenownPage({ legend }: { legend: LegendView }) {
  const earned = new Set(legend.renown.filter((r) => !r.forced).map((r) => r.kind)).size
  const total = new Set(legend.renown.map((r) => r.kind)).size + legend.unsung.length
  return (
    <section className="st-renown" data-page="renown" aria-label="Deeds of Renown">
      <h3 className="st-renown-h" data-page-head tabIndex={-1}>
        <span>Deeds of Renown</span>
        <span className="st-renown-tally">
          {earned} of {total}
        </span>
      </h3>
      <ul className="st-renown-list">
        {legend.renown.map((r) => (
          <li key={r.id} className="st-renown-deed" data-kind={r.kind} data-earned="true">
            <span className="st-renown-seal" aria-hidden="true">
              <RenownGlyph kind={r.kind} />
            </span>
            <div className="st-renown-words">
              <p className="st-renown-name">
                {r.title}
                {r.count > 1 && <span className="st-renown-count">×{r.count}</span>}
                {r.forced && <span className="st-renown-forced">forced</span>}
              </p>
              <p className="st-renown-text">{r.text}</p>
            </div>
          </li>
        ))}
        {legend.unsung.map((u) => (
          <li key={u.kind} className="st-renown-deed" data-kind={u.kind} data-earned="false">
            <span className="st-renown-seal" aria-hidden="true">
              ?
            </span>
            <div className="st-renown-words">
              <p className="st-renown-name">
                <span className="ui-visually-hidden">Not yet earned: </span>Unsung
              </p>
              <p className="st-renown-text">{u.hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

type Entry =
  | { kind: "session"; at: number; session: PastSession }
  | { kind: "milestone"; at: number; milestone: Milestone }

/** History's years, oldest first, each with its sessions and milestones in date order. */
function yearsOf(history: RepoHistory): [number, Entry[]][] {
  const entries: Entry[] = [
    ...history.sessions.map((session) => ({ kind: "session" as const, at: session.at, session })),
    ...history.milestones.map((milestone) => ({ kind: "milestone" as const, at: milestone.at, milestone })),
  ].sort((a, b) => a.at - b.at)
  const years = new Map<number, Entry[]>()
  for (const e of entries) {
    const list = years.get(yearOf(e.at)) ?? []
    list.push(e)
    years.set(yearOf(e.at), list)
  }
  return [...years]
}

const MILESTONE_GLYPH: Record<Milestone["kind"], (p: { size?: number }) => React.ReactNode> = {
  born: StoryGlyphs.born,
  release: StoryGlyphs.sail,
  merge: StoryGlyphs.sail,
  renown: Glyphs.crown,
}

const MILESTONE_LABEL: Record<Milestone["kind"], string> = {
  born: "Born",
  release: "Release",
  merge: "Merged",
  renown: "Renown",
}

function HistoryPages({ history, onSession }: { history: RepoHistory; onSession?: (id: string) => void }) {
  const years = yearsOf(history)
  if (years.length === 0)
    return (
      <p className="st-book-empty">
        No history yet: the chronicle of this repo is written as the guild works on it.
      </p>
    )
  return (
    <ol className="st-years">
      {years.map(([year, entries]) => (
        <li key={year} className="st-year" data-page={`y${year}`}>
          <h3 className="st-year-h" data-page-head tabIndex={-1}>
            {year}
          </h3>
          <ol className="st-annals">
            {entries.map((e) =>
              e.kind === "milestone" ? (
                <MilestoneLine key={`m${e.at}-${e.milestone.title}`} milestone={e.milestone} />
              ) : (
                <SessionLine key={`s${e.session.id}`} session={e.session} onSession={onSession} />
              ),
            )}
          </ol>
        </li>
      ))}
    </ol>
  )
}

function MilestoneLine({ milestone: m }: { milestone: Milestone }) {
  const Glyph = MILESTONE_GLYPH[m.kind]
  return (
    <li className="st-annal" data-kind={m.kind}>
      <time className="st-annal-day" dateTime={isoDay(m.at)}>
        {dayOf(m.at)}
      </time>
      <span className="st-annal-mark" aria-hidden="true">
        <Glyph />
      </span>
      <div className="st-annal-words">
        <p className="st-annal-title">
          <b>{MILESTONE_LABEL[m.kind]}</b> {m.title}
        </p>
        {m.text && <p className="st-annal-text">{m.text}</p>}
      </div>
    </li>
  )
}

function SessionLine({ session: s, onSession }: { session: PastSession; onSession?: (id: string) => void }) {
  const facts = [
    `A party of ${spell(s.party)}`,
    duration(s.span),
    s.deeds !== undefined ? `${s.deeds} ${s.deeds === 1 ? "deed" : "deeds"}` : "",
    s.tokens ? tokensOf(s.tokens) : "",
    s.cost ? costOf(s.cost) : "",
  ].filter(Boolean)
  return (
    <li className="st-annal" data-kind="session" data-outcome={s.outcome}>
      <time className="st-annal-day" dateTime={isoDay(s.at)}>
        {dayOf(s.at)}
      </time>
      <span className="st-annal-mark" aria-hidden="true">
        <StoryGlyphs.book />
      </span>
      <div className="st-annal-words">
        <p className="st-annal-title">
          <b>Legend</b> <q>{s.title}</q>
          <span className="st-annal-outcome">{OUTCOME[s.outcome]}</span>
        </p>
        <p className="st-annal-text">
          {facts.join(" · ")}
          {s.hero ? `. ${s.hero}.` : ""}
        </p>
        {onSession && (
          <button type="button" className="st-annal-open" onClick={() => onSession(s.id)}>
            Read its book
            <span className="ui-visually-hidden">: {s.title}</span>
          </button>
        )}
      </div>
    </li>
  )
}

function metaOf(legend: LegendView): string {
  return [
    `A party of ${spell(legend.party)}`,
    duration(legend.span),
    ...(legend.tokens > 0 ? [tokensOf(legend.tokens)] : []),
    ...(legend.cost > 0 ? [costOf(legend.cost)] : []),
    OUTCOME[legend.outcome],
  ].join(" · ")
}

function historyMeta(history: RepoHistory): string {
  const first = Math.min(...history.sessions.map((s) => s.at), ...history.milestones.map((m) => m.at))
  return [
    `${history.sessions.length} ${history.sessions.length === 1 ? "legend" : "legends"}`,
    `${history.milestones.length} ${history.milestones.length === 1 ? "milestone" : "milestones"}`,
    ...(Number.isFinite(first) ? [`since ${yearOf(first)}`] : []),
  ].join(" · ")
}
