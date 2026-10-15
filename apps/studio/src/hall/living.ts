/**
 * Living work on the island (sim story/living.ts): the session's reads glow their places, its failures
 * blight them until the fix lands (the edits' scaffolds are the event FX's, hall/fx.ts). Keyed on the
 * places' tiles through the hex → place lookup the island was built with (job.ts `MapStage.tiles`), drawn
 * by the one small texture the ground and the pieces read (render livingTint.ts).
 *
 * The spans (one per read and per grave) are read again only when the world they come from moves: the
 * log grows, the clock passes an event or is sought, a grave rises or is mended (the events' subscribe);
 * each frame only their levels are eased into the tiles, into arrays made once, and an island at rest
 * does nothing at all. Life's clock (`session.lifeAt`) times them, so a told story that has ended lets
 * its last glow fade instead of holding it. With reduced motion every level is flat, on or off.
 *
 * Where a place glows: its whole zone, full over its heart's `CORE_RINGS` and fading to nothing
 * `FALL_RINGS` further out, so a hamlet glows whole and the capital round its square, not to its walls.
 */
import type { LivingField, Stage } from "@guildhall/render"
import {
  blightSpans,
  type LivingSpan,
  livingAt,
  livingLevel,
  type PlaceLiving,
  workSpans,
} from "@guildhall/sim"
import { HEX_TILE_SIZE, hexCentre, hexDistance, hexGrid } from "@guildhall/world"
import type { HudParts } from "../hexworld/index.ts"
import type { HallEvents } from "./events.ts"
import type { HallSession } from "./feeds/index.ts"

/** The spans are read at most this often while the log is busy, ms. */
export const READ_MS = 100

/** Rings round a place's heart that glow (or blight) at full. */
export const CORE_RINGS = 3
/** Rings beyond the core over which it falls to nothing. */
export const FALL_RINGS = 3

/** How much of a place's light a tile `d` rings from its heart takes (1 in the core, then down to 0). */
export function reachOf(d: number): number {
  if (d <= CORE_RINGS) return 1
  return Math.max(0, 1 - (d - CORE_RINGS) / (FALL_RINGS + 1))
}

/** One zone's tiles as the field takes them: axial coordinates and reach, flat. */
export interface ZoneTiles {
  q: Int16Array
  r: Int16Array
  reach: Float32Array
}

/** Each zone's tiles from the island's lookup (`zoneOf`: zone + 1 per grid tile), heart first or not. Pure. */
export function zoneTiles(tiles: NonNullable<HudParts["tiles"]>): ZoneTiles[] {
  const grid = hexGrid(tiles.radius)
  const lists: number[][] = Array.from(tiles.hearts, () => [])
  for (let i = 0; i < grid.size && i < tiles.zoneOf.length; i++) {
    const z = (tiles.zoneOf[i] as number) - 1
    if (z >= 0) lists[z]?.push(i)
  }
  return lists.map((list, z) => {
    const heart = tiles.hearts[z] as number
    const hq = grid.q[heart] ?? 0
    const hr = grid.r[heart] ?? 0
    const out: ZoneTiles = {
      q: new Int16Array(list.length),
      r: new Int16Array(list.length),
      reach: new Float32Array(list.length),
    }
    list.forEach((i, k) => {
      out.q[k] = grid.q[i] as number
      out.r[k] = grid.r[i] as number
      out.reach[k] = reachOf(
        hexDistance({ q: grid.q[i] as number, r: grid.r[i] as number }, { q: hq, r: hr }),
      )
    })
    return out
  })
}

/** A zone's heart tile's centre on the ground (metres), or null: for shots that frame a place. */
export function heartOf(
  tiles: NonNullable<HudParts["tiles"]>,
  zone: number,
  groundAt: (x: number, z: number) => number,
): [number, number, number] | null {
  const heart = tiles.hearts[zone]
  if (heart === undefined) return null
  const grid = hexGrid(tiles.radius)
  const [cx, cz] = hexCentre({ q: grid.q[heart] as number, r: grid.r[heart] as number })
  const x = cx * HEX_TILE_SIZE
  const z = cz * HEX_TILE_SIZE
  return [x, groundAt(x, z), z]
}

