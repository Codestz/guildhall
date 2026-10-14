/**
 * The hall's session drives the sea's life (render sea/, world events Task D), as fx.ts drives the event
 * FX: twice a second it reads the world at the session's clock (`log().stateAt(clock.at)`) and tells
 * the sea what it says. A push sends a cargo ship out from the quay, the newest release brings the
 * galleon, the newest CI run lights the lighthouse. The sea's clock is the session's (`sync`), so the
 * voyages are where the bar says: a seek back shows the water as it was then, a replay at 4× sails 4×.
 * The world's shows (the ghost ship, the raid) come from the world-events engine (`setShows`).
 */
import type { SeaLife } from "@guildhall/render"
import { harbourOf } from "@guildhall/sim"
import type { HallSession } from "./feeds/index.ts"
import { FX_READ_MS, fleetRate } from "./fx.ts"

export function driveSea(sea: SeaLife, session: HallSession): () => void {
  let pushes: number | null = null
  let lastPush = 0
  const follow = () => {
    const clock = session.clock.get()
    sea.sync(clock.at, fleetRate(clock))
  }
  follow()
  const offClock = session.clock.subscribe(follow)
  const read = () => {
    const clock = session.clock.get()
    sea.sync(clock.at, fleetRate(clock))
    const world = session.log().stateAt(clock.at)
    const harbour = harbourOf(world)
    // the pushes since the last read: a ship for each, the newest at its time (a seek back: none)
    const at = world.sea.lastPush
    if (pushes !== null && harbour.pushes > pushes && at !== undefined)
      for (let k = harbour.pushes - pushes - 1; k >= 0 && k < 4; k--)
        sea.push({ at: Math.max(lastPush, at - k * 1000), key: `push-${harbour.pushes - k}` })
    pushes = harbour.pushes
    lastPush = at ?? lastPush
    if (harbour.release)
      sea.release({ at: harbour.release.at, key: `${harbour.release.repo}@${harbour.release.tag}` })
    const run = harbour.ci[0]
    sea.setLighthouse(run?.state ?? null, run?.at)
  }
  read()
  const timer = setInterval(read, FX_READ_MS)
  const offReset = session.onReset(() => {
    sea.reset()
    pushes = null
    read()
  })
  return () => {
    clearInterval(timer)
    offReset()
    offClock()
    sea.setRate(1)
  }
}
