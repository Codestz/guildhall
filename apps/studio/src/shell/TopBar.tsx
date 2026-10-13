import { useEffect, useRef, useState } from "react"
import { holdStudioStyle } from "../browser/style.ts"
import { SHOWCASE } from "../env.ts"
import { HOME_ID, linkTo, placeOf } from "./directory.ts"
import { Mark, MOD_KEY, SearchIcon } from "./icons.tsx"
import { follow, go } from "./nav.ts"
import { Switcher } from "./Switcher.tsx"
import { addShellStyle } from "./style.ts"

/**
 * The bar above every screen: the Guildhall mark (home), where you are, the quick switcher
 * (Cmd/Ctrl+K) and the perf HUD toggle (also the backquote key). It never overlaps a screen: the
 * shell starts the screen host BAR_PX below the top.
 */
export function TopBar({
  screen,
  title,
  hud,
  onHud,
}: {
  /** The open screen's id. */
  screen: string
  /** The screen's own title, for an id the directory does not list. */
  title: string
  hud: boolean
  onHud(on: boolean): void
}) {
  addShellStyle()
  // The `.gh` tokens and faces the bar is drawn in, held for as long as the bar is up.
  useEffect(() => holdStudioStyle().release, [])
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const place = placeOf(screen)
  const name = place?.tool.name ?? title

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((was) => !was)
      }
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <>
      <header className="gh gh-top">
        <a
          className="gh-mark"
          href={linkTo(HOME_ID)}
          onClick={follow(HOME_ID)}
          aria-label="Guildhall Studio home"
        >
          <Mark />
          <b>
            Guildhall <span>Studio</span>
          </b>
        </a>
        {screen !== HOME_ID && (
          <div className="gh-crumb">
            {place?.group && (
              <>
                <span className="group">{place.group.name}</span>
                <span className="sep" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <span className="name" aria-current="page">
              {name}
            </span>
          </div>
        )}
        <span className="spacer" />
        {SHOWCASE && (
          <span
            className="gh-showcase"
            title="A public build: nothing saves here; saves download JSON instead."
          >
            Showcase · read-only
          </span>
        )}
        <button
          ref={trigger}
          type="button"
          className="gh-jump"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label="Jump to a tool"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <SearchIcon />
          <span className="label">Jump to a tool…</span>
          <span className="gh-kbd">{MOD_KEY} K</span>
        </button>
        {screen !== HOME_ID && (
          <button
            type="button"
            className="gh-led"
            aria-pressed={hud}
            onClick={() => onHud(!hud)}
            title="Frame stats (` key)"
            aria-keyshortcuts="`"
          >
            <span className="led" aria-hidden="true" />
            perf
          </button>
        )}
      </header>
      {open && (
        <Switcher
          current={screen}
          onClose={close}
          onOpen={(id) => {
            setOpen(false)
            go(id)
          }}
        />
      )}
    </>
  )
}
