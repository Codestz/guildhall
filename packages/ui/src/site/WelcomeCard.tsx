/**
 * The first-visit card over the live island: the line, "Your repo as an island" (owner/repo or a pasted
 * GitHub address), Generate, and the two ways in for someone with no repo to hand (a demo, how it's built).
 * Not modal: the world stays visible and alive behind it. Esc or the close button dismisses it; the
 * caller remembers that (`onDismiss`, see `writeWelcomeDismissed`). On a phone it is a bottom sheet.
 */
import { type FormEvent, useId, useRef, useState } from "react"
import { Button, IconButton } from "../components/controls.tsx"
import { Crest } from "../hud/glyphs.tsx"
import { AlertGlyph, ArrowIcon, CheckGlyph, CloseGlyph, Dest } from "./parts.tsx"
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
      <section
        ref={root}
        className="ui-panel site-welcome-card"
        aria-labelledby={`${id}-h`}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDismiss()
        }}
      >
        <div className="site-welcome-close">
          <IconButton label="Dismiss the welcome" onClick={onDismiss}>
            <CloseGlyph size={16} />
          </IconButton>
        </div>
        <div className="site-welcome-head">
          <span className="site-welcome-crest" aria-hidden="true">
            <Crest size={26} />
          </span>
          <div>
            <p className="ui-eyebrow">Guildhall</p>
            <h2 className="site-welcome-line" id={`${id}-h`}>
              Events in. A living world out.
            </h2>
          </div>
        </div>
        <p className="site-welcome-sub">
          Agents, GitHub and a repo's history, grown into a living hex island.
        </p>

        <form className="site-welcome-form" onSubmit={submit} noValidate>
          <label className="site-welcome-label" htmlFor={`${id}-repo`}>
            Your repo as an island
          </label>
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
              placeholder="owner/repo or a GitHub link"
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
                {parsed.slug}: read from the public file tree, never the code.
              </>
            ) : (
              "Any public GitHub repo. The same tree always grows the same island."
            )}
          </p>
        </form>

        <nav className="site-welcome-links" aria-label="Or look around first">
          <Dest href={demoHref} onNavigate={onDemo} className="site-link">
            Watch a demo
            <ArrowIcon />
          </Dest>
          <Dest href={builtHref} onNavigate={onBuilt} className="site-link">
            How it's built
            <ArrowIcon />
          </Dest>
        </nav>
      </section>
    </div>
  )
}
