/**
 * The brand (V1's crest + status line, as the Viewer's title card): the guild's name, where its events
 * come from (a live, replay or story dot that says it in words too), and its headline figures. The crest
 * folds an "about" card open under it; a plea waiting shows as a dot on the crest. Where the page shows
 * its own crest (the site's crest menu), `crest={false}` drops it and the name folds the card instead.
 */
import { type ReactNode, useId } from "react"
import { Button } from "../components/controls.tsx"
import { Figures, type Stat } from "../components/display.tsx"
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
  /** The guild's figures (heroes, places, deeds); `stats` draws others in their place. */
  figures?: BrandFigures
  /** Figures of the caller's own (a repo's files, commits, years…), in place of `figures`. */
  stats?: readonly Stat[]
  /** No figures: the name and the status line alone (the HUD's minimal mode). */
  compact?: boolean
  /** The crest (default on). Off where the page already shows one: the name then folds the about card. */
  crest?: boolean
  /** A word after the source in the status line (`chronicle 2026-10-12`). */
  status?: string
  /** Waiting on a human: a dot on the crest and a word in the status line. */
  pleas?: number
  /** The about card under the crest (folded unless `open`). */
  about?: ReactNode
  open?: boolean
  onToggle?: () => void
  /** Live and the link is lost: a way to try again. */
  onRetry?: () => void
  /**
   * The top row's repo chip (user 10-13): the name and its source dot on one small pill of its own width,
   * right of the site's crest; pressing it unfolds the details (status, figures, about) as a panel under
   * the row. The card form (the default) is the studio labs'.
   */
  chip?: boolean
}

/** What the source dot says, in words (never the dot's colour alone). */
export function sourceWords(source: SourceState): {
  label: string
  tone: "live" | "wait" | "lost" | "replay" | "story" | "history" | "sketch"
} {
  if (source.kind === "replay") return { label: "Replay", tone: "replay" }
  if (source.kind === "story") return { label: "Story", tone: "story" }
  if (source.kind === "history") return { label: "History", tone: "history" }
  if (source.kind === "sketch") return { label: "Sketch", tone: "sketch" }
  if (source.link === "lost") return { label: "Live · link lost", tone: "lost" }
  if (source.link === "connecting") return { label: "Live · connecting…", tone: "wait" }
  return { label: "Live", tone: "live" }
}

/** The repo chip: its name (the row's width cuts it with an ellipsis at the end), the source dot and, with a plea, its mark. */
function RepoChip({
  name,
  open,
  controls,
  label,
  title,
  onToggle,
  children,
}: {
  name: string
  open: boolean
  controls: string
  label: string
  title: string
  onToggle?: (() => void) | undefined
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="ui-panel hud-repo-chip"
      data-open={open}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={title}
      onClick={onToggle}
    >
      <span className="hud-repo-name">{name}</span>
      {children}
    </button>
  )
}

export function BrandCard({
  name,
  source,
  figures,
  stats,
  compact = false,
  crest: withCrest = true,
  status,
  pleas = 0,
  about,
  open = false,
  onToggle,
  onRetry,
  chip = false,
}: BrandCardProps) {
  const id = useId()
  const words = sourceWords(source)
  const rows: readonly Stat[] =
    stats ??
    (figures
      ? [
          { label: figures.heroes === 1 ? "hero" : "heroes", value: figures.heroes },
          { label: figures.places === 1 ? "place" : "places", value: figures.places },
          { label: figures.deeds === 1 ? "deed" : "deeds", value: figures.deeds },
        ]
      : [])
  const crest = (
    <>
      <Crest />
      {pleas > 0 && <i className="hud-tab-dot" aria-hidden="true" />}
    </>
  )
  const title = (
    <h1 className="hud-brand-name" title={name}>
      {name}
    </h1>
  )
  const statusLine = (
    <p className="hud-status-line" role="status">
      <i className="hud-source-dot" data-tone={words.tone} aria-hidden="true" />
      <span className="hud-source" data-tone={words.tone}>
        {words.label}
      </span>
      {source.name && <span className="hud-sl-part hud-sl-name">{source.name}</span>}
      {status && <span className="hud-sl-part">{status}</span>}
      {pleas > 0 && <span className="hud-sl-part hud-sl-plea">{count(pleas, "plea")}</span>}
    </p>
  )
  const alert = words.tone === "lost" && onRetry && (
    <div className="hud-brand-alert">
      <span>
        <Glyphs.fail size={14} /> The hub stopped answering. The island shows the last it heard.
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <Glyphs.retry size={14} />
        Retry
      </Button>
    </div>
  )
  if (chip)
    return (
      <>
        <RepoChip
          name={name}
          open={open}
          controls={`${id}-more`}
          label={`${name}, ${words.label}${pleas > 0 ? `, ${count(pleas, "plea")} waiting` : ""}. ${open ? "Fold the details" : "Details"}`}
          title={`${name} · ${words.label}`}
          onToggle={onToggle}
        >
          <i className="hud-source-dot" data-tone={words.tone} aria-hidden="true" />
          <span className="hud-repo-source" data-tone={words.tone} aria-hidden="true">
            {words.label}
          </span>
          {pleas > 0 && (
            <span className="hud-repo-plea" aria-hidden="true">
              <Glyphs.plea size={12} />
            </span>
          )}
        </RepoChip>
        {(open || alert) && (
          <section
            className="ui-panel hud-brand hud-brand-more"
            id={`${id}-more`}
            aria-label={`About ${name}`}
            data-open={open}
          >
            {open && statusLine}
            {alert}
            {open && rows.length > 0 && <Figures rows={rows} />}
            {open && about && <div className="hud-about">{about}</div>}
          </section>
        )}
      </>
    )
  return (
    <header className="ui-panel hud-brand" data-open={open} data-crest={withCrest} data-compact={compact}>
      <div className="hud-brand-head">
        {!withCrest ? null : about && onToggle ? (
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
          {!withCrest && about && onToggle ? (
            <button
              type="button"
              className="hud-brand-toggle"
              aria-expanded={open}
              aria-controls={`${id}-about`}
              title={open ? "Fold" : "More about it"}
              onClick={onToggle}
            >
              {title}
              <span className="hud-fold" aria-hidden="true">
                <Glyphs.chevron size={14} />
              </span>
            </button>
          ) : (
            title
          )}
          <p className="hud-status-line" role="status">
            <i className="hud-source-dot" data-tone={words.tone} aria-hidden="true" />
            <span className="hud-source" data-tone={words.tone}>
              {words.label}
            </span>
            {source.name && <span className="hud-sl-part hud-sl-name">{source.name}</span>}
            {status && <span className="hud-sl-part">{status}</span>}
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
      {!compact && rows.length > 0 && <Figures rows={rows} />}
      {about && (
        <section className="hud-about" id={`${id}-about`} aria-label="About" hidden={!open}>
          {about}
        </section>
      )}
    </header>
  )
}
