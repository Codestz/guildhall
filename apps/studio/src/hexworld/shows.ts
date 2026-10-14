/**
 * The sky and town shows (render shows/): a dragon round the peaks, a comet (a shower of shooting stars
 * by night), a rainbow (a moonbow by night), a festival round the busiest square. The world-events
 * engine plays them through `Shows.play(show)`; for a look:
 *
 *   ?show=dragon | comet | rainbow | festival      plays it once the island is ready (`+` for several)
 *
 * A session on the island (a hall's, the home's story) plays the engine's own: once its HUD is up the
 * shows run on the session's clock and hall/shows.ts `driveSkyShows` plays what hall/events.ts says is
 * on stage (a seek replays nothing; a replay at 4× plays them 4×).
 *
 * `window.guildhall.ext.shows` drives them for shots: `play(kind | show)`, `stop(kind?)`, `clear()`,
 * `hold(t | null)` (every show held `t` seconds in), `ready()`, `now()`, `playing()`, `stats()`,
 * `sites()` (the peak, the square's poles and the keep).
 */
import {
  createShows,
  type DayLight,
  type EventSites,
  NIGHT_AT,
  SHOW_KINDS,
  type ShowKind,
  type Shows,
  type Stage,
} from "@guildhall/render"
import type { HallSession } from "../hall/feeds/session.ts"

/** `?show=`: the kinds to play, in order (none when absent or unknown). */
export function showsOf(raw: string | null): ShowKind[] {
  if (!raw) return []
  return raw
    .split(/[+,]/)
    .map((k) => k.trim())
    .filter((k): k is ShowKind => (SHOW_KINDS as readonly string[]).includes(k))
}

export function mountShows(parts: {
  stage: Stage
  query: Pick<URLSearchParams, "get">
  sites: EventSites
  span: number
  light: () => DayLight
  /** A session plays on the island: its world events, on its clock, once its HUD is up. */
  session?: (() => HallSession | null) | boolean
}): Shows {
  // the clock: the session's once it drives them (seconds), else the page's
  let driver: HallSession | null = null
  const shows = createShows(parts.stage, {
    sites: parts.sites,
    span: parts.span,
    light: parts.light,
    clock: () => (driver ? driver.clock.get().at / 1000 : performance.now() / 1000),
  })
  let detach = () => {}
  let disposed = false
  if (parts.session)
    void Promise.all([
      typeof parts.session === "function"
        ? Promise.resolve(parts.session)
        : import("../hall/hud/mount.tsx").then((m) => m.hallSession),
      import("../hall/events.ts"),
      import("../hall/shows.ts"),
    ]).then(([sessionOf, { hallEvents }, { driveSkyShows }]) => {
      let bound: unknown = null
      let undrive = () => {}
      const bind = () => {
        if (disposed) return
        const session = sessionOf()
        const events = session ? hallEvents() : null
        if (events === bound) return
        undrive()
        undrive = () => {}
        bound = events
        driver = events ? session : null
        shows.clear()
        if (session && events)
          undrive = driveSkyShows(
            shows,
            events,
            { jumps: () => session.clock.get().jumps, now: () => session.clock.get().at / 1000 },
            parts.sites,
            () => parts.light().night > NIGHT_AT,
          )
      }
      bind()
      const timer = setInterval(bind, 1000)
      detach = () => {
        clearInterval(timer)
        undrive()
        driver = null
      }
    })
  const ext = window.guildhall?.ext
  if (ext)
    ext.shows = {
      play: shows.play,
      stop: shows.stop,
      clear: shows.clear,
      hold: shows.hold,
      ready: shows.ready,
      now: shows.now,
      playing: shows.playing,
      stats: shows.stats,
      sites: () => ({
        peak: parts.sites.peak ?? null,
        square: parts.sites.square ?? null,
        castle: parts.sites.castle,
      }),
    }
  const kinds = showsOf(parts.query.get("show"))
  if (kinds.length)
    void (window.guildhall?.ready() ?? Promise.resolve()).then(() => {
      for (const kind of kinds) shows.play(kind)
    })
  return {
    ...shows,
    dispose() {
      disposed = true
      detach()
      shows.dispose()
    },
  }
}
