/**
 * The session parts of the hall's HUD (plan-hud-events H1, `?feed=`): the Roster of heroes on the
 * island, the Pleas pinned as brass cards, a hero's Dossier in the sheet, and the Brand's source (Live ●,
 * Replay, Story, Offline). They read the session's 10 Hz snapshot (hall/feeds/session.ts) and draw the
 * ui's own components; HallHud.tsx places them in the Viewer's regions with the history's panels.
 */
import type { SourceState } from "@guildhall/ui"
import { Dossier, type HeroView, Pleas, Roster } from "@guildhall/ui"
import { useMemo, useSyncExternalStore } from "react"
import type { SessionPlaces } from "../feeds/places.ts"
import type { HallSession, SessionSnapshot } from "../feeds/session.ts"
import { dossierOf, partiesOf, pleaViews, rosterOf } from "../feeds/view.ts"

/** The session as the HUD sees it: the session, its places, and the repo's name (for short paths). */
export interface HudSession {
  session: HallSession
  places: SessionPlaces
  repo: string
}

export const useSnapshot = (session: HallSession): SessionSnapshot =>
  useSyncExternalStore(session.subscribe, session.snapshot)

/** What the Brand says of the source: Live ● (connecting, lost), Replay, Story. */
export function sourceOf(snap: SessionSnapshot): SourceState {
  if (snap.kind === "live")
    return {
      kind: "live",
      link: snap.status === "live" ? "connected" : snap.status === "connecting" ? "connecting" : "lost",
      name: snap.name,
    }
  return { kind: snap.kind, name: snap.name }
}

/** The Brand's status words after the source: `3 heroes`, or why there is nothing (`no recording`). */
export function sessionStatus(snap: SessionSnapshot): string {
  if (snap.status === "offline" && snap.kind !== "live")
    return snap.note ? `offline · ${snap.note}` : "offline"
  if (snap.status === "connecting") return snap.kind === "live" ? "" : "reading…"
  let n = 0
  for (const a of snap.world.actors.values()) if (a.gone === undefined) n++
  return `${n} ${n === 1 ? "hero" : "heroes"}`
}

/** Who waits on a human now. */
export function pleaCount(snap: SessionSnapshot): number {
  let n = 0
  for (const a of snap.world.actors.values()) if (a.plea !== undefined && a.gone === undefined) n++
  return n
}

export function useRoster(
  hud: HudSession,
  snap: SessionSnapshot,
): {
  heroes: HeroView[]
  parties: ReturnType<typeof partiesOf>
  pleas: ReturnType<typeof pleaViews>
} {
  return useMemo(() => {
    const t = snap.clock.at
    return {
      heroes: rosterOf(snap.world, t, hud.places.name),
      parties: partiesOf(snap.world, t),
      pleas: pleaViews(snap.world, t, hud.places.name),
    }
  }, [snap, hud.places])
}

export function RosterPanel({
  hud,
  snap,
  following = null,
  picked,
  onCamera = null,
  onPick,
  onClose,
}: {
  hud: HudSession
  snap: SessionSnapshot
  /** The party followed (the party tabs), or null for all. */
  following?: string | null
  picked: string | null
  /** Who the camera follows (an eye by their name). */
  onCamera?: string | null
  onPick: (id: string) => void
  onClose: () => void
}) {
  const { heroes, parties } = useRoster(hud, snap)
  return (
    <Roster
      heroes={heroes}
      parties={parties}
      following={following}
      onCamera={onCamera}
      selected={picked}
      open
      onToggle={onClose}
      onPick={(id) => (id ? onPick(id) : onClose())}
      className="hall-roster"
    />
  )
}

export function PleaCards({
  hud,
  snap,
  onOpen,
}: {
  hud: HudSession
  snap: SessionSnapshot
  onOpen: (id: string) => void
}) {
  const { pleas, parties } = useRoster(hud, snap)
  if (pleas.length === 0) return null
  return <Pleas pleas={pleas} parties={parties} onOpen={onOpen} />
}

export function HeroSheet({
  hud,
  snap,
  id,
  onClose,
  onBack,
}: {
  hud: HudSession
  snap: SessionSnapshot
  id: string
  onClose: () => void
  onBack?: () => void
}) {
  const view = useMemo(
    () =>
      dossierOf(snap.world, hud.session.model(), id, snap.clock.at, hud.places.name, {
        repo: hud.repo,
        ...(hud.places.placeOf ? { placeOf: hud.places.placeOf } : {}),
      }),
    [snap, hud, id],
  )
  if (!view) return <p className="hud-empty">This hero has left the island.</p>
  return (
    <div className="hall-hero-sheet">
      {onBack && (
        <button type="button" className="site-link hall-back" onClick={onBack}>
          ← The Guild
        </button>
      )}
      <Dossier {...view} onClose={onClose} />
    </div>
  )
}
