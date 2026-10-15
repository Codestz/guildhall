/**
 * "Connect a source": how to point the island at your own agents. A source (Claude Code's hook, OpenCode's
 * plugin, your own adapter) sends events to a small hub on your machine and the hall reads it live. Said
 * plainly: live works only on localhost (the hub answers local origins only), so this public site shows
 * demos and chronicles, never anyone's sessions. A modal over the world, like the demo picker.
 */
import { useId, useRef } from "react"
import { Kbd } from "../components/controls.tsx"
import { useDialog } from "./hooks.ts"
import { CloseGlyph } from "./parts.tsx"

export interface SourcesCardProps {
  onClose(): void
  /** Where the hub the visitor runs listens, shown in the steps (the hub's own default). */
  hub?: string
}

const SOURCES: readonly { name: string; line: string }[] = [
  {
    name: "Claude Code",
    line: "Every session and subagent, through a hook that runs on each of its events.",
  },
  { name: "OpenCode", line: "Every session an adventurer, through the opencode-guildhall plugin." },
  {
    name: "GitHub",
    line: "Commits, pull requests, CI and releases as ships, when a project's remote is on GitHub.",
  },
  { name: "Your own", line: "Anything that can POST JSON to the hub is a source." },
]

export function SourcesCard({ onClose, hub = "127.0.0.1:4747" }: SourcesCardProps) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  useDialog(panel, true, onClose, () => panel.current?.querySelector<HTMLElement>("[data-close]"))
  return (
    <div className="site-layer">
      <div className="site-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="ui-panel site-sources"
        data-solid=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
      >
        <header className="site-demos-head">
          <div>
            <p className="ui-eyebrow">Sources</p>
            <h2 className="site-demos-title" id={`${id}-h`}>
              Set up a source
            </h2>
          </div>
          <button type="button" className="ui-icon-btn" data-close="" aria-label="Close" onClick={onClose}>
            <CloseGlyph size={16} />
          </button>
        </header>
        <div className="site-sources-scroll">
          <p className="site-sources-lede">
            The island shows what your agents do as they do it. A source sends its events to a small hub on
            your own machine, and the hall reads the hub live.
          </p>
          <ul className="site-sources-list" aria-label="Sources">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <b>{s.name}</b>
                <span>{s.line}</span>
              </li>
            ))}
          </ul>
          <ol className="site-steps">
            <li>
              <b>Run the hub.</b> From a clone, <code>bun live/hub/src/main.ts</code>; it listens on{" "}
              <code>{hub}</code>. Claude Code's hook starts it for you the first time it is needed.
            </li>
            <li>
              <b>Add a source.</b> For Claude Code, from the same clone,{" "}
              <code>bun live/claude-code/src/install.ts --print</code> and merge the hooks it prints into your
              Claude Code settings (it only prints, it never edits them). For OpenCode, add{" "}
              <code>"plugin": ["opencode-guildhall"]</code> to <code>opencode.json</code>.
            </li>
            <li>
              <b>Open your repo's hall on localhost.</b> Run the Studio (<code>bun run dev</code>) and open{" "}
              <code>/hall/owner/repo?feed=live</code>. Heroes appear as sessions start; <Kbd>H</Kbd> hides the
              HUD.
            </li>
          </ol>
          <p className="site-sources-note">
            <b>Live works only on localhost.</b> The hub answers local origins only, so this public site shows
            demos and chronicles but never your sessions, and nothing leaves your machine.
          </p>
        </div>
      </div>
    </div>
  )
}
