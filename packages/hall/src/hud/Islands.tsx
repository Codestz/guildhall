import { type CSSProperties, useEffect, useRef, useState } from "react"
import { islandView, useIslandView } from "../guild/islandView.ts"
import { useArchipelago, useArchipelagoStatus } from "../world/archipelagoSource.ts"
import { HOME, type Stop } from "../world/islandRing.ts"
import { Icon } from "./icons.tsx"
import { useSwipe } from "./islandTravel.tsx"
import { repoDoor } from "./RepoDoor.tsx"

/**
 * The archipelago's switcher (`?archipelago`, world/archipelagoSource.ts): a chip beside the repo's,
 * the island the camera is on and a chevron, opening the list — the map, then every island, the home
 * one first (where the guild lives), each in its main language's colour. Choosing one flies there
 * (scene/CameraRig.tsx). The keys (hud/islandTravel.tsx): M the map, 0 home, 1–6 the far islands, ← →
 * or [ ] the neighbours round the ring; on a phone, a swipe along the chip. Nothing without an
 * archipelago.
 */
export function IslandSwitcher({ compact = false }: { compact?: boolean }) {
  const archipelago = useArchipelago()
  const status = useArchipelagoStatus()
  const view = useIslandView()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const swipe = useSwipe()

  // Closed by a click elsewhere or Esc; the chip keeps the focus ring.
  useEffect(() => {
    if (!open) return
    const away = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", away)
    window.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("pointerdown", away)
      window.removeEventListener("keydown", key)
    }
  }, [open])

  if (status.state === "loading")
    return (
      <section className="plaque repo-legend repo-panel" aria-live="polite">
        <p className="repo-note">Charting the archipelago…</p>
      </section>
    )
  if (!archipelago) {
    if (status.state !== "ready" || status.failed.length === 0) return null
    return (
      <section className="plaque repo-legend repo-panel" role="status">
        <p className="repo-note">Couldn't chart the archipelago: {status.failed[0]?.reason}.</p>
      </section>
    )
  }

  const failed = status.state === "ready" ? status.failed : []
  const rows = [
    { stop: HOME as Stop, island: archipelago.home, key: "0" },
    ...archipelago.islands.map((island, i) => ({ stop: i as Stop, island, key: `${i + 1}` })),
  ]
  const here = view.stop === "map" ? undefined : rows.find((row) => row.stop === view.stop)?.island
  const fly = (stop: Stop) => {
    islandView.go(stop)
    setOpen(false)
  }
  return (
    <div className="island-switcher" ref={root}>
      <button
        type="button"
        className="plaque island-chip"
        aria-expanded={open}
        aria-controls="island-list"
        aria-label={`Island: ${here?.name ?? "the map"}. Switch island`}
        title="Switch island · ← → · M map"
        onClick={() => !swipe.swiped() && setOpen(!open)}
        {...swipe.handlers}
      >
        {here ? (
          <i className="repo-swatch" aria-hidden="true" style={{ background: here.language.colour }} />
        ) : (
          <MapGlyph />
        )}
        <span className="island-chip-name">{here?.name ?? "The map"}</span>
        <span className="fold" aria-hidden="true">
          <Icon.chevron />
        </span>
      </button>
      <nav
        className="plaque islands island-list"
        id="island-list"
        aria-label="Archipelago"
        data-compact={compact}
        hidden={!open}
      >
        <ul className="party-list">
          <li>
            <button
              type="button"
              className="party-row island-row island-map"
              aria-pressed={view.stop === "map"}
              onClick={() => fly(view.stop === "map" ? HOME : "map")}
              title="The map of every island · M"
            >
              <MapGlyph />
              <span className="party-name">Map</span>
              {!compact && <kbd>M</kbd>}
            </button>
          </li>
          {rows.map(({ stop, island, key }) => (
            <li key={island.repo}>
              <button
                type="button"
                className="party-row island-row"
                aria-pressed={view.stop === stop}
                onClick={() => fly(stop)}
                aria-label={`${island.repo}, ${island.language.name}${stop === HOME ? ", the guild's island" : ""}. Fly there (${key}).`}
                title={`${island.repo} · ${key}`}
                style={{ "--banner": island.language.colour } as CSSProperties}
              >
                <i
                  className="repo-swatch"
                  aria-hidden="true"
                  style={{ background: island.language.colour }}
                />
                <span className="party-name">{island.name}</span>
                {!compact && (
                  <span className="party-state">{stop === HOME ? "the guild" : island.language.name}</span>
                )}
                {!compact && <kbd>{key}</kbd>}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="party-row island-row island-add"
              aria-haspopup="dialog"
              onClick={repoDoor.open}
              aria-label="Add an island: grow your repo"
              title="Add an island"
            >
              <Icon.plus />
              <span className="party-name">Add an island</span>
            </button>
          </li>
        </ul>
        {!compact && (
          <p className="repo-note island-hint">
            <kbd>←</kbd> <kbd>→</kbd> hop to the next island
          </p>
        )}
        {failed.length > 0 && !compact && (
          <p className="repo-note island-failed">
            Left out: {failed.map((one) => one.repo).join(", ")} ({failed[0]?.reason})
          </p>
        )}
      </nav>
    </div>
  )
}

function MapGlyph() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1.5 3.5 5.5 2l5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5zM5.5 2v10.5M10.5 3.5V14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
