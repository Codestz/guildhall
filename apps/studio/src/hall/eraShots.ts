/**
 * The Legends' era pictures (V1's Legends had them): each chapter of a repo's book by era shows the island
 * as it was at the era's end, framed the same every time — the whole island from the map view, at golden
 * hour, in the season of the era's last day (decisions 2026-10-14: the season follows the timeline's
 * date) — so the book's pages watch it grow from its first tiles to today.
 *
 * Drawn on the stage's own renderer through its post pipeline (render still.ts), from a fixed camera of
 * its own into a small target: for that one draw the history lays the island out at the era's end
 * (`HudParts.still`, history.ts), the season's factors and the hour are set to the still's, and all of it
 * is put back inside the same slice, so no frame of the island ever sees it.
 *
 * Off the critical path: nothing is drawn until the Legends book opens; then its eras queue in book
 * order, one still at a time, each in short slices after a frame is drawn (render still.ts). A picture
 * is cached per repo and era (`eraShotKey`) for the page's life, so a book opened again, or the hall
 * opened again, shows it at once. The latest era's picture is the island today: the Chronicle card
 * reuses it.
 *
 * `window.guildhall.ext.eraShots()`: the queue's and the stills' numbers (shots, the perf probe).
 */
import {
  applySeason,
  createStills,
  GOLDEN_HOUR,
  lightAt,
  SEASON_AT,
  type StillStats,
  seasonOfDate,
} from "@guildhall/render"
import type { HudParts } from "../hexworld/index.ts"

/** The pictures' frame: pixels (16:9, about twice their width on the page), the lens, the view. */
export const ERA_SHOT = {
  width: 960,
  height: 540,
  /** Vertical field of view, degrees. */
  fov: 30,
  /** The map view: high enough to see every quarter of the island. */
  elevation: 42,
  /** The camera stands this many island radii away (the whole island in, a little sea round it). */
  reach: 3,
} as const

/**
 * What a picture leaves out, by name: the clouds over the island, the particles near the camera, and
 * what stands where today's island does (the townsfolk and their stocks, the heroes, the autumn
 * harvest), which on an era's smaller island would stand on the sea. At the map view they are specks.
 */
const UNSEEN = new Set([
  "clouds",
  "cloud deck",
  "workfx",
  "crowd:blobs",
  "crowd:bodies",
  "crowd:props",
  "life:stocks",
  "life:lines",
  "hero-silhouette",
  "world:harvest",
])

/** The pictures drawn this page's life, by `eraShotKey`: WebP data URLs, kept (a handful, ~60 KB each). */
const DRAWN = new Map<string, string>()

/** A picture's key: the repo, the era and where it ends (a chronicle read again with a new end draws anew). */
export const eraShotKey = (slug: string, era: { id: string; end: number }): string =>
  `${slug}#${era.id}@${era.end}`

/** One picture to draw: its key, and the moment the island is shown at (epoch ms). */
export interface EraShotJob {
  key: string
  at: number
}

export interface EraShotStats {
  /** Pictures drawn by this hall (not counting the cached ones it found). */
  drawn: number
  /** Pictures that failed (left to the chapter's file count). */
  failed: number
  /** Waiting or drawing now. */
  queued: number
  /** The stills' own numbers (slices, ms), once one was drawn. */
  stills: StillStats | null
}

export interface EraShots {
  /** The picture's URL once drawn, else undefined. */
  get(key: string): string | undefined
  /** True while it waits in the queue or is being drawn. */
  waiting(key: string): boolean
  /** Queues these in order (the drawn, the queued and the failed are passed over). */
  want(jobs: readonly EraShotJob[]): void
  subscribe(fn: () => void): () => void
  /** Bumps whenever a picture lands or fails (a `useSyncExternalStore` snapshot). */
  version(): number
  stats(): EraShotStats
  /** Stops the queue (a picture under way is dropped) and frees the drawing; the cache stays. */
  dispose(): void
}

/** What draws one picture: the island at `at` (epoch ms) as an image URL. */
export interface EraCapture {
  shoot(at: number): Promise<string>
  stats(): StillStats | null
  dispose(): void
}

