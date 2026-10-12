import { useEffect } from "react"
import { dismissInvite } from "../guild/homeShow.ts"
import { islandView } from "../guild/islandView.ts"
import { useArchipelago } from "../world/archipelagoSource.ts"
import { Icon } from "./icons.tsx"
import { repoDoor } from "./RepoDoor.tsx"
import "./home.css"

/**
 * The home's invitation (guild/homeShow.ts), once the camera has settled on the archipelago: what
 * this is, honestly, and two ways on. "Try your repo" opens the repo door; "See the archipelago map"
 * flies the camera up over all the islands (only where there are islands). Either, or the close
 * button, puts the card away for the visit.
 */
export function HomeInvite({ phone }: { phone: boolean }) {
  const archipelago = useArchipelago()

  // Esc puts it away.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissInvite()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  return (
    <aside className="plaque home-invite" data-phone={phone} aria-label="About this view">
      <p className="home-invite-text">
        <b>React, as an archipelago.</b>{" "}
        <span>
          Each package is an island, bridged where they lean on each other. The adventurers are simulated.
        </span>
      </p>
      <span className="home-invite-actions">
        <button
          type="button"
          className="home-try"
          aria-haspopup="dialog"
          onClick={() => {
            dismissInvite()
            repoDoor.open()
          }}
        >
          Try your repo
          <span aria-hidden="true">→</span>
        </button>
        {archipelago && (
          <button
            type="button"
            className="caption-link"
            onClick={() => {
              dismissInvite()
              islandView.go("map")
            }}
          >
            See the archipelago map
          </button>
        )}
      </span>
      <button
        type="button"
        className="icon-btn caption-close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={dismissInvite}
      >
        <Icon.close />
      </button>
    </aside>
  )
}
