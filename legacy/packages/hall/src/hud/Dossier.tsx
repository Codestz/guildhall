import type { Entry } from "@guildhall/core"
import { useEffect, useRef } from "react"
import { initials, RANK_LABEL } from "../guild/casting.ts"
import type { AdventurerView, GuildStore } from "../guild/store.ts"
import { cost, phaseOf, STATUS, span, targetOf, tokens } from "./format.ts"
import { Icon } from "./icons.tsx"
import { Sigil, Status } from "./parts.tsx"

const SHOWN = 60

/** One adventurer up close: their quest, their purse, and what they have done so far. */
export function Dossier({
  store,
  view,
  className,
}: {
  store: GuildStore
  view: AdventurerView | undefined
  className?: string
}) {
  const id = store.selected
  const session = id ? store.sessionOf(id) : undefined
  const scroller = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  const count = session?.entries.length ?? 0
  // Several parties on the island: whose quest they are on, in the eyebrow.
  const party = store.parties.length > 1 ? store.parties.find((p) => p.id === view?.party) : undefined

  // Follow the newest entry unless the reader scrolled up to read something older.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the transcript grows
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [count, id])

  if (!id || !session) return null

  const title = view?.title ?? session.agent
  const color = view?.color ?? "#9a8f80"
  const state = view ? phaseOf(view.phase) : (STATUS[session.status] ?? phaseOf(session.status))
  const elapsed = (session.ended ?? store.now) - session.started
  const deeds = session.entries.filter((e) => e.kind === "tool").length
  const shown = session.entries.slice(-SHOWN)

  return (
    <aside className={`plaque dossier ${className ?? ""}`} aria-labelledby="dossier-h">
      <header className="dossier-head">
        <Sigil glyph={view?.glyph ?? initials(title)} color={color} ordinal={view?.ordinal} size="lg" />
        <div className="dossier-id">
          <span className="eyebrow">{eyebrowOf(view, party?.name)}</span>
          <h2 id="dossier-h">{title}</h2>
          <Status tone={state.tone} label={state.label} />
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => store.select(null)}
          aria-label="Close dossier (Esc)"
          title="Close (Esc)"
        >
          <Icon.close />
        </button>
      </header>

      {session.task && (
        <section className="quest-card" aria-label="Quest">
          <span className="eyebrow">Quest</span>
          <p>{session.task}</p>
        </section>
      )}

      <dl className="ledger">
        <div>
          <dt>Tokens</dt>
          <dd className="mono">{tokens(session.tokens)}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd className="mono">{cost(session.cost)}</dd>
        </div>
        <div>
          <dt>Deeds</dt>
          <dd className="mono">{deeds}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="mono">{span(elapsed)}</dd>
        </div>
      </dl>

      <div className="transcript-head">
        <span className="eyebrow">Transcript</span>
        {session.model && <span className="mono faint">{session.model}</span>}
      </div>
      <ol
        className="transcript"
        ref={scroller}
        aria-label={`${title} transcript`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be keyboard-reachable
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {shown.length === 0 && <li className="empty">No words yet.</li>}
        {shown.map((entry) => (
          <Line key={entry.kind === "tool" ? entry.call : entry.key} entry={entry} />
        ))}
      </ol>
    </aside>
  )
}

function Line({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "prompt":
      return (
        <li className="t-entry t-prompt">
          <span className="t-label">{entry.first ? "Given the quest" : "Told"}</span>
          <p>{entry.text}</p>
        </li>
      )
    case "thinking":
      return (
        <li className="t-entry t-thinking">
          <span className="t-label">
            <Icon.thought /> Ponders
          </span>
          <p>{entry.text || "…"}</p>
        </li>
      )
    case "reply":
      return (
        <li className="t-entry t-reply">
          <span className="t-label">Says</span>
          <p>{entry.text}</p>
        </li>
      )
    case "tool": {
      const Glyph = Icon[entry.state === "failed" ? "fail" : entry.state] ?? Icon.pending
      const target = targetOf(entry)
      const note = entry.state === "failed" ? entry.error : entry.summary
      return (
        <li className="t-entry t-tool" data-state={entry.state}>
          <span className="t-state" title={entry.state}>
            <Glyph />
            <span className="visually-hidden">{entry.state}</span>
          </span>
          <span className="t-call">
            <span className="t-name mono">{entry.name}</span>
            {target && <span className="t-target mono">{target}</span>}
          </span>
          {note && <span className="t-note">{note}</span>}
        </li>
      )
    }
  }
}

/** Over the name: their rank and the source's own name for them, and whose quest it is. */
function eyebrowOf(view: AdventurerView | undefined, party: string | undefined): string {
  const parts = [view ? RANK_LABEL[view.rank] : "Adventurer", view?.subtitle, party && `${party} quest`]
  const said = parts.filter(Boolean)
  return (said.length > 1 ? said : [...said, "Dossier"]).join(" · ")
}
