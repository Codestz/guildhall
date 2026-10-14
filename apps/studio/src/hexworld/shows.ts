/**
 * The sky and town shows (render shows/): a dragon round the peaks, a comet (a shower of shooting stars
 * by night), a rainbow (a moonbow by night), a festival round the busiest square. The world-events
 * engine plays them through `Shows.play(show)`; for a look:
 *
 *   ?show=dragon | comet | rainbow | festival      plays it once the island is ready (`+` for several)
 *
 * `window.guildhall.ext.shows` drives them for shots: `play(kind | show)`, `stop(kind?)`, `clear()`,
 * `hold(t | null)` (every show held `t` seconds in), `ready()`, `now()`, `playing()`, `stats()`,
 * `sites()` (the peak, the square's poles and the keep).
 */
import {
  createShows,
  type DayLight,
  type EventSites,
  SHOW_KINDS,
  type ShowKind,
  type Shows,
  type Stage,
} from "@guildhall/render"

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
}): Shows {
  const shows = createShows(parts.stage, { sites: parts.sites, span: parts.span, light: parts.light })
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
  return shows
}
