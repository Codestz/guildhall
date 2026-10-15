/**
 * A hall's session as life's agents (L2 ⇄ H1): the session's log (hall/feeds, already normalised with
 * the hall's places as zones) is planned where the walk graph is, the build worker's life desk
 * (lifePlan.ts `AgentDesk`), as it grows: each frame sends the events since the last reply and gets back
 * every hero's itinerary (sim `LifePlanner`, the same itineraries a whole-log plan makes, so a scrub
 * shows what playing showed). A pose is the itinerary sampled at the session's `lifeAt`, not life's own
 * seconds: the hall's timeline moves the heroes, and once a story has played to its end life's time runs
 * on past it (the session's `lifeAt`), so the heroes walk home and rest instead of freezing mid-road.
 *
 * A new log (a hub's hello: `onReset`) starts the desk over. Live, the moves a dwell makes with no event
 * after it are planned up to a second behind now; an event heard later than that is planned when heard.
 * Played back, the desk plans `AHEAD` past where life looks (its rest: sim rest.ts), and with every ask
 * it hears the hour the island shows (`hour`), so its heroes keep the island's evening and night.
 */
import { DWELL_MS, type Itinerary, poseAt } from "@guildhall/sim"
import type { HallSession } from "../hall/feeds/session.ts"
import { type AgentSource, type HeroLook, lookOf } from "./lifeAgents.ts"
import type { AgentDeskReply, AgentDeskRequest } from "./lifePlan.ts"

/** Live: the desk plans this far behind now (ms), so an event heard a little late is still in order. */
const LIVE_LAG = 1000
/** Played back: the desk plans this far past where life looks (ms), and asks again halfway through it. */
export const AHEAD = 20_000

export interface SessionAgents extends AgentSource {
  /** Stops listening to the session. */
  dispose(): void
  /** ms the worker took for the last plan (for the readout). */
  lastMs(): number
}

/** Where life looks in a session: its `lifeAt` (on past a story's end), or its clock's `at`. */
const lifeOf = (session: Pick<HallSession, "clock"> & Partial<Pick<HallSession, "lifeAt">>) =>
  session.lifeAt ? session.lifeAt() : session.clock.get().at

export function sessionAgents(
  session: Pick<HallSession, "log" | "clock" | "feed" | "onReset"> &
    Partial<Pick<HallSession, "snapshot" | "lifeAt">>,
  plan: (req: AgentDeskRequest) => Promise<AgentDeskReply | null>,
  now: () => number = Date.now,
  /** The hour the island shows now (life's day clock), for the desk's day; none: no evening, no night. */
  hour?: () => number,
): SessionAgents {
  let log = session.log()
  let sent = 0
  let reset = true
  let asking = false
  let planned = Number.NEGATIVE_INFINITY
  let looks: HeroLook[] = []
  let byId = new Map<string, Itinerary>()
  let version = 0
  let ms = 0
  const live = session.feed.kind === "live"
  const off = session.onReset(() => {
    log = session.log()
    sent = 0
    reset = true
  })
  return {
    list: () => looks,
    version: () => version,
    lastMs: () => ms,
    poseAt(id) {
      const it = byId.get(id)
      return it ? poseAt(it, lifeOf(session)) : null
    },
    itinerary: (id) => byId.get(id),
    // the HUD's 10 Hz snapshot: the world at the session clock (no fold of its own)
    worldAt() {
      const snap = session.snapshot?.()
      return snap ? { world: snap.world, t: snap.clock.at } : null
    },
    tick() {
      const current = session.log()
      if (current !== log) {
        log = current
        sent = 0
        reset = true
      }
      if (asking) return
      const n = log.length
      const last = log.events[n - 1]?.at
      if (last === undefined) return
      const at = lifeOf(session)
      const until = live ? Math.max(last, now() - LIVE_LAG) : Math.max(last + DWELL_MS, at + AHEAD)
      const step = live ? LIVE_LAG : AHEAD / 2
      if (n === sent && !reset && until <= planned + step) return
      const req: AgentDeskRequest = {
        events: log.events.slice(sent, n),
        until,
        ...(reset ? { reset } : {}),
        ...(hour ? { day: { at, hour: hour() } } : {}),
      }
      const asked = log
      sent = n
      reset = false
      planned = until
      asking = true
      void plan(req).then((reply) => {
        asking = false
        if (!reply || asked !== log) return
        ms = reply.ms
        byId = new Map(reply.itineraries.map((it) => [it.id, it]))
        // a story that names its heroes draws them as it says (the demo guild: Claude the mage…)
        const next = reply.cast.map((info, k) => {
          const own = session.feed.cast?.[k]
          return own ? { ...own, id: info.id, name: info.name } : lookOf(info, k, "wire")
        })
        if (next.length !== looks.length || next.some((l, k) => l.id !== looks[k]?.id)) version++
        looks = next
      })
    },
    dispose: off,
  }
}
