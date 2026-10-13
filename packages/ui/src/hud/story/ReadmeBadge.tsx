/**
 * The README badge (V1's hud/DoorChronicle.tsx and chronicleLinks.ts): a shields.io badge in the hall's
 * brass and ink that links to the repo's island, as Markdown to paste into a README. Folded it is one
 * button (the island glyph alone with `compact`); pressed, a small popover shows the badge, its
 * Markdown and a Copy button. Esc or a click elsewhere closes it. Nothing is hosted yet: the link is
 * where the hall will serve the island (`/hall/<owner>/<repo>`).
 */
import { useEffect, useId, useRef, useState } from "react"
import { Glyphs } from "../glyphs.tsx"
import { copyText } from "./clipboard.ts"
import { StoryGlyphs } from "./glyphs.tsx"

/** The hall's public address: badges point here, never at the page's own origin. */
export const SITE = "https://guildhall.codestz.dev"

/** The badge's picture: V1's static shields.io badge, brass on ink. */
export const BADGE_IMAGE =
  "https://img.shields.io/badge/Guildhall-see_it_as_an_island-dcb662?labelColor=15110d"

/** `owner/name` kept readable in a path: each part encoded, the slash kept. */
const pathOf = (repo: string): string => repo.split("/").map(encodeURIComponent).join("/")

/** The repo's island in the hall: `https://guildhall.codestz.dev/hall/owner/name`. */
export function islandLink(repo: string, site = SITE): string {
  return `${site.replace(/\/$/, "")}/hall/${pathOf(repo)}`
}

/** The README badge as Markdown: the picture, linking to the island. Brackets in the name are escaped. */
export function badgeMarkdown(repo: string, site = SITE): string {
  const name = repo.replace(/[[\]\\]/g, "\\$&")
  return `[![See ${name} as an island in Guildhall](${BADGE_IMAGE})](${islandLink(repo, site)})`
}

export interface ReadmeBadgeProps {
  /** `owner/name`. */
  repo: string
  site?: string
  /** The glyph alone. */
  compact?: boolean
  /** Open on mount (the lab, shots). */
  open?: boolean
  /** Show the badge's picture in the popover (it loads from shields.io). */
  preview?: boolean
}

export function ReadmeBadge({
  repo,
  site = SITE,
  compact,
  open: opened = false,
  preview = true,
}: ReadmeBadgeProps) {
  const id = useId()
  const [open, setOpen] = useState(opened)
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const markdown = badgeMarkdown(repo, site)

  useEffect(() => {
    if (copied === "idle") return
    const timer = setTimeout(() => setCopied("idle"), 2200)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open])

  async function copy() {
    setCopied((await copyText(markdown)) ? "done" : "failed")
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc closes the popover from anywhere inside it
    <div
      ref={root}
      className="st-badge"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation()
          setOpen(false)
          button.current?.focus()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={compact ? "ui-icon-btn" : "ui-btn"}
        data-plaque={compact ? "" : undefined}
        aria-expanded={open}
        aria-controls={`${id}-pop`}
        aria-label={compact ? "README badge" : undefined}
        title="A README badge that links to this island"
        onClick={() => setOpen((o) => !o)}
      >
        <StoryGlyphs.island />
        {!compact && <span>README badge</span>}
      </button>
      {open && (
        <section className="ui-panel st-badge-pop" id={`${id}-pop`} aria-labelledby={`${id}-h`}>
          <header className="st-badge-head">
            <h2 id={`${id}-h`} className="ui-eyebrow">
              README badge
            </h2>
            <button
              type="button"
              className="ui-icon-btn"
              aria-label="Close (Esc)"
              onClick={() => {
                setOpen(false)
                button.current?.focus()
              }}
            >
              <Glyphs.close />
            </button>
          </header>
          <p className="ui-hint">
            Paste it into <span className="num">{repo}</span>’s README: it links to the repo’s island.
          </p>
          {preview && (
            <p className="st-badge-preview">
              <img src={BADGE_IMAGE} alt={`See ${repo} as an island in Guildhall`} height={20} />
            </p>
          )}
          <label className="ui-visually-hidden" htmlFor={`${id}-md`}>
            The badge as Markdown
          </label>
          <textarea
            id={`${id}-md`}
            className="st-badge-md num"
            readOnly
            rows={3}
            value={markdown}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="st-badge-actions">
            <button type="button" className="ui-btn" data-variant="primary" onClick={copy}>
              {copied === "done" ? <StoryGlyphs.check /> : <StoryGlyphs.copy />}
              <span>
                {copied === "done" ? "Badge copied" : copied === "failed" ? "Couldn't copy" : "Copy Markdown"}
              </span>
            </button>
          </div>
          <span className="ui-visually-hidden" aria-live="polite">
            {copied === "done"
              ? `README badge for ${repo} copied, as Markdown`
              : copied === "failed"
                ? "Could not copy"
                : ""}
          </span>
        </section>
      )}
    </div>
  )
}
