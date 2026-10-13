/**
 * The brand (V1's crest + status line, as the Viewer's title card): the guild's name, where its events
 * come from (a live, replay or story dot that says it in words too), and its headline figures. The crest
 * folds an "about" card open under it; a plea waiting shows as a dot on the crest.
 */
import { type ReactNode, useId } from "react"
import { Button } from "../components/controls.tsx"
import { Figures } from "../components/display.tsx"
import { count } from "./format.ts"
import { Crest, Glyphs } from "./glyphs.tsx"
import type { SourceState } from "./types.ts"

export interface BrandFigures {
  heroes: number
  places: number
  deeds: number
}

export interface BrandCardProps {
  /** The guild: `Codestz/guildhall`. */
  name: string
  source: SourceState
  figures: BrandFigures
  /** Waiting on a human: a dot on the crest and a word in the status line. */
  pleas?: number
  /** The about card under the crest (folded unless `open`). */
  about?: ReactNode
  open?: boolean
  onToggle?: () => void
  /** Live and the link is lost: a way to try again. */
  onRetry?: () => void
}

/** What the source dot says, in words (never the dot's colour alone). */
export function sourceWords(source: SourceState): {
  label: string
  tone: "live" | "wait" | "lost" | "replay" | "story"
} {
  if (source.kind === "replay") return { label: "Replay", tone: "replay" }
  if (source.kind === "story") return { label: "Story", tone: "story" }
  if (source.link === "lost") return { label: "Live · link lost", tone: "lost" }
  if (source.link === "connecting") return { label: "Live · connecting…", tone: "wait" }
  return { label: "Live", tone: "live" }
}

export function BrandCard({
  name,
  source,
  figures,
  pleas = 0,
  about,
  open = false,
  onToggle,
  onRetry,
}: BrandCardProps) {
  const id = useId()
  const words = sourceWords(source)
  const crest = (
    <>
      <Crest />
      {pleas > 0 && <i className="hud-tab-dot" aria-hidden="true" />}
    </>
  )
  return (
    <header className="ui-panel hud-brand" data-open={open}>
      <div className="hud-brand-head">
        {about && onToggle ? (
          <button
            type="button"
            className="hud-crest"
            aria-expanded={open}
            aria-controls={`${id}-about`}
            aria-label={`About Guildhall${pleas > 0 ? `, ${count(pleas, "plea")} waiting` : ""}`}
            title="About Guildhall"
            onClick={onToggle}
          >
            {crest}
          </button>
        ) : (
          <span className="hud-crest" aria-hidden="true">
            {crest}
          </span>
        )}
        <div className="hud-brand-id">
          <h1 className="hud-brand-name" title={name}>
            {name}
          </h1>
          <p className="hud-status-line" role="status">
            <i className="hud-source-dot" data-tone={words.tone} aria-hidden="true" />
            <span className="hud-source" data-tone={words.tone}>
              {words.label}
            </span>
            {source.name && <span className="hud-sl-part hud-sl-name">{source.name}</span>}
            {pleas > 0 && <span className="hud-sl-part hud-sl-plea">{count(pleas, "plea")}</span>}
          </p>
        </div>
      </div>
      {words.tone === "lost" && onRetry && (
        <div className="hud-brand-alert">
          <span>
            <Glyphs.fail size={14} /> The hub stopped answering. The island shows the last it heard.
          </span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <Glyphs.retry size={14} />
            Retry
          </Button>
        </div>
      )}
      <Figures
        rows={[
          { label: figures.heroes === 1 ? "hero" : "heroes", value: figures.heroes },
          { label: figures.places === 1 ? "place" : "places", value: figures.places },
          { label: figures.deeds === 1 ? "deed" : "deeds", value: figures.deeds },
        ]}
      />
      {about && (
        <section className="hud-about" id={`${id}-about`} aria-label="About Guildhall" hidden={!open}>
          {about}
        </section>
      )}
    </header>
  )
}
