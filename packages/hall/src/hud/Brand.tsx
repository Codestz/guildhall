import { useEffect, useState } from "react"
import { useGuild } from "../guild/useGuild.ts"
import { Icon } from "./icons.tsx"

const SNIPPET = `"plugin": ["opencode-guildhall"]`

/** Who we are, the honest "this is a simulation" line, and the one-line install. */
export function Brand() {
  const store = useGuild()
  const [copied, setCopied] = useState(false)

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

  return (
    <header className="plaque brand">
      <div className="brand-mark">
        <span className="crest">
          <Icon.crest />
        </span>
        <div>
          <h1>Guildhall</h1>
          <p className="tagline">Your OpenCode agents, as a living guild.</p>
        </div>
      </div>

      {store.mode === "live" ? (
        <div className="sim">
          <span className="sim-badge" data-live={store.connected}>
            <i aria-hidden="true" />
            {store.connected
              ? `Live · ${store.guild || "waiting for OpenCode"}`
              : "Live · connecting to the hub…"}
          </span>
          <p className="sim-note">
            {store.connected
              ? "Your OpenCode agents, as they work."
              : "Start OpenCode with the guildhall plugin; the hub starts with it."}
          </p>
        </div>
      ) : (
        <div className="sim">
          <span className="sim-badge">
            <i aria-hidden="true" />
            Simulated guild · not live
          </span>
          <p className="sim-note">A scripted run. Installed, the hall shows your own agents as they work.</p>
        </div>
      )}

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
    </header>
  )
}
