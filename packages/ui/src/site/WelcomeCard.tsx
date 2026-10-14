/**
 * The first-visit bar over the live island: folded, just the repo field (user pick 10-13); focusing or
 * clicking it unfolds Generate beside it and "Watch a demo" · "How it's built" · "Connect a source" and
 * the close button under it. Leaving it (Esc, or focus going elsewhere) with the field empty folds it
 * again; Esc on the folded bar, or the close button, dismisses it and the caller remembers that
 * (`onDismiss`, see `writeWelcomeDismissed`). The island is the pitch, so there is no copy beyond a
 * visually hidden h1. Not modal: the world stays visible and alive behind it. It is `data-keepout`:
 * plates stay off it.
 *
 * On a phone (≤ 600 px, decisions.md "Phone GUI") the foot is the game's HUD, so the bar folds to a small
 * "Your repo" button in the top row (`data-dock="top"`) that unfolds the same card over the screen; its
 * close button, a tap outside or Esc fold it back to the button.
 */
import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { IconButton } from "../components/controls.tsx"
import { AlertGlyph, ArrowGlyph, CheckGlyph, CloseGlyph, Dest, RepoGlyph } from "./parts.tsx"
import { parseRepo } from "./repo.ts"

/** At or below this width the welcome is the top row's button (the HUD's phone width, viewer/hud.ts). */
export const WELCOME_TOP_MAX = 600

/** The repos the empty field suggests in turn (its placeholder), a few seconds each. */
export const EXAMPLES: readonly string[] = [
  "facebook/react",
  "vercel/next.js",
  "rust-lang/rust",
  "sveltejs/svelte",
  "Codestz/guildhall",
]
/** How long each example shows, ms. */
export const EXAMPLE_MS = 3600

/** The field's placeholder with the `k`th example (wrapping). Pure. */
export function examplePlaceholder(k: number): string {
  return `e.g. ${EXAMPLES[((k % EXAMPLES.length) + EXAMPLES.length) % EXAMPLES.length]}`
}

/** The example's turn: counts up every EXAMPLE_MS while `on` (the field empty), holds otherwise. */
function useExample(on: boolean): number {
  const [k, setK] = useState(0)
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setK((n) => n + 1), EXAMPLE_MS)
    return () => clearInterval(timer)
  }, [on])
  return k
}

/** True while the screen is a phone's (the welcome docks in the top row). */
function useTopDock(): boolean {
  const query = `(max-width: ${WELCOME_TOP_MAX}px)`
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const list = matchMedia(query)
    const change = () => setOn(list.matches)
    change()
    list.addEventListener("change", change)
    return () => list.removeEventListener("change", change)
  }, [query])
  return on
}

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
  const top = useTopDock()
  const on = (event: WelcomeEvent) => {
    const next = welcomeFold(open, event, text)
    if (next.open !== open) setOpen(next.open)
    // on a phone the button stays: Esc folds the card back to it, never dismisses it
    if (next.dismiss && !top) onDismiss()
    else if (event === "escape" && top) setOpen(false)
    else if (event === "escape" && !next.open) field.current?.blur()
  }
  // the card unfolded from the top row's button: the field takes the focus (the keyboard comes up)
  useEffect(() => {
    if (top && open) field.current?.focus({ preventScroll: true })
  }, [top, open])
  const example = useExample(text === "")
  const parsed = parseRepo(text)
  const problem = error ?? (touched && text.trim() !== "" && !parsed.ok ? parsed.reason : undefined)
  const good = parsed.ok && text.trim() !== "" && !error

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (parsed.ok && !busy) onGenerate(parsed.slug)
  }

  return (
    <div
      className="site-welcome"
      data-busy={busy ? "" : undefined}
      data-open={open}
      data-dock={top ? "top" : undefined}
    >
      <h1 className="site-sr">Guildhall: events in, a living world out</h1>
      {/* a tap on the dim round the unfolded card folds it */}
      {top && open && (
        <div className="site-scrim" data-soft="" aria-hidden="true" onClick={() => setOpen(false)} />
      )}
      {top && !open && (
        <button
          type="button"
          className="site-repo-btn"
          data-keepout=""
          aria-label="Your repo as an island"
          onClick={() => setOpen(true)}
        >
          <RepoGlyph />
          <span className="site-repo-word">Your repo</span>
        </button>
      )}
      <section
        hidden={top && !open}
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
          <div className="site-welcome-row site-field" data-ok={good ? "" : undefined}>
            <span className="site-field-mark" aria-hidden="true">
              <RepoGlyph />
            </span>
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
              placeholder={examplePlaceholder(example)}
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
            <button
              type="submit"
              className="site-go"
              disabled={busy || text.trim() === ""}
              aria-label={busy ? "Reading the repo" : "Generate the island"}
            >
              <span className="site-go-word">{busy ? "Reading…" : "Generate"}</span>
              <ArrowGlyph />
            </button>
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
          <IconButton
            label={top ? "Fold the repo field" : "Dismiss the welcome"}
            onClick={top ? () => setOpen(false) : onDismiss}
          >
            <CloseGlyph size={14} />
          </IconButton>
        </div>
      </section>
    </div>
  )
}
