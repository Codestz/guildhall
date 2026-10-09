import { Fragment, useEffect, useState } from "react"
import type { GuildStore } from "../guild/store.ts"
import { sitePage } from "./directing.ts"
import { Icon } from "./icons.tsx"
import { repoDoor } from "./RepoDoor.tsx"
import "./wayfinding.css"

/** The project's home on GitHub; the protocol doc for "your own" sources lives there. */
const PROTOCOL_URL = "https://github.com/Codestz/guildhall/blob/main/packages/core/PROTOCOL.md"

/** What can feed the world. `soon` marks a source that is announced but not shipped yet. */
const SOURCES: { name: string; soon?: boolean }[] = [
  { name: "OpenCode" },
  { name: "Claude Code" },
  { name: "GitHub" },
  { name: "Git history", soon: true },
  { name: "Your own" },
]

/** The site's other pages (hud/directing.ts sitePage), at the foot of the about card. */
const PAGES = [
  { path: "/demos", label: "Demos", note: "Every scene" },
  { path: "/harbour", label: "Harbour", note: "Chronicled repos" },
  { path: "/how", label: "How it's built", note: "Crowds, WebGPU, measured" },
] as const

/**
 * Who we are, in one line: the crest, the name and a status line that says honestly what is on
 * screen (a simulated guild, or your live one). Unfolds into the about card: the headline, what can
 * feed the world, and the install lines folded behind "Set up a source" so the card stays light.
 */
export function Brand({ store, open, onToggle }: { store: GuildStore; open: boolean; onToggle: () => void }) {
  const count = store.views.length
  const pleas = store.views.filter((v) => v.phase === "waiting").length
  const live = store.mode === "live"

  const source = live
    ? store.connected
      ? `Live · ${store.guild || "waiting for a source"}`
      : "Live · connecting…"
    : "Simulated guild"

  return (
    <header className="plaque brand" data-open={open}>
      <h1 className="brand-h">
        <button
          type="button"
          className="brand-btn"
          aria-expanded={open}
          aria-controls="brand-about"
          onClick={onToggle}
        >
          <span className="crest">
            <Icon.crest />
          </span>
          <span className="brand-words">
            <span className="brand-name">Guildhall</span>
            <span className="status-line">
              <i
                className="source-dot"
                data-live={live}
                data-connected={store.connected}
                aria-hidden="true"
              />
              <span className="source">{source}</span>
              <span className="sl-part sl-count">
                {count} {count === 1 ? "adventurer" : "adventurers"}
              </span>
              {pleas > 0 && (
                <span className="sl-part sl-plea">
                  {pleas} {pleas === 1 ? "plea" : "pleas"}
                </span>
              )}
            </span>
          </span>
          <span className="fold" aria-hidden="true">
            <Icon.chevron />
          </span>
        </button>
      </h1>

      <div className="about" id="brand-about" hidden={!open}>
        <p className="tagline">Events in. A living world out.</p>
        <p className="sim-note">
          {live
            ? store.connected
              ? "Your own events, as they happen, played out as an island."
              : "Start OpenCode or Claude Code with Guildhall; the hub starts with it."
            : "Any event stream becomes a living 3D island. This one is simulated."}
        </p>
        <div className="sources">
          <span className="sources-label" id="sources-label">
            Sources
          </span>
          <ul className="sources-list" aria-labelledby="sources-label">
            {SOURCES.map((s) => (
              <li key={s.name}>
                {s.name}
                {s.soon && <span className="sources-soon">soon</span>}
              </li>
            ))}
          </ul>
        </div>
        <DoorLink />
        <details className="setup">
          <summary>
            <Icon.chevron />
            Set up a source
          </summary>
          <div className="setup-body">
            <Snippet
              name="OpenCode"
              label="OpenCode · add to opencode.json"
              code={`"plugin": ["opencode-guildhall"]`}
            />
            <Snippet
              name="Claude Code"
              label="Claude Code · install, then merge the printed hooks"
              code={"npm i -g opencode-guildhall\nopencode-guildhall claude-code --print"}
            />
            <p className="setup-note">
              <b>GitHub</b> joins on its own when the project's remote is on GitHub. <b>Your own</b>: post
              events to the hub, as the{" "}
              <a href={PROTOCOL_URL} target="_blank" rel="noopener noreferrer">
                world protocol
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>{" "}
              describes.
            </p>
          </div>
        </details>
        <nav className="about-nav" aria-label="Guildhall">
          {PAGES.map(({ path, label, note }) => {
            const page = sitePage(path)
            return (
              <a
                key={path}
                href={page.href}
                {...(page.away ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <b>{label}</b>
                <span>{note}</span>
                {page.away && <span className="visually-hidden"> (opens in a new tab)</span>}
              </a>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

/** One copyable install line, with its own "copied" state and a polite announcement. */
function Snippet({ name, label, code }: { name: string; label: string; code: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="install">
      <span className="install-label">{label}</span>
      <div className="install-row">
        <code className="install-code">
          {code.split("\n").map((line) => (
            <span key={line} className="code-line">
              {line.split(" ").map((token, t) => (
                // Tokens never break inside (`--print` would split at its first hyphen); lines break at spaces.
                <Fragment key={token}>
                  {t > 0 && " "}
                  <span className="code-tok">{token}</span>
                </Fragment>
              ))}
            </span>
          ))}
        </code>
        <button
          type="button"
          className="icon-btn copy"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy the ${name} setup`}
          data-done={copied}
        >
          {copied ? <Icon.check /> : <Icon.copy />}
        </button>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  )
}

/** The repo door's way in (hud/RepoDoor.tsx), shared by the about card and Settings. */
export function DoorLink() {
  return (
    <button type="button" className="set-link door-link" aria-haspopup="dialog" onClick={repoDoor.open}>
      <Icon.island />
      <span className="toggle-text">
        <b>Your repo as an island</b>
        <span>Grow one from any public GitHub repo</span>
      </span>
      <Icon.chevron />
    </button>
  )
}
