/**
 * The first-visit bar over the live island: folded, just the repo field (user pick 10-13); focusing or
 * clicking it unfolds Generate beside it and "Watch a demo" · "How it's built" · "Connect a source" and
 * the close button under it. Leaving it (Esc, or focus going elsewhere) with the field empty folds it
 * again; Esc on the folded bar, or the close button, dismisses it and the caller remembers that
 * (`onDismiss`, see `writeWelcomeDismissed`). The island is the pitch, so there is no copy beyond a
 * visually hidden h1. Not modal: the world stays visible and alive behind it. It is `data-keepout`:
 * plates stay off it.
 */
import { type FormEvent, useId, useRef, useState } from "react"
import { Button, IconButton } from "../components/controls.tsx"
import { AlertGlyph, CheckGlyph, CloseGlyph, Dest } from "./parts.tsx"
import { parseRepo } from "./repo.ts"

export interface WelcomeCardProps {
  /** Valid `owner/repo` submitted. */
  onGenerate(slug: string): void
  onDemo(): void
  onBuilt(): void
  /** "Connect a source": how to point the island at your own agents (a small third link). */
  onSources?(): void
  /** The close button or Esc: the caller remembers it (`writeWelcomeDismissed`). */
  onDismiss(): void
  /** Real addresses for the two links, so they open in a new tab like any link. */
  demoHref?: string
  builtHref?: string
  /** The field's starting text. */
  initial?: string
  /** A repo is being read: the button waits. */
  busy?: boolean
  /** A problem from the caller (not found, rate limited): shown under the field. */
  error?: string
}

/** What the bar does when it is focused, left or sent Esc (pure: the tests read it). */
export type WelcomeEvent = "focus" | "leave" | "escape"

/**
 * The bar after `event`: focus unfolds it; leaving folds it while the field is empty (a typed repo
 * keeps Generate in reach); Esc folds an unfolded empty bar, and dismisses one already folded or one
 * with nothing to fold.
 */
export function welcomeFold(
  open: boolean,
  event: WelcomeEvent,
  text: string,
): { open: boolean; dismiss?: true } {
  const empty = text.trim() === ""
  if (event === "focus") return { open: true }
  if (event === "leave") return { open: open && !empty }
  return open && empty ? { open: false } : { open, dismiss: true }
}

export function WelcomeCard({
  onGenerate,
  onDemo,
  onBuilt,
  onSources,
  onDismiss,
  demoHref,
  builtHref,
  initial = "",
  busy,
  error,
}: WelcomeCardProps) {
  const id = useId()
  const [text, setText] = useState(initial)
  const [touched, setTouched] = useState(initial !== "")
  const root = useRef<HTMLElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(initial !== "" || Boolean(error))
  const on = (event: WelcomeEvent) => {
    const next = welcomeFold(open, event, text)
    if (next.open !== open) setOpen(next.open)
    if (next.dismiss) onDismiss()
    else if (event === "escape" && !next.open) field.current?.blur()
  }
  const parsed = parseRepo(text)
  const problem = error ?? (touched && text.trim() !== "" && !parsed.ok ? parsed.reason : undefined)
  const good = parsed.ok && text.trim() !== "" && !error

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (parsed.ok && !busy) onGenerate(parsed.slug)
  }

  return (
    <div className="site-welcome" data-busy={busy ? "" : undefined} data-open={open}>
      <h1 className="site-sr">Guildhall: events in, a living world out</h1>
      <section
        ref={root}
        className="ui-panel site-welcome-card"
        aria-label="Your repo as an island"
        data-keepout=""
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.stopPropagation()
          on("escape")
        }}
        onBlur={(e) => {
          // focus going to another part of the bar (Generate, a link) keeps it open
          if (!root.current?.contains(e.relatedTarget as Node | null)) on("leave")
        }}
      >
        <form className="site-welcome-form" onSubmit={submit} noValidate>
          <div className="site-welcome-row">
            <input
              ref={field}
              id={`${id}-repo`}
              className="site-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="owner/repo or GitHub link"
              aria-label="Your repo as an island: owner/repo or GitHub link"
              value={text}
              aria-invalid={problem ? true : undefined}
              data-ok={good ? "" : undefined}
              enterKeyHint="go"
              aria-describedby={`${id}-msg`}
              onChange={(e) => {
                setText(e.currentTarget.value)
                if (!open) setOpen(true)
              }}
              onFocus={() => on("focus")}
              onClick={() => on("focus")}
              onBlur={() => setTouched(true)}
            />
            {open && (
              <Button type="submit" variant="primary" disabled={busy || text.trim() === ""}>
                {busy ? "Reading…" : "Generate"}
              </Button>
            )}
          </div>
          <p
            className="site-msg"
            id={`${id}-msg`}
            data-tone={problem ? "fail" : good ? "ok" : undefined}
            aria-live="polite"
          >
            {problem ? (
              <>
                <AlertGlyph />
                {problem}
              </>
            ) : good && parsed.ok ? (
              <>
                <CheckGlyph />
                Public file tree only, never the code.
              </>
            ) : null}
          </p>
        </form>

        <div className="site-welcome-foot" id={`${id}-more`} hidden={!open}>
          <nav className="site-welcome-links" aria-label="Or look around first">
            <Dest href={demoHref} onNavigate={onDemo} className="site-link">
              Watch a demo
            </Dest>
            <span aria-hidden="true">·</span>
            <Dest href={builtHref} onNavigate={onBuilt} className="site-link">
              How it's built
            </Dest>
            {onSources && (
              <>
                <span aria-hidden="true">·</span>
                <button type="button" className="site-link" onClick={onSources}>
                  Connect a source
                </button>
              </>
            )}
          </nav>
          <IconButton label="Dismiss the welcome" onClick={onDismiss}>
            <CloseGlyph size={14} />
          </IconButton>
        </div>
      </section>
    </div>
  )
}