export interface Living {
  /** What is happening at a zone now (null: nothing): the tooltip's line. */
  about(zone: number): PlaceLiving | null
  /** The spans read last (for shots and the tests). */
  spans(): readonly LivingSpan[]
  stats(): { spans: number; lit: number; reads: number; ms: number }
  dispose(): void
}

/** Whether the viewer asks for reduced motion, as it changes: the query made once, read for free. */
export function reducedMotion(): () => boolean {
  const query = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null
  return () => query?.matches === true
}

/** Drives `field` from `session` (see the top of this file). `events` gives the graves (hall/events.ts). */
export function mountLiving(parts: {
  stage: Pick<Stage, "onFrame">
  session: HallSession
  field: LivingField
  tiles: NonNullable<HudParts["tiles"]>
  events: () => HallEvents | null
  still?: () => boolean
  /** Real time, ms (the busy log's read throttle): `performance.now` by default; a test's own. */
  now?: () => number
}): Living {
  const { session, field } = parts
  const zones = zoneTiles(parts.tiles)
  const still = parts.still ?? reducedMotion()
  const realNow = parts.now ?? (() => performance.now())
  const glow = new Float32Array(zones.length)
  const blight = new Float32Array(zones.length)
  /** What each zone showed last frame (glow + blight), to clear what went dark. */
  const shown = new Float32Array(zones.length)
  let spans: LivingSpan[] = []
  let readLog: unknown = null
  let readCount = -1
  let readAt = Number.NEGATIVE_INFINITY
  let readReal = Number.NEGATIVE_INFINITY
  let gravesMoved = true
  let lit = false
  let reads = 0
  let ms = 0
  const offShows: { off: (() => void) | null; of: HallEvents | null } = { off: null, of: null }

  const listen = () => {
    const ev = parts.events()
    if (ev === offShows.of) return
    offShows.off?.()
    offShows.of = ev
    offShows.off = ev
      ? ev.subscribe(() => {
          gravesMoved = true
        })
      : null
    gravesMoved = true
  }

  const countAt = (events: readonly { at: number }[], t: number) => {
    let lo = 0
    let hi = events.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if ((events[mid] as { at: number }).at <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const read = (t: number) => {
    const begin = performance.now()
    const log = session.log()
    const ev = parts.events()
    spans = [...workSpans(log.events, t), ...(ev ? blightSpans(ev.shows(), t) : [])]
    reads++
    ms += performance.now() - begin
  }

  const frame = () => {
    listen()
    const t = session.lifeAt()
    const log = session.log()
    const events = log.events
    const count = countAt(events, t)
    // the world the spans come from moved: a new log, an event passed (or sought back past), a grave; a
    // busy log is read at most every READ_MS (a seek and a new log at once)
    const now = realNow()
    const jumped = log !== readLog || t < readAt
    if (jumped || ((count !== readCount || gravesMoved) && now - readReal >= READ_MS)) {
      readReal = now
      readLog = log
      readCount = count
      gravesMoved = false
      read(t)
    }
    readAt = t
    if (spans.length === 0 && !lit) return
    glow.fill(0)
    blight.fill(0)
    const flat = still()
    for (const s of spans) {
      const v = livingLevel(s, t, flat)
      if (v <= 0) continue
      if (s.kind === "read") glow[s.place] = Math.max(glow[s.place] ?? 0, v)
      else if (s.kind === "blight") blight[s.place] = Math.max(blight[s.place] ?? 0, v)
    }
    for (let z = 0; z < zones.length; z++) {
      const g = glow[z] as number
      const b = blight[z] as number
      if (g + b === 0 && shown[z] === 0) continue
      shown[z] = g + b
      const tiles = zones[z] as ZoneTiles
      for (let k = 0; k < tiles.q.length; k++) {
        const w = tiles.reach[k] as number
        field.set(tiles.q[k] as number, tiles.r[k] as number, g * w, b * w)
      }
    }
    lit = field.commit()
  }
  const off = parts.stage.onFrame(frame)

  const api: Living = {
    about(zone) {
      const t = session.lifeAt()
      return livingAt(spans, t, still()).get(zone) ?? null
    },
    spans: () => spans,
    stats: () => ({ spans: spans.length, lit: lit ? 1 : 0, reads, ms }),
    dispose() {
      off()
      offShows.off?.()
      field.clear()
      field.commit()
    },
  }
  return api
}
