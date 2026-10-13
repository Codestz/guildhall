/**
 * The brand crest, top-left, and the menu it opens: Your repo, Demos, Studio, How it's built, and a hint
 * for the command palette (⌘K). A modal layer while open: focus moves into it and wraps, ↑ ↓ Home End move
 * between the entries, Esc or a click outside closes it and focus returns to the crest. On a phone it is a
 * full-width sheet from the bottom, like the HUD's panels.
 */
import { useId, useRef, useState } from "react"
import { Kbd } from "../components/controls.tsx"
import { Crest } from "../hud/glyphs.tsx"
import { focusables, useDialog } from "./hooks.ts"
import { BookGlyph, Dest, FlagGlyph, RepoGlyph, StudioGlyph } from "./parts.tsx"

export type SiteDest = "repo" | "demos" | "studio" | "built"

const ENTRIES: readonly { id: SiteDest; label: string; hint: string; glyph: () => React.ReactNode }[] = [
  { id: "repo", label: "Your repo", hint: "Grow any public repo into an island", glyph: RepoGlyph },
  { id: "demos", label: "Demos", hint: "Stories, crowds and real repos, one link away", glyph: FlagGlyph },
  { id: "studio", label: "Studio", hint: "The workshop: pieces, tiles, people", glyph: StudioGlyph },
  { id: "built", label: "How it's built", hint: "The engineering, with the journey", glyph: BookGlyph },
]

export interface CrestMenuProps {
  onSelect(dest: SiteDest): void
  /** Real addresses per destination (middle-click, copy link). */
  hrefs?: Partial<Record<SiteDest, string>>
  /** Where you are now: marked in the list (and spoken). */
  current?: SiteDest
  /** Controlled open state; leave out to let the menu keep its own. */
  open?: boolean
  onOpenChange?(open: boolean): void
  /** The palette hint's keys; the shell binds them. */
  shortcut?: readonly string[]
  /** Makes the hint a button that opens the palette. */
  onPalette?(): void
}

export function CrestMenu({
  onSelect,
  hrefs,
  current,
  open: openProp,
  onOpenChange,
  shortcut = ["⌘", "K"],
  onPalette,
}: CrestMenuProps) {
  const id = useId()
  const [inner, setInner] = useState(false)
  const open = openProp ?? inner
  const set = (next: boolean) => {
    setInner(next)
    onOpenChange?.(next)
  }
  const panel = useRef<HTMLDivElement>(null)
  useDialog(
    panel,
    open,
    () => set(false),
    () => panel.current?.querySelector<HTMLElement>("[data-first]"),
  )

  const move = (e: React.KeyboardEvent) => {
    const node = panel.current
    if (!node || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return
    const items = focusables(node).filter((el) => el.dataset.item !== undefined)
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
    e.preventDefault()
    items[next]?.focus()
  }

  return (
    <div className="site-crestmenu">
      <button
        type="button"
        className="site-crest-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label="Guildhall menu"
        data-keepout=""
        onClick={() => set(!open)}
      >
        <span className="site-crest-mark" aria-hidden="true">
          <Crest size={22} />
        </span>
        <span className="site-crest-name">Guildhall</span>
      </button>
      {open && (
        <>
          <div className="site-scrim" data-soft="" aria-hidden="true" onClick={() => set(false)} />
          <div
            ref={panel}
            id={`${id}-menu`}
            className="ui-panel site-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Guildhall menu"
            onKeyDown={move}
          >
            <nav aria-label="Guildhall">
              <ul className="site-menu-list">
                {ENTRIES.map((entry, k) => (
                  <li key={entry.id}>
                    <Dest
                      href={hrefs?.[entry.id]}
                      onNavigate={() => {
                        set(false)
                        onSelect(entry.id)
                      }}
                      className="site-menu-item"
                      aria-current={current === entry.id ? "page" : undefined}
                      {...({ "data-item": "", "data-first": k === 0 ? "" : undefined } as object)}
                    >
                      <span className="site-menu-glyph">{entry.glyph()}</span>
                      <span className="site-menu-text">
                        <b>{entry.label}</b>
                        <small>{entry.hint}</small>
                      </span>
                      {current === entry.id && <span className="site-menu-here">Here</span>}
                    </Dest>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="site-menu-foot">
              {onPalette ? (
                <button
                  type="button"
                  className="site-menu-palette"
                  onClick={() => {
                    set(false)
                    onPalette()
                  }}
                >
                  Jump anywhere
                  <span className="site-keys">
                    {shortcut.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </button>
              ) : (
                <p className="site-menu-palette" data-static="">
                  Jump anywhere
                  <span className="site-keys">
                    {shortcut.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
