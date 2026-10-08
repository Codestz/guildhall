import { type CSSProperties, useEffect, useRef } from "react"
import { HOME, islandView, type Stop, useIslandView } from "../scene/archipelago/view.ts"
import { archipelagoSource, useArchipelago, useArchipelagoStatus } from "../world/archipelagoSource.ts"
import { Icon } from "./icons.tsx"
import { repoDoor } from "./RepoDoor.tsx"

/**
 * The archipelago's switcher (`?archipelago`, world/archipelagoSource.ts): the map, then every
 * island — the home one first, where the guild lives — each in its main language's colour, the one
 * the camera is on pressed. Choosing one flies there (scene/CameraRig.tsx); M opens the map (and,
 * on the map, goes back), 0 is home, 1–6 the far islands in order. Nothing without an archipelago.
 */
export function IslandSwitcher({ compact = false }: { compact?: boolean }) {
  const archipelago = useArchipelago()
  const status = useArchipelagoStatus()
  const view = useIslandView()

  if (status.state === "loading")
    return (
      <section className="plaque repo-legend" aria-live="polite">
        <p className="repo-note">Charting the archipelago…</p>
      </section>
    )
  if (!archipelago) {
    if (status.state !== "ready" || status.failed.length === 0) return null
    return (
      <section className="plaque repo-legend" role="status">
        <p className="repo-note">Couldn't chart the archipelago: {status.failed[0]?.reason}.</p>
      </section>
    )
  }

  const failed = status.state === "ready" ? status.failed : []
  const rows = [
    { stop: HOME as Stop, island: archipelago.home, key: "0" },
    ...archipelago.islands.map((island, i) => ({ stop: i as Stop, island, key: `${i + 1}` })),
  ]
  return (
    <nav className="plaque islands" aria-label="Archipelago" data-compact={compact}>
      <ul className="party-list">
        <li>
          <button
            type="button"
            className="party-row island-row island-map"
            aria-pressed={view.stop === "map"}
            onClick={() => islandView.go(view.stop === "map" ? HOME : "map")}
            title="The map of every island · M"
          >
            <MapGlyph />
            <span className="party-name">Map</span>
            {!compact && <kbd>M</kbd>}
          </button>
        </li>
        {rows.map(({ stop, island, key }) => {
          const on = view.stop === stop
          return (
            <li key={island.repo}>
              <button
                type="button"
                className="party-row island-row"
                aria-pressed={on}
                onClick={() => islandView.go(stop)}
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
              </button>
            </li>
          )
        })}
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
            {!compact && <span className="party-name">Add an island</span>}
          </button>
        </li>
      </ul>
      {failed.length > 0 && !compact && (
        <p className="repo-note island-failed">
          Left out: {failed.map((one) => one.repo).join(", ")} ({failed[0]?.reason})
        </p>
      )}
    </nav>
  )
}

/**
 * The switcher's keys, listened to whatever the HUD shows (the hidden HUD too): M the map (back
 * from it to where you were), 0 home, 1–6 the far islands.
 */
export function IslandKeys() {
  const before = useRef<Stop>(HOME)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const archipelago = archipelagoSource.archipelago
      if (!archipelago || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && /input|textarea|select/i.test(target.tagName)) return
      // A modal (the Legends, the repo door) keeps its keys to itself.
      if (target instanceof HTMLElement && target.closest('[aria-modal="true"]')) return
      const now = islandView.get().stop
      if (event.key === "m" || event.key === "M") {
        if (now === "map") islandView.go(before.current)
        else {
          before.current = now
          islandView.go("map")
        }
        return
      }
      if (!/^[0-9]$/.test(event.key)) return
      const n = Number(event.key)
      if (n === 0) islandView.go(HOME)
      else if (n <= archipelago.islands.length) islandView.go(n - 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return null
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
