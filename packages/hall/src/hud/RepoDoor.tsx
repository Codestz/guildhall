import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { MAX_ISLANDS } from "../world/archipelago.ts"
import { parseRepo } from "../world/gen/fetch.ts"
import type { RepoFailure } from "../world/gen/load.ts"
import { useWorld } from "../world/source.ts"
import { FOCUSABLE, tabStops, wrapOf } from "./focus.ts"
import { Icon } from "./icons.tsx"
import { addToArchipelago, islandLink, shareLink } from "./repoLinks.ts"

/**
 * The public front door: "your repo as an island". Paste a GitHub link or owner/name and the hall
 * reloads on the island grown from it (`?repo=`, world/gen/load.ts); or adds it to the archipelago
 * (`?repos=`). The tree is fetched here first, so a missing repo, a private one or GitHub's rate
 * limit is said in the dialog, with a retry, before the page is left; what was fetched is kept for
 * the session (load.ts), so the reload doesn't ask GitHub twice.
 *
 * Always a reload, never a swap in place: the scene doesn't survive its world changing under it.
 *
 * Opened from the brand's about card, Settings, the showcase's opening caption, the repo legend and
 * the archipelago switcher (`repoDoor.open`). Modal: focus is held inside, Esc or the scrim closes
 * it, and focus goes back to whatever opened it.
 */

/** Approved showcase repos (the author's own, plus one everybody knows): all bundled fixtures. */
export const EXAMPLES: readonly { repo: string; label: string }[] = [
  { repo: "Codestz/claude-hindsight", label: "claude-hindsight" },
  { repo: "Codestz/mcpx", label: "mcpx" },
  { repo: "Codestz/opencode-cockpit", label: "opencode-cockpit" },
  { repo: "Codestz/Mintroot", label: "Mintroot" },
  { repo: "facebook/react", label: "facebook/react" },
]

// ── open / close, from anywhere in the HUD ──

type Listener = () => void
const listeners = new Set<Listener>()
let isOpen = false
let opener: HTMLElement | null = null

export const repoDoor = {
  open(): void {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    isOpen = true
    for (const listener of listeners) listener()
  },
  close(): void {
    if (!isOpen) return
    isOpen = false
    for (const listener of listeners) listener()
    const back = opener
    opener = null
    // Back to what opened it, if it is still on the page (a folded card's button may be gone).
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus()
    })
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useRepoDoor(): boolean {
  return useSyncExternalStore(repoDoor.subscribe, () => isOpen)
}

// ── the dialog ──

type Action = "visit" | "add"
type Phase =
  | { state: "idle" }
  | { state: "checking"; repo: string; action: Action }
  | { state: "truncated"; repo: string; action: Action }
  | { state: "going"; repo: string; action: Action }
  | {
      state: "failed"
      kind: RepoFailure | "empty" | "full"
      message: string
      repo?: string
      action: Action
      resetAt?: Date
    }

