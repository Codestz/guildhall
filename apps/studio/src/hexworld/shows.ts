/**
 * The sky and town shows (render shows/): a dragon round the peaks, a comet (a shower of shooting stars
 * by night), a rainbow (a moonbow by night), a festival round the busiest square. The world-events
 * engine plays them through `Shows.play(show)`.
 *
 * A session on the island (a hall's, the home's story) plays the engine's own: once its HUD is up the
 * shows run on the session's clock and hall/shows.ts `driveSkyShows` plays what hall/events.ts says is
 * on stage (a seek replays nothing; a replay at 4× plays them 4×).
 *
 * `window.guildhall.ext.shows` drives them for shots: `play(kind | show)`, `stop(kind?)`, `clear()`,
 * `hold(t | null)` (every show held `t` seconds in), `ready()`, `now()`, `playing()`, `stats()`,
 * `sites()` (the peak, the square's poles and the keep), `part(name)` (a show's scene part).
 */
import {
  createShows,
  type DayLight,
  type EventSites,
  NIGHT_AT,
  type Shows,
  type Stage,
} from "@guildhall/render"
import type { HallSession } from "../hall/feeds/session.ts"

export function mountShows(parts: {
  stage: Stage
  sites: EventSites
  span: number
  light: () => DayLight
  /** The island's surface at (x, z), the sea's off the land: the dragon flies clear of it, its shadow on it. */
  ground?: (x: number, z: number) => number
  /** A session plays on the island: its world events, on its clock, once its HUD is up. */
  session?: (() => HallSession | null) | boolean
}): Shows {
  // the clock: the session's once it drives them (seconds), else the page's
  let driver: HallSession | null = null
  const shows = createShows(parts.stage, {
    sites: parts.sites,
    span: parts.span,
    light: parts.light,
    ...(parts.ground ? { ground: parts.ground } : {}),
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
      import("../audio/engine.ts"),
    ]).then(([sessionOf, { hallEvents }, { driveSkyShows }, { audio }]) => {
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
            // the dragon's roar, the fireworks' whoosh, bang and crackle, as late as they are far
            (cue, where, delay) =>
              audio.showSound(cue.name, where ? { x: where[0], z: where[2] } : undefined, delay, cue.rate),
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
      // a show's part by name (`dragon flying`, `dragon shadow`), for shots that follow it
      part: (name: string) => parts.stage.scene.getObjectByName(name) ?? null,
      sites: () => ({
        peak: parts.sites.peak ?? null,
        square: parts.sites.square ?? null,
        castle: parts.sites.castle,
      }),
    }
  return {
    ...shows,
    dispose() {
      disposed = true
      detach()
      shows.dispose()
    },
  }
}
