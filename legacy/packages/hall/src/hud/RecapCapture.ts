import { _roots, addAfterEffect } from "@react-three/fiber"
import type { Place } from "../guild/director.ts"
import { hudInsets } from "../guild/director.ts"
import type { Hero, ShotLink } from "../guild/recap.ts"
import { type GuildStore, RUSH } from "../guild/store.ts"
import { positions } from "../guild/useGuild.ts"
import { watersOf } from "../scene/Ships.tsx"
import { harbourOf, harbourSpotOf, lighthouseSpot, seaAt, toWorld } from "../scene/seas/fleet.ts"
import { activeWorld } from "../world/active.ts"
import { handWorld } from "../world/world.ts"

/**
 * Films the recap's hero shot (guild/recap.ts `heroOf`) from the running hall, client side:
 *
 *   1. the story is sought to the shot's second and paused (live: the moment is now), the Bard let
 *      go, the camera put on the subject (followed, or a sea place framed), the HUD's insets zeroed
 *      so the subject sits centred (the card crops round it), the resolution lifted for a crisp crop
 *   2. once the camera has settled, one frame is read back *inside* R3F's after-effect (after the
 *      frame is rendered, before the browser composites and clears it): no preserveDrawingBuffer,
 *      so the hall's renderer is left exactly as it was
 *   3. everything is put back: the time, the pace, the Bard, the pick, the resolution, the insets
 *
 * Returns the frame as a canvas and the link that reproduces it (guild/recap.ts `recapQuery`).
 */

/** Ground the hero shot holds round its subject, world units: an adventurer, a ship (bigger). */
const HERO_RADIUS = 22
const SEA_RADIUS = 26
/** How far a sea shot leans from its ship toward the quay (0: the ship centred). */
const TOWARD_QUAY = 0.35
/** Longest the camera may take to settle, frames; and how still it must be, frames in a row. */
const SETTLE_MAX = 90
const STILL_FRAMES = 4
/** The resolution the frame is read at: at least this wide (a 1200 px card cropped from it). */
const WANT_WIDTH = 2200
const DPR_MAX = 2.5

export interface Filmed {
  frame: HTMLCanvasElement
  link: ShotLink
  /** The frame's subject, as a share of its width and height (0.5, 0.5: centred). */
  focus: { x: number; y: number }
}

interface RootState {
  gl: { domElement: HTMLCanvasElement }
  camera: { position: { x: number; y: number; z: number }; zoom?: number }
  size: { width: number; height: number }
  viewport: { dpr: number }
  setDpr(dpr: number): void
}

/** The hall's R3F root (the one canvas on the page that R3F draws). */
function hallRoot(): { canvas: HTMLCanvasElement; state: () => RootState } | undefined {
  for (const [canvas, root] of _roots) {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) continue
    const store = (root as { store: { getState(): unknown } }).store
    return { canvas, state: () => store.getState() as RootState }
  }
  return undefined
}

/** Resolves on the next frame R3F renders, after it has rendered (the drawing buffer still full). */
function afterFrame<T>(read: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const off = addAfterEffect(() => {
      off()
      try {
        resolve(read())
      } catch (error) {
        reject(error)
      }
    })
  })
}

/** Where a sea subject is at run time `t`, on the island drawn now. */
export function seaPlace(store: GuildStore, kind: string, t: number): Place | undefined {
  const world = activeWorld() ?? handWorld()
  const harbour = harbourOf(watersOf(world).quay)
  if (kind === "sea-release") {
    const galleon = seaAt(store.sea, t).galleon
    const at = galleon ? toWorld(harbour, galleon.side, galleon.out) : undefined
    if (at) return { key: "recap:galleon", x: at.x, z: at.z, radius: 15 }
  }
  if (kind === "sea-green" || kind === "sea-red") {
    const light = lighthouseSpot(world.island, harbour)
    if (light) return { key: "recap:lighthouse", x: light.x, z: light.z, radius: 16 }
  }
  const spot = harbourSpotOf(kind === "sea-release" ? "sea-release" : "sea-merged")
  if (!spot) return undefined
  const at = toWorld(harbour, spot.side, spot.out)
  return { key: "recap:harbour", x: at.x, z: at.z, radius: 18 }
}

/** The film in progress: one at a time, so each one's "before" is the hall as the viewer left it. */
let filming: Promise<unknown> = Promise.resolve()

/**
 * Films `hero`. Throws when the hall has no canvas or the frame came back empty (a lost context);
 * the hall is restored either way. Calls queue: a second film (StrictMode's double effect, a quick
 * "try again") starts only once the first has put the hall back, or it would restore the first's
 * sought moment instead of the viewer's.
 */