export function RepoDoor() {
  const { repo: grown } = useWorld()
  const current = grown?.repo
  const [text, setText] = useState(current ?? "")
  const [phase, setPhase] = useState<Phase>({ state: "idle" })
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const asked = useRef(0)
  const id = useId()

  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

  useEffect(() => {
    if (copied === "idle") return
    const timer = setTimeout(() => setCopied("idle"), 2200)
    return () => clearTimeout(timer)
  }, [copied])

  const busy = phase.state === "checking" || phase.state === "going"
  const typed = validRepo(text)
  /** What Share and the footer act on: the repo typed, else the island on screen. */
  const subject = typed ?? current

  async function run(action: Action, raw: string = text, force = false) {
    const n = ++asked.current
    const wanted = raw.trim()
    if (!wanted) {
      setPhase({
        state: "failed",
        kind: "empty",
        action,
        message: "Paste a GitHub link or owner/name first.",
      })
      field.current?.focus()
      return
    }
    let repo: string
    try {
      repo = parseRepo(wanted)
    } catch {
      setPhase({
        state: "failed",
        kind: "invalid",
        action,
        message: `“${wanted}” isn't a GitHub repo. Paste a link like github.com/owner/name, or just owner/name.`,
      })
      field.current?.focus()
      return
    }
    if (action === "add" && !addToArchipelago(repo, location.search).ok) {
      setPhase({
        state: "failed",
        kind: "full",
        repo,
        action,
        message: `The archipelago holds ${MAX_ISLANDS} islands round the guild's, and it's full. Grow ${repo} on its own instead.`,
      })
      return
    }
    setPhase({ state: "checking", repo, action })
    try {
      const { treeFor } = await import("../world/gen/load.ts")
      const tree = await treeFor(repo)
      if (n !== asked.current) return
      if (tree.truncated && !force) {
        setPhase({ state: "truncated", repo: tree.repo, action })
        return
      }
      go(action, tree.repo)
    } catch (error) {
      if (n !== asked.current) return
      const failure = error as Error & { kind?: RepoFailure; resetAt?: Date }
      setPhase({
        state: "failed",
        kind: failure.kind ?? "network",
        repo,
        action,
        message: failure.message,
        ...(failure.resetAt ? { resetAt: failure.resetAt } : {}),
      })
    }
  }

  function go(action: Action, repo: string) {
    setPhase({ state: "going", repo, action })
    const added = addToArchipelago(repo, location.search)
    const search = action === "add" && added.ok ? added.search : islandLink(repo, location.search)
    location.assign(`${location.pathname}${search}`)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!busy) void run("visit")
  }

  function example(repo: string) {
    if (busy) return
    setText(repo)
    void run("visit", repo)
  }

  async function share() {
    if (!subject) return
    const link = `${location.origin}${location.pathname}${shareLink(subject, location.search)}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied("done")
    } catch {
      setCopied(fallbackCopy(link) ? "done" : "failed")
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      repoDoor.close()
      return
    }
    // Keep Tab inside while it is open (hud/focus.ts).
    if (event.key !== "Tab" || !panel.current) return
    const stops = tabStops(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    const to = wrapOf(stops, document.activeElement, event.shiftKey)
    if (!to) return
    event.preventDefault()
    to.focus()
  }

  const fieldError =
    phase.state === "failed" &&
    (phase.kind === "empty" || phase.kind === "invalid" || phase.kind === "missing")

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim's click is a mouse shortcut; Esc and the close button are the keyboard's
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className="door-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) repoDoor.close()
      }}
    >
      <div
        ref={panel}
        className="plaque door"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        aria-describedby={`${id}-d`}
        onKeyDown={onKeyDown}
      >
        <header className="door-head">
          <span className="door-mark" aria-hidden="true">
            <Icon.island />
          </span>
          <div className="door-titles">
            <h2 id={`${id}-h`}>Your repo as an island</h2>
            <p id={`${id}-d`} className="door-lede">
              Paste a public GitHub repo, as a link or owner/name. Its folders become districts, coloured by
              their main language.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn door-close"
            onClick={repoDoor.close}
            aria-label="Close (Esc)"
          >
            <Icon.close />
          </button>
        </header>

        <form className="door-form" onSubmit={submit} aria-busy={busy} noValidate>
          <label htmlFor={`${id}-f`} className="door-label">
            GitHub repo
          </label>
          <div className="door-row">
            <input
              ref={field}
              id={`${id}-f`}
              className="door-field"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="github.com/owner/name"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                // A new repo typed drops what was said about the last, and a check still waiting on it.
                if (phase.state === "going") return
                if (phase.state === "checking") asked.current++
                if (phase.state !== "idle") setPhase({ state: "idle" })
              }}
              aria-invalid={fieldError || undefined}
              aria-describedby={`${id}-s`}
            />
            <button type="submit" className="door-go" aria-disabled={busy || undefined}>
              {busy && phase.action === "visit" ? "Growing…" : "Grow"}
            </button>
          </div>

          <div className="door-examples">
            <span className="door-try" id={`${id}-t`}>
              Try
            </span>
            <ul aria-labelledby={`${id}-t`}>
              {EXAMPLES.map(({ repo, label }) => (
                <li key={repo}>
                  <button
                    type="button"
                    className="door-chip"
                    aria-label={`Grow ${repo}`}
                    title={repo}
                    aria-current={repo.toLowerCase() === current?.toLowerCase() ? "true" : undefined}
                    onClick={() => example(repo)}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div id={`${id}-s`} className="door-status" role="status" aria-live="polite">
            <StatusLine phase={phase} onRetry={(p) => void run(p.action, p.repo ?? text)} onAnyway={go} />
          </div>
        </form>

        <footer className="door-foot">
          <button type="button" className="door-act" onClick={share} disabled={!subject}>
            {copied === "done" ? <Icon.check /> : <Icon.link />}
            <span>
              {copied === "done" ? "Link copied" : copied === "failed" ? "Couldn't copy" : "Copy link"}
            </span>
          </button>
          <button
            type="button"
            className="door-act"
            onClick={() => !busy && void run("add", subject ?? text)}
            disabled={!subject}
            aria-disabled={busy || undefined}
          >
            <Icon.plus />
            <span>{busy && phase.action === "add" ? "Adding…" : "Add to archipelago"}</span>
          </button>
          <p className="door-fine">
            Public repos only. GitHub allows 60 calls an hour without sign-in; each new repo takes two.
          </p>
        </footer>
        <span className="visually-hidden" aria-live="polite">
          {copied === "done" && subject ? `Link to ${subject}'s island copied` : ""}
        </span>
      </div>
    </div>
  )
}

