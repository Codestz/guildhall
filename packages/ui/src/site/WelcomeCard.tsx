/**
 * The first-visit bar over the live island: the repo field and Generate on one row, "Watch a demo" and
 * "How it's built" under it. The island is the pitch, so there is no copy beyond a visually hidden h1.
 * Not modal: the world stays visible and alive behind it. Esc or the close button dismisses it; the
 * caller remembers that (`onDismiss`, see `writeWelcomeDismissed`). It is `data-keepout`: plates stay off it.
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

export function WelcomeCard({
  onGenerate,
  onDemo,
  onBuilt,
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
  const parsed = parseRepo(text)
  const problem = error ?? (touched && text.trim() !== "" && !parsed.ok ? parsed.reason : undefined)
  const good = parsed.ok && text.trim() !== "" && !error

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (parsed.ok && !busy) onGenerate(parsed.slug)
  }

  return (
    <div className="site-welcome" data-busy={busy ? "" : undefined}>
      <h1 className="site-sr">Guildhall: events in, a living world out</h1>
      <section
        ref={root}
        className="ui-panel site-welcome-card"
        aria-label="Your repo as an island"
        data-keepout=""
        onKeyDown={(e) => {
          if (e.key === "Escape") onDismiss()
        }}
      >
        <form className="site-welcome-form" onSubmit={submit} noValidate>
          <div className="site-welcome-row">
            <input
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
              onChange={(e) => setText(e.currentTarget.value)}
              onBlur={() => setTouched(true)}
            />
            <Button type="submit" variant="primary" disabled={busy || text.trim() === ""}>
              {busy ? "Reading…" : "Generate"}
            </Button>
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

        <div className="site-welcome-foot">
          <nav className="site-welcome-links" aria-label="Or look around first">
            <Dest href={demoHref} onNavigate={onDemo} className="site-link">
              Watch a demo
            </Dest>
            <span aria-hidden="true">·</span>
            <Dest href={builtHref} onNavigate={onBuilt} className="site-link">
              How it's built
            </Dest>
          </nav>
          <IconButton label="Dismiss the welcome" onClick={onDismiss}>
            <CloseGlyph size={14} />
          </IconButton>
        </div>
      </section>
    </div>
  )
}
