/**
 * One hero up close (V1's hud/Dossier.tsx), fed by props: who they are (family and banner), their quest,
 * their purse, the places their files belong to, and what they have done so far. The right-hand sheet;
 * on a phone, a bottom sheet.
 */
import { useEffect, useRef } from "react"
import { cost, FAMILY_LABEL, heroTitle, phaseOf, RANK_LABEL, span, tokens } from "./format.ts"
import { Glyphs, TOOL_GLYPH } from "./glyphs.tsx"
import { BannerChip, FamilyChip, Sigil, Status } from "./parts.tsx"
import type { FilePlace, HeroView, Ledger, PartyView, TranscriptLine } from "./types.ts"

/** The transcript keeps its newest this many lines. */
export const TRANSCRIPT_SHOWN = 60

export interface DossierProps {
  hero: HeroView
  party?: PartyView
  /** What they were sent to do. */
  quest?: string
  ledger: Ledger
  /** The model they run on (`claude-opus-5-5`). */
  model?: string
  /** Files they touched, and the place each belongs to: where on the island their work is. */
  files?: readonly FilePlace[]
  transcript: readonly TranscriptLine[]
  onClose: () => void
  className?: string
}

export function Dossier({
  hero,
  party,
  quest,
  ledger,
  model,
  files = [],
  transcript,
  onClose,
  className,
}: DossierProps) {
  const scroller = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  const state = phaseOf(hero.phase)
  const shown = transcript.slice(-TRANSCRIPT_SHOWN)

  // Follow the newest line unless the reader scrolled up to read something older.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the transcript grows or the hero changes
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [shown.length, hero.id])

  const eyebrow = [
    hero.rank ? RANK_LABEL[hero.rank] : "Hero",
    FAMILY_LABEL[hero.family].one,
    party && `${party.name} quest`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <aside
      className={`ui-panel hud-dossier${className ? ` ${className}` : ""}`}
      aria-labelledby="hud-dossier-h"
    >
      <header className="hud-dossier-head">
        <Sigil family={hero.family} banner={hero.banner} ordinal={hero.ordinal} size="lg" />
        <div className="hud-dossier-id">
          <span className="hud-eyebrow">{eyebrow}</span>
          <h2 id="hud-dossier-h">
            {heroTitle(hero)}
            {hero.source && <span className="hud-dossier-source"> · {hero.source}</span>}
          </h2>
          <span className="hud-dossier-tags">
            <Status tone={state.tone} label={state.label} />
            <FamilyChip family={hero.family} />
            <BannerChip colour={hero.banner}>{hero.master ? "Guildmaster" : hero.name} banner</BannerChip>
          </span>
        </div>
        <button
          type="button"
          className="ui-icon-btn"
          onClick={onClose}
          aria-label="Close dossier (Esc)"
          title="Close (Esc)"
        >
          <Glyphs.close />
        </button>
      </header>

      {quest && (
        <section className="hud-quest-card" aria-label="Quest">
          <span className="hud-eyebrow">Quest</span>
          <p>{quest}</p>
        </section>
      )}

      <dl className="hud-ledger">
        <div>
          <dt>Tokens</dt>
          <dd className="num">{tokens(ledger.tokens)}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd className="num">{cost(ledger.cost)}</dd>
        </div>
        <div>
          <dt>Deeds</dt>
          <dd className="num">{ledger.deeds}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="num">{span(ledger.ms)}</dd>
        </div>
      </dl>

      {(hero.place || files.length > 0) && (
        <section className="hud-places" aria-labelledby="hud-places-h">
          <div className="hud-sub-head">
            <span className="hud-eyebrow" id="hud-places-h">
              Where
            </span>
            {hero.place && (
              <span className="hud-now">
                <Glyphs.place size={13} />
                Now at <b>{hero.place}</b>
              </span>
            )}
          </div>
          {files.length > 0 && (
            <ul className="hud-file-list">
              {files.map((f) => (
                <li key={f.path}>
                  <span className="hud-file num" title={f.path}>
                    {f.path}
                  </span>
                  <span className="hud-file-place">
                    <span aria-hidden="true">→</span>
                    <span className="ui-visually-hidden">belongs to</span> {f.place}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="hud-sub-head hud-transcript-head">
        <span className="hud-eyebrow">Transcript</span>
        {model && <span className="num hud-faint">{model}</span>}
      </div>
      <ol
        className="hud-transcript"
        ref={scroller}
        aria-label={`${heroTitle(hero)} transcript`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {shown.length === 0 && <li className="hud-empty">No words yet.</li>}
        {shown.map((line) => (
          <Line key={line.key} line={line} />
        ))}
      </ol>
    </aside>
  )
}

function Line({ line }: { line: TranscriptLine }) {
  switch (line.kind) {
    case "prompt":
      return (
        <li className="hud-t" data-kind="prompt">
          <span className="hud-t-label">{line.first ? "Given the quest" : "Told"}</span>
          <p>{line.text}</p>
        </li>
      )
    case "thinking":
      return (
        <li className="hud-t" data-kind="thinking">
          <span className="hud-t-label">
            <Glyphs.thought size={13} /> Ponders
          </span>
          <p>{line.text || "…"}</p>
        </li>
      )
    case "reply":
      return (
        <li className="hud-t" data-kind="reply">
          <span className="hud-t-label">Says</span>
          <p>{line.text}</p>
        </li>
      )
    case "tool": {
      const Glyph = TOOL_GLYPH[line.state]
      return (
        <li className="hud-t" data-kind="tool" data-state={line.state}>
          <span className="hud-t-state" title={line.state}>
            <Glyph />
            <span className="ui-visually-hidden">{line.state}</span>
          </span>
          <span className="hud-t-call">
            <span className="hud-t-name num">{line.name}</span>
            {line.target && <span className="hud-t-target num">{line.target}</span>}
          </span>
          {line.note && <span className="hud-t-note">{line.note}</span>}
        </li>
      )
    }
  }
}