function StatusLine({
  phase,
  onRetry,
  onAnyway,
}: {
  phase: Phase
  onRetry: (phase: Extract<Phase, { state: "failed" }>) => void
  onAnyway: (action: Action, repo: string) => void
}) {
  if (phase.state === "idle") return null
  if (phase.state === "checking" || phase.state === "going")
    return (
      <div className="door-note" data-tone="busy">
        <span className="door-bar" aria-hidden="true">
          <i />
        </span>
        <p>
          {phase.state === "checking" ? (
            <>
              Reading <b>{phase.repo}</b>'s tree…
            </>
          ) : (
            <>
              {phase.action === "add" ? "Charting the archipelago with " : "Growing "}
              <b>{phase.repo}</b>
              {phase.action === "add" ? "…" : "'s island…"}
            </>
          )}
        </p>
      </div>
    )
  if (phase.state === "truncated")
    return (
      <div className="door-note" data-tone="warn">
        <p>
          <b>{phase.repo}</b> is too big for one listing: GitHub sent only part of its tree, so the island
          will show part of the repo.
        </p>
        <button type="button" className="door-retry" onClick={() => onAnyway(phase.action, phase.repo)}>
          Grow it anyway
        </button>
      </div>
    )
  const retry = phase.kind === "rate" || phase.kind === "network" || phase.kind === "github"
  return (
    <div className="door-note" data-tone="fail">
      <p>
        <b>{headline(phase)}</b> {detail(phase)}
      </p>
      {retry && (
        <button type="button" className="door-retry" onClick={() => onRetry(phase)}>
          <Icon.retry />
          Try again
        </button>
      )}
    </div>
  )
}

function headline(phase: Extract<Phase, { state: "failed" }>): string {
  switch (phase.kind) {
    case "empty":
      return "Nothing to grow yet."
    case "invalid":
      return "Not a repo link."
    case "missing":
      return "Not found, or private."
    case "rate":
      return "GitHub needs a breather."
    case "network":
      return "Couldn't reach GitHub."
    case "full":
      return "The map is full."
    default:
      return "GitHub said no."
  }
}

function detail(phase: Extract<Phase, { state: "failed" }>): string {
  switch (phase.kind) {
    case "empty":
    case "full":
      return phase.message
    case "invalid":
      return phase.message.startsWith("“") ? phase.message : `${phase.message}.`
    case "missing":
      return `GitHub has no public repo called ${phase.repo}. The hall can only read public repos; check the spelling, or make it public.`
    case "rate":
      return `Its limit for visitors (60 calls an hour) is used up${resetText(phase.resetAt)}. Bundled examples still work.`
    case "network":
      return "Check the connection, then try again."
    default:
      return `${phase.message}.`
  }
}

/** " — it resets at 14:05, in 23 min" in the viewer's own clock. */
function resetText(at: Date | undefined): string {
  if (!at) return ""
  const minutes = Math.max(1, Math.ceil((at.getTime() - Date.now()) / 60_000))
  const clock = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return `; it resets at ${clock}, in ${minutes} min`
}

function validRepo(text: string): string | undefined {
  if (!text.trim()) return undefined
  try {
    return parseRepo(text)
  } catch {
    return undefined
  }
}

/** For browsers that refuse the async clipboard (an insecure origin, an old WebView). */
function fallbackCopy(text: string): boolean {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
