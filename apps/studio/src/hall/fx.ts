/**
 * The hall's session drives the island's event FX (render events/, F1): twice a second, not every
 * frame, it reads the world at the session's clock (`log().stateAt(clock.at)`) and hands the FX what it
 * says. CI is the weather (`weatherOf`), each open pull request a ship at the harbour (`harbourOf`: a
 * new one sails in, a vanished one leaves, merged or closed by the merged count), and a place where a
 * hero is at work raises a scaffold. A scrub or a new log reads the same way, so the FX follow the bar.
 * The ships sail at the clock's rate (`fleetRate`): a replay at 4× sails them 4× as fast, a paused one
 * holds them where they are.
 */

import type { WeatherKind } from "@guildhall/render"
import { harbourOf, heroes } from "@guildhall/sim"
import type { Fx } from "../hexworld/fx.ts"
import type { SessionClockState } from "./feeds/clock.ts"
import type { HallSession } from "./feeds/index.ts"

/** How often the FX read the session, ms. */
export const FX_READ_MS = 500

/** How fast the ships' voyages run for a session clock: live 1, a playing replay its rate, paused 0. */
export function fleetRate(clock: Pick<SessionClockState, "mode" | "playing" | "rate">): number {
  if (clock.mode === "live") return 1
  return clock.playing ? clock.rate : 0
}

/** `pin`: a weather the viewer picked (Settings), over what the session says; null follows the session. */
export function driveFx(fx: Fx, session: HallSession, pin?: () => WeatherKind | null): () => void {
  let jumps = session.clock.get().jumps
  const follow = () => fx.ships?.setRate(fleetRate(session.clock.get()))
  follow()
  const offClock = session.clock.subscribe(follow)
  const read = () => {
    const clock = session.clock.get()
    const at = clock.at
    // a seek that lands at once: the harbour is as it is there, not sailed into
    if (clock.jumps !== jumps) fx.ships?.reset()
    jumps = clock.jumps
    const world = session.log().stateAt(at)
    const harbour = harbourOf(world)
    fx.drive.set(pin?.() ?? harbour.weather)
    fx.ships?.update(harbour)
    const busy = new Set<string>()
    for (const h of heroes(world, at))
      if (h.place !== undefined && h.status === "working") {
        const id = fx.placeId(String(h.place))
        if (id) busy.add(id)
      }
    fx.scaffolds?.set(busy)
  }
  read()
  const timer = setInterval(read, FX_READ_MS)
  const offReset = session.onReset(() => {
    fx.ships?.reset()
    read()
  })
  return () => {
    clearInterval(timer)
    offReset()
    offClock()
    fx.ships?.setRate(1)
  }
}