/**
 * The queue and the cache over a capture (null: a hall that cannot film, so nothing ever waits).
 * `cache` is the page's (`DRAWN`) unless a test brings its own.
 */
export function createEraShots(capture: EraCapture | null, cache: Map<string, string> = DRAWN): EraShots {
  const queue: EraShotJob[] = []
  const failed = new Set<string>()
  const fns = new Set<() => void>()
  let running: string | null = null
  let version = 0
  let drawn = 0
  let disposed = false

  const told = () => {
    version++
    for (const fn of fns) fn()
  }

  const pump = async () => {
    if (running !== null || !capture) return
    while (queue.length > 0 && !disposed) {
      const job = queue.shift() as EraShotJob
      running = job.key
      try {
        const url = await capture.shoot(job.at)
        if (disposed) break
        cache.set(job.key, url)
        drawn++
      } catch {
        if (disposed) break
        failed.add(job.key)
      }
      running = null
      told()
    }
    running = null
  }

  return {
    get: (key) => cache.get(key),
    waiting: (key) => running === key || queue.some((j) => j.key === key),
    want(jobs) {
      if (disposed || !capture) return
      let added = false
      for (const job of jobs) {
        if (cache.has(job.key) || failed.has(job.key) || running === job.key) continue
        if (queue.some((j) => j.key === job.key)) continue
        queue.push(job)
        added = true
      }
      if (added) {
        told()
        void pump()
      }
    },
    subscribe(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    version: () => version,
    stats: () => ({
      drawn,
      failed: failed.size,
      queued: queue.length + (running === null ? 0 : 1),
      stills: capture?.stats() ?? null,
    }),
    dispose() {
      disposed = true
      queue.length = 0
      fns.clear()
      capture?.dispose()
    },
  }
}

/** The camera's azimuth that sees the golden-hour sun from the side, shadows falling across the view (hexworld `sideLit`). */
export function goldenAzimuth(): number {
  const [x, , z] = lightAt(GOLDEN_HOUR).sunDir
  const look = Math.atan2(z, x) - (75 * Math.PI) / 180
  const az = (Math.atan2(-Math.cos(look), -Math.sin(look)) * 180) / Math.PI
  return Math.round(((az % 360) + 360) % 360)
}

/** The map view of the whole island: its middle, from `ERA_SHOT.reach` radii away. Pure. */
export function eraPose(world: { centre: readonly [number, number]; half: number }) {
  return {
    target: [world.centre[0], 0, world.centre[1]] as [number, number, number],
    azimuth: goldenAzimuth(),
    elevation: ERA_SHOT.elevation,
    distance: world.half * ERA_SHOT.reach,
  }
}

/**
 * The hall's capture: stills of its island through its post pipeline, laid out by its history. Null
 * where it cannot film (no post, no history: the chapters then show their counts alone).
 */
export function hallCapture(
  parts: Pick<HudParts, "stage" | "post" | "still" | "clock" | "season">,
): EraCapture | null {
  const { stage, post, still } = parts
  if (!post || !still) return null
  let stills: ReturnType<typeof createStills> | null = null
  return {
    shoot(at) {
      const world = stage.rig.world()
      if (!world) return Promise.reject(new Error("eraShots: no world yet"))
      stills ??= createStills(stage, post)
      return stills.shoot({
        pose: eraPose(world),
        width: ERA_SHOT.width,
        height: ERA_SHOT.height,
        fov: ERA_SHOT.fov,
        set() {
          // the picture is the island's, clear: no cloud between it and the eye, no leaf falling past the lens
          const hidden: { visible: boolean }[] = []
          stage.scene.traverseVisible((o) => {
            if (UNSEEN.has(o.name)) hidden.push(o)
          })
          for (const o of hidden) o.visible = false
          const island = still(at)
          const hour = parts.clock.get()
          parts.clock.set(GOLDEN_HOUR)
          applySeason(seasonOfDate(at))
          return () => {
            applySeason(parts.season?.drive.at() ?? SEASON_AT.summer)
            parts.clock.set(hour)
            island?.()
            for (const o of hidden) o.visible = true
          }
        },
      })
    },
    stats: () => stills?.stats ?? null,
    dispose() {
      stills?.dispose()
      stills = null
    },
  }
}