export function filmHero(store: GuildStore, hero: Hero): Promise<Filmed> {
  const run = filming.then(
    () => film(store, hero),
    () => film(store, hero),
  )
  filming = run.catch(() => undefined)
  return run
}

async function film(store: GuildStore, hero: Hero): Promise<Filmed> {
  const root = hallRoot()
  if (!root) throw new Error("The hall has no picture to film.")
  const live = store.mode === "live"
  const was = {
    time: store.time,
    speed: store.speed,
    bard: store.bard,
    selected: store.selected,
    dpr: root.state().viewport.dpr,
    insets: { ...hudInsets },
  }
  let holding = true
  // The HUD rewrites its insets when a panel opens (the dossier, for a pick): held at zero meanwhile.
  const hold = () => {
    if (!holding) return
    hudInsets.left = 0
    hudInsets.right = 0
    hudInsets.top = 0
    hudInsets.bottom = 0
    requestAnimationFrame(hold)
  }
  try {
    if (!live) {
      store.seek(hero.shot)
      store.setSpeed(0)
    }
    const t = live ? store.time : hero.shot
    const subject = hero.subject
    // Framed on the point the link's `look=x,z` frames — an adventurer where they stand once the
    // seek has placed them (a few frames), a sea subject where the harbour has it — but wider than
    // the link's own radius (deeplink.ts: 10): a recap wants the island round its hero.
    if (store.selected) store.select(null)
    store.setBard(false)
    let place: Place | undefined
    if (subject.kind === "adventurer") {
      for (let i = 0; i < 3; i++) await afterFrame(() => undefined)
      const at = positions.get(subject.id)
      if (at) place = { key: "recap:hero", x: Math.round(at.x), z: Math.round(at.z), radius: HERO_RADIUS }
    } else {
      // A third of the way back toward the quay: the ship with the island it came home to.
      const sea = seaPlace(store, subject.moment, t)
      const quay = watersOf(activeWorld() ?? handWorld()).quay
      if (sea)
        place = {
          key: "recap:sea",
          x: Math.round(sea.x + (quay[0] - sea.x) * TOWARD_QUAY),
          z: Math.round(sea.z + (quay[1] - sea.z) * TOWARD_QUAY),
          radius: SEA_RADIUS,
        }
    }
    store.frame(place ?? { key: "recap:island", x: 0, z: 0, radius: 40 })
    hold()

    // A crisp crop: the frame at least WANT_WIDTH wide.
    const { size } = root.state()
    const dpr = Math.min(DPR_MAX, Math.max(was.dpr, WANT_WIDTH / Math.max(1, size.width)))
    if (dpr !== was.dpr) root.state().setDpr(dpr)

    // Settle: the camera still for a few frames running (a pick glides in; a framing cuts at once).
    let still = 0
    let last = ""
    for (let i = 0; i < SETTLE_MAX && still < STILL_FRAMES; i++) {
      const now = await afterFrame(() => {
        const { position, zoom } = root.state().camera
        return `${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)},${(zoom ?? 0).toFixed(3)}`
      })
      still = now === last ? still + 1 : 0
      last = now
    }

    const frame = await afterFrame(() => {
      const source = root.canvas
      const copy = document.createElement("canvas")
      copy.width = source.width
      copy.height = source.height
      const ctx = copy.getContext("2d")
      if (!ctx) throw new Error("No 2D canvas.")
      ctx.drawImage(source, 0, 0)
      return copy
    })
    if (blank(frame)) throw new Error("The frame came back empty.")

    const world = activeWorld()
    const link: ShotLink = {
      ...(live ? {} : { story: store.scenario, t }),
      ...(store.scenario === "rush" && RUSH.count !== undefined ? { n: RUSH.count } : {}),
      ...(world?.repo ? { repo: world.repo.repo } : {}),
      hour: store.environment.hour,
      weather: store.environment.weather,
      view: store.view,
      ...(place ? { look: { x: place.x, z: place.z } } : {}),
    }
    return { frame, link, focus: { x: 0.5, y: 0.5 } }
  } finally {
    holding = false
    Object.assign(hudInsets, was.insets)
    if (root.state().viewport.dpr !== was.dpr) root.state().setDpr(was.dpr)
    if (!live) {
      store.seek(was.time)
      store.setSpeed(was.speed)
    }
    store.select(was.selected)
    store.frame(null)
    store.setBard(was.bard)
  }
}

/** All one colour (a lost context, an unrendered canvas): sampled on a coarse grid. */
function blank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d")
  if (!ctx || canvas.width === 0) return true
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const first = `${data[0]},${data[1]},${data[2]}`
  const step = Math.max(4, Math.floor(data.length / 4 / 400)) * 4
  for (let i = 0; i < data.length; i += step)
    if (`${data[i]},${data[i + 1]},${data[i + 2]}` !== first) return false
  return true
}
