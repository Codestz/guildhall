import { useEffect, useState } from "react"
import type { GuildStore } from "../guild/store.ts"
import { Icon } from "./icons.tsx"

const SNIPPET = `"plugin": ["opencode-guildhall"]`

/**
 * Who we are, in one line: the crest, the name and a status line that says honestly what is on
 * screen (a simulated guild, or your live one). Unfolds into the about card with the install line.
 */
export function Brand({ store, open, onToggle }: { store: GuildStore; open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false)
  const count = store.views.length
  const pleas = store.views.filter((v) => v.phase === "waiting").length
  const live = store.mode === "live"

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(SNIPPET)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const source = live
    ? store.connected
      ? `Live · ${store.guild || "waiting for OpenCode"}`
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
        <p className="tagline">Your OpenCode agents, as a living guild.</p>
        <p className="sim-note">
          {live
            ? store.connected
              ? "What you see is your own OpenCode agents, as they work."
              : "Start OpenCode with the guildhall plugin; the hub starts with it."
            : "A scripted run, not live telemetry. Installed, the hall shows your own agents as they work."}
        </p>
        <div className="install">
          <span className="install-label">
            Add to <code>opencode.json</code>
          </span>
          <div className="install-row">
            <code className="install-code">{SNIPPET}</code>
            <button
              type="button"
              className="icon-btn copy"
              onClick={copy}
              aria-label={copied ? "Copied" : "Copy install line"}
              data-done={copied}
            >
              {copied ? <Icon.check /> : <Icon.copy />}
            </button>
          </div>
          <span className="visually-hidden" aria-live="polite">
            {copied ? "Install line copied to clipboard" : ""}
          </span>
        </div>
      </div>
    </header>
  )
}
