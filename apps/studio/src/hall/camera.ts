/**
 * The hall's camera (V1's CameraRig, plan-hud-events D1): yours first, the director's when you leave
 * it alone. It drives the stage's orbit rig (render `rig/`) and never fights it.
 *
 *   follow    clicking a hero (a roster row, a badge, a chip: `follow(id)`) flies close to them and
 *             keeps them framed as they walk; you still turn and zoom (the zoom closes in on them).
 *             A pan, Esc, a place opened (any glide from elsewhere) or the hero leaving lets go.
 *   director  sim `director.pick` chooses the shot from the session's world a few times a second; the
 *             camera glides to it (hero close, place mid, harbour mid, overview map), tracks a hero
 *             shot, drifts slowly round a held one, and never cuts sooner than `MIN_CUT_MS` after the
 *             last cut. It waits `USER_WAIT_MS` after any input of yours. B toggles it; on by default
 *             for `?feed=story`, off for live and replay (`?director=1|0` overrides).
 *   framing   every subject lands in the middle of what the HUD leaves clear (the open sheet, a tall
 *             list, the bar): the HUD's regions are measured four times a second while the camera works.
 *
 * The pure parts (framing, tracking, the release and wait rules, shot poses) are exported for tests;
 * `createHallCamera` wires them to a stage, a HUD and a session. `window.guildhall.ext.camera` is it.
 */
import type { CameraPose } from "@guildhall/core"
import { distanceRange, framedTarget, type RigMove, type Stage } from "@guildhall/render"
import { type Shot as DirectorShot, type Distance, director, type Focus, type ShowKind } from "@guildhall/sim"
import type { ViewerHud } from "@guildhall/ui"
import type { Chips } from "../hexworld/chips.ts"
import type { HudParts } from "../hexworld/index.ts"
import type { BuiltPlace } from "../hexworld/job.ts"
import { hallEvents } from "./events.ts"
import type { HallSession } from "./feeds/index.ts"
import type { SessionPlaces } from "./feeds/places.ts"

type Vec3 = [number, number, number]

/** The director waits this long after the viewer's last camera input (wall clock, ms). */
export const USER_WAIT_MS = 10_000
/** No director cut sooner than this after the last one, wall clock (a 4× replay's holds are short). */
export const MIN_CUT_MS = 3000
/** How often the director decides and the HUD is measured, ms. */
export const DECIDE_MS = 250
/** The aim point over a hero's feet, metres (about their chest). */
export const HERO_LIFT = 1.0
/** A followed hero's framing: close and low. */
export const CLOSE: Readonly<{ distance: number; elevation: number }> = { distance: 16, elevation: 26 }
/** Tracking rates, per second: across the ground, and up and down (a terrace step is eased, not jumped). */
export const TRACK = { ground: 7, height: 2.5, snap: 40 } as const
/** Held shots drift round, degrees per second (none with reduced motion). */
export const DRIFT = { held: 0.7, map: 1.6 } as const

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---------------------------------------------------------------------------------------------------
// Framing: where the HUD leaves the screen clear, and the target that puts a subject there.

/** A box on the stage, CSS px from its top-left. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** What the HUD covers, px in from each edge of the stage. */
export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

export const NO_INSETS: Readonly<Insets> = { left: 0, right: 0, top: 0, bottom: 0 }
/** Boxes smaller than this share of the stage (the brand, the rail's icons, a chip) do not move the frame. */
export const SMALL_BOX = 0.025

/**
 * The insets a set of HUD boxes asks for: each box (big enough to matter) is cleared from the edge it
 * costs least to give up (a right-hand sheet from the right, a bottom sheet from the bottom, a tall
 * list from the left). Pure.
 */
export function insetsOf(boxes: readonly Box[], width: number, height: number): Insets {
  const out = { ...NO_INSETS }
  if (width <= 0 || height <= 0) return out
  for (const b of boxes) {
    const l = clamp(b.left, 0, width)
    const r = clamp(b.right, 0, width)
    const t = clamp(b.top, 0, height)
    const btm = clamp(b.bottom, 0, height)
    if (((r - l) * (btm - t)) / (width * height) < SMALL_BOX) continue
    const costs: [keyof Insets, number, number][] = [
      ["left", r / width, r],
      ["right", (width - l) / width, width - l],
      ["top", btm / height, btm],
      ["bottom", (height - t) / height, height - t],
    ]
    let best = costs[0] as (typeof costs)[number]
    for (const c of costs) if (c[1] < best[1]) best = c
    out[best[0]] = Math.max(out[best[0]], best[2])
  }
  return out
}

/** Where the clear area's middle is, NDC from the screen's centre (y up), and its share of the screen. */
export interface ClearFrame {
  x: number
  y: number
  w: number
  h: number
}

/** The clear area left by `insets` (V1's `clearFrame`: no side gives up more than about half). Pure. */
export function clearFrame(width: number, height: number, insets: Insets): ClearFrame {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, w: 1, h: 1 }
  const left = Math.min(insets.left, width * 0.45)
  const right = Math.min(insets.right, width * 0.45)
  const top = Math.min(insets.top, height * 0.4)
  const bottom = Math.min(insets.bottom, height * 0.5)
  const cx = (left + (width - right)) / 2
  const cy = (top + (height - bottom)) / 2
  return {
    x: (cx / width) * 2 - 1,
    y: 1 - (cy / height) * 2,
    w: (width - left - right) / width,
    h: (height - top - bottom) / height,
  }
}

export { framedTarget } from "@guildhall/render"

/** A pleading hero's chip (mark and speech with it) keeps this far, px, inside the clear area's edge. */
export const PLEA_MARGIN = 10
/** The share of the measured overshoot the frame is nudged by per measure (the held frame lags by ~0.3 s). */
const BIAS_GAIN = 0.6

/**
 * The shift, px, that brings `box` (a chip with its plea mark and speech) inside `rect` (the clear area)
 * with `margin` to spare; a box wider (taller) than the area is centred in it. Zero when it already fits. Pure.
 */
export function fitShift(box: Box, rect: Box, margin = 0): { dx: number; dy: number } {
  const axis = (lo: number, hi: number, from: number, to: number) => {
    if (hi - lo > to - from - 2 * margin) return (from + to) / 2 - (lo + hi) / 2
    if (lo < from + margin) return from + margin - lo
    if (hi > to - margin) return to - margin - hi
    return 0
  }
  return {
    dx: axis(box.left, box.right, rect.left, rect.right),
    dy: axis(box.top, box.bottom, rect.top, rect.bottom),
  }
}

/**
 * How far to change a nudge of `have` px (screen axes, y down) given where the chip's `box` stands in it:
 * what `fitShift` asks while it pokes out, else the nudge unwinds toward zero as far as the box keeps its
 * margin (a nudge made while the view glided in never stays once the hero is centred). Pure.
 */
export function biasStep(
  box: Box,
  rect: Box,
  margin: number,
  have: { x: number; y: number },
): { dx: number; dy: number } {
  const fit = fitShift(box, rect, margin)
  const axis = (ask: number, keep: number, lo: number, hi: number, from: number, to: number) => {
    if (ask !== 0 || keep === 0) return ask
    // moving the box against the nudge: it may go until it touches the margin
    const room = keep < 0 ? to - margin - hi : lo - (from + margin)
    return -Math.sign(keep) * Math.min(Math.abs(keep), Math.max(0, room))
  }
  return {
    dx: axis(fit.dx, have.x, box.left, box.right, rect.left, rect.right),
    dy: axis(fit.dy, have.y, box.top, box.bottom, rect.top, rect.bottom),
  }
}

/** How fast the held frame follows the measured one, per second (a sheet opening slides the view over ~0.5 s). */
export const FRAME_RATE = 6

/** One step of the held frame toward the measured one (in place). Pure but for `out`. */
export function easeFrame(out: ClearFrame, to: ClearFrame, dt: number): ClearFrame {
  const k = 1 - Math.exp(-FRAME_RATE * Math.max(0, dt))
  out.x += (to.x - out.x) * k
  out.y += (to.y - out.y) * k
  out.w += (to.w - out.w) * k
  out.h += (to.h - out.h) * k
  return out
}

/** The camera's lens: vertical field of view (degrees), width over height. */
export interface Lens {
  fov: number
  aspect: number
}

// ---------------------------------------------------------------------------------------------------
// Tracking: a walker's point, smoothed so steps, stairs and a frame's jitter never jerk the view.

/**
 * One step of the tracked point toward the subject: exponential across the ground and (slower) up and
 * down; a jump farther than `TRACK.snap` metres (a hero placed anew, a scrub) is taken at once. Pure.
 */
export function trackStep(current: Vec3 | null, subject: Vec3, dt: number): Vec3 {
  if (!current) return [subject[0], subject[1], subject[2]]
  const dx = subject[0] - current[0]
  const dz = subject[2] - current[2]
  if (Math.hypot(dx, dz, subject[1] - current[1]) > TRACK.snap) return [subject[0], subject[1], subject[2]]
  const g = 1 - Math.exp(-TRACK.ground * Math.max(0, dt))
  const h = 1 - Math.exp(-TRACK.height * Math.max(0, dt))
  return [current[0] + dx * g, current[1] + (subject[1] - current[1]) * h, current[2] + dz * g]
}

// ---------------------------------------------------------------------------------------------------
// The rules: what lets a follow go, when the director may take the camera.

/**
 * True when a camera move lets go of a followed hero: a pan, free flight, a glide or set from elsewhere
 * (a place opened, a deep link). Turning and zooming keep them. Pure.
 */
export function releases(move: RigMove): boolean {
  return move !== "orbit" && move !== "zoom"
}

/** A press that moved less than this (px) and lasted less than `CLICK_MS` is a click, not a drag. */
export const CLICK_PX = 6
export const CLICK_MS = 600

/** True when a press (its travel, px, and length, ms) is a plain click. Pure. */
export function isClick(dx: number, dy: number, ms: number): boolean {
  return Math.hypot(dx, dy) < CLICK_PX && ms < CLICK_MS
}

/** True when the director may run: on, nobody followed, and `USER_WAIT_MS` since the last input. Pure. */
export function directorFree(on: boolean, following: boolean, now: number, userAt: number | null): boolean {
  return on && !following && (userAt === null || now - userAt >= USER_WAIT_MS)
}

/** True when the director's new shot may be cut to now (the first one always). Pure. */
export function mayCut(now: number, lastCut: number | null): boolean {
  return lastCut === null || now - lastCut >= MIN_CUT_MS
}

/** The director's default for a feed: on for a told story, off for live and replay (`?director=` wins). */
export function directorDefault(query: Pick<URLSearchParams, "get">): boolean {
  const asked = query.get("director")
  if (asked === "1" || asked === "on") return true
  if (asked === "0" || asked === "off") return false
  return query.get("feed") === "story"
}

// ---------------------------------------------------------------------------------------------------
// Shots: the pose for a focus at a distance class.

export interface ShotSizes {
  /** The map view's distance (the rig's farthest, a little in). */
  map: number
  /** A place's size, tiles (sizes its mid shot). */
  tiles?: number
  /** A world event's kind (its own framing, `SHOW_POSES`). */
  show?: ShowKind
  /** The island's middle (x, z): a sea show is filmed from the island, looking out. */
  centre?: readonly [number, number]
}

/**
 * How the director frames each world event once it has cut to it (its site's point, hall/shows.ts):
 * the sky's shows from low enough to see the sky (the dragon over the peaks, the comet laid out in the
 * view it settles on), the sea's from over the water, the festival wide enough for the fireworks over
 * the keep, a grave close enough to see past the yard's clutter. The rainbow keeps the map view. The
 * sea's (`seaward`) look out from the island toward their hull (the camera is held over the island, so
 * it turns to face the ship rather than keeping its way).
 */
export const SHOW_POSES: Readonly<
  Partial<Record<ShowKind, { distance: number; elevation: number; seaward?: boolean }>>
> = {
  dragon: { distance: 90, elevation: 12 },
  comet: { distance: 150, elevation: 16 },
  ghostship: { distance: 90, elevation: 12, seaward: true },
  raid: { distance: 70, elevation: 14, seaward: true },
  festival: { distance: 40, elevation: 10 },
  undead: { distance: 15, elevation: 32 },
}

/** The pose a director's shot asks for: its distance and tilt by class, keeping the way the camera faces. */
export function shotPose(
  focus: Focus["kind"],
  distance: Distance,
  target: Vec3,
  from: Pick<CameraPose, "azimuth">,
  sizes: ShotSizes,
): CameraPose {
  const at = (d: number, elevation: number): CameraPose => ({
    target: [target[0], target[1], target[2]],
    azimuth: from.azimuth,
    elevation,
    distance: d,
  })
  const show = focus === "show" && sizes.show ? SHOW_POSES[sizes.show] : undefined
  if (show && distance !== "close") {
    const pose = at(Math.min(sizes.map, show.distance), show.elevation)
    if (show.seaward && sizes.centre) {
      const dx = target[0] - sizes.centre[0]
      const dz = target[2] - sizes.centre[1]
      if (Math.hypot(dx, dz) > 1) pose.azimuth = (Math.atan2(-dx, -dz) * 180) / Math.PI
    }
    return pose
  }
  if (distance === "map") return at(sizes.map, 60)
  if (distance === "close") return at(CLOSE.distance, CLOSE.elevation)
  if (focus === "place") return at(Math.min(150, 42 + Math.sqrt(Math.max(0, sizes.tiles ?? 0)) * 6), 40)
  if (focus === "harbour") return at(58, 34)
  return at(24, 30)
}

/** A glide's length, ms: longer for farther and for a bigger change of size (V1: 1.1–2.4 s), shorter for a follow. */
export function glideMs(from: CameraPose, to: CameraPose, quick = false): number {
  const across = Math.hypot(to.target[0] - from.target[0], to.target[2] - from.target[2])
  const size = Math.abs(Math.log(Math.max(1, to.distance) / Math.max(1, from.distance)))
  const ms = 900 + across * 25 + size * 450
  return quick ? clamp(ms * 0.7, 700, 1500) : clamp(ms, 1100, 2400)
}

// ---------------------------------------------------------------------------------------------------
// The controller.

export type CameraMode = "free" | "follow" | "director"

export interface HallCameraState {
  /** Who has the camera: the viewer (`free`), a followed hero, or the director. */
  mode: CameraMode
  /** The hero being followed. */
  following: string | null
  /** The director's switch (B). */
  director: boolean
  /** The director has a session to direct. */
  directable: boolean
  /** The director's shot on screen (null while it waits or is off). */
  shot: { key: string; reason: DirectorShot["reason"]; distance: Distance } | null
  /** ms until the director may take the camera (0: it may now). */
  waitMs: number
}

export interface HallCamera {
  /** Flies to a hero and keeps them framed (the viewer still turns and zooms). */
  follow(id: string): void
  /** Lets go of a followed hero (the director takes over once the viewer has been still `USER_WAIT_MS`). */
  release(): void
  /** Switches the director on or off (no argument: toggles); returns the switch. */
  director(on?: boolean): boolean
  state(): HallCameraState
  /** The point being filmed now (the followed hero's chest, the shot's subject), null when free; for shots. */
  subject(): Vec3 | null
  /** The clear frame's middle (NDC) the subject is put at; for shots. */
  frame(): ClearFrame
  /** Hears a change of state (a follow, a release, the switch, a cut). */
  subscribe(fn: () => void): () => void
  /** The camera's CPU per frame, ms (its driver and its decisions), since the last call. */
  stats(): { frames: number; meanMs: number; maxMs: number; decides: number; decideMs: number }
  dispose(): void
}

export interface HallCameraOptions {
  stage: Stage
  hud: ViewerHud
  /** The element the stage draws into (the HUD's boxes are measured against it). */
  host: HTMLElement
  places: readonly BuiltPlace[]
  /** Where a hero is drawn now (its feet), null indoors or off the island. */
  heroAt(id: string): Vec3 | null
  /** The session (`?feed=`) and its places; null: nothing to direct, follow still works off the HUD. */
  session: HallSession | null
  sessionPlaces: Pick<SessionPlaces, "placeAt"> | null
  /** The harbour's ships now (their centroid frames the harbour), else null. */
  ships?: () => readonly { at: Vec3 }[] | null
  query: Pick<URLSearchParams, "get">
  /** The director's switch before the link's say (`?director=` still wins): the home's is on. */
  director?: boolean
  /** The heroes' chips: a plain click on one follows its hero; the followed one is pinned first. */
  chips?: Pick<Chips, "select" | "hit" | "extent"> | null
  /** The layer the chips are laid out in (their boxes' origin; the stage's host by default). */
  chipsHost?: HTMLElement
  now?: () => number
  reducedMotion?: () => boolean
}

export function createHallCamera(opts: HallCameraOptions): HallCamera {
  const { stage, hud, host } = opts
  const rig = stage.rig
  const now = opts.now ?? (() => performance.now())
  const motion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null
  const still = opts.reducedMotion ?? (() => motion?.matches === true)
  let followId: string | null = null
  let directorOn =
    opts.query.get("director") === null && opts.director !== undefined
      ? opts.director
      : directorDefault(opts.query)
  let userAt: number | null = null
  /** The director's shot on screen and when it was cut (wall clock). */
  let shot: DirectorShot | null = null
  let lastCut: number | null = null
  /** The tracked point (smoothed subject) for the current follow or shot. */
  let tracked: Vec3 | null = null
  /** A hero's last known feet, for when they step indoors. */
  const lastSeen = new Map<string, Vec3>()
  let insets: Insets = { ...NO_INSETS }
  /** Our own glides and sets, which `onMove` must not take for the viewer's. */
  let self = false
  let decideIn = 0
  let lastMode: CameraMode = "free"
  const cost = { frames: 0, total: 0, max: 0, decides: 0, decideMs: 0 }
  const fns = new Set<() => void>()
  const notify = () => {
    for (const fn of fns) fn()
  }

  const lens = (): Lens => ({ fov: stage.camera.fov, aspect: stage.camera.aspect })
  const glide = (pose: CameraPose, ms: number) => {
    self = true
    try {
      if (still()) rig.set(pose)
      else rig.glide(pose, ms)
    } finally {
      self = false
    }
  }

  /** The HUD's boxes over the stage, measured (the sheet by its panel: the region spans the height). */
  const measure = () => {
    const box = host.getBoundingClientRect()
    const boxes: Box[] = []
    const add = (el: Element) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      boxes.push({
        left: r.left - box.left,
        top: r.top - box.top,
        right: r.right - box.left,
        bottom: r.bottom - box.top,
      })
    }
    for (const el of [hud.corner, hud.feed, hud.bottom, hud.rail]) add(el)
    for (const el of Array.from(hud.sheet.children)) add(el)
    insets = insetsOf(boxes, box.width, box.height)
    clear = clearFrame(box.width, box.height, insets)
  }
  /** The clear frame, as last measured (never read from the layout in a frame). */
  let clear: ClearFrame = clearFrame(1, 1, NO_INSETS)
  /** The frame the subject is held at: eased toward the measured one, so a panel opening slides the view, never jumps it. */
  const shown = { x: 0, y: 0, w: 1, h: 1 }
  /** A nudge (NDC) of the frame that keeps a pleading hero's chip inside the clear area (see `fitShift`). */
  const bias = { x: 0, y: 0 }
  const frame = (): ClearFrame =>
    bias.x === 0 && bias.y === 0 ? shown : { ...shown, x: shown.x + bias.x, y: shown.y + bias.y }
  /** The pleading hero's chip, kept on screen: the bias grows while its box (mark and speech too) pokes out. */
  const keepPlea = (id: string | null) => {
    const actor = id ? opts.session?.snapshot().world.actors.get(id) : undefined
    pleading = actor?.status === "waiting"
    const box = id && pleading ? (opts.chips?.extent(id) ?? null) : null
    if (!box) return
    const stage = host.getBoundingClientRect()
    const rect: Box = {
      left: ((clear.x - clear.w + 1) / 2) * stage.width,
      right: ((clear.x + clear.w + 1) / 2) * stage.width,
      top: ((1 - clear.y - clear.h) / 2) * stage.height,
      bottom: ((1 - clear.y + clear.h) / 2) * stage.height,
    }
    const have = { x: (bias.x * stage.width) / 2, y: (-bias.y * stage.height) / 2 }
    const s = biasStep({ left: box[0], top: box[1], right: box[2], bottom: box[3] }, rect, PLEA_MARGIN, have)
    bias.x = clamp(bias.x + ((s.dx * 2) / Math.max(1, stage.width)) * BIAS_GAIN, -0.9, 0.9)
    bias.y = clamp(bias.y - ((s.dy * 2) / Math.max(1, stage.height)) * BIAS_GAIN, -0.9, 0.9)
  }
  let pleading = false
  // Measured when the HUD's regions or the open panel change size (the observer runs after layout, so
  // reading the boxes there forces none), and on a follow or a cut.
  const watched = new Set<Element>()
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(() => measure()) : null
  const watch = () => {
    if (!resized) return
    for (const el of [
      host,
      hud.corner,
      hud.feed,
      hud.bottom,
      hud.rail,
      hud.sheet,
      ...Array.from(hud.sheet.children),
    ])
      if (!watched.has(el)) {
        watched.add(el)
        resized.observe(el)
      }
  }
  const panels = typeof MutationObserver === "function" ? new MutationObserver(() => watch()) : null
  panels?.observe(hud.sheet, { childList: true })
  watch()

  /** The point a hero is filmed at: where they are drawn, else last seen, else their place's heart. */
  const heroPoint = (id: string): Vec3 | null => {
    const feet = opts.heroAt(id)
    if (feet) {
      lastSeen.set(id, feet)
      return [feet[0], feet[1] + HERO_LIFT, feet[2]]
    }
    const seen = lastSeen.get(id)
    if (seen) return [seen[0], seen[1] + HERO_LIFT, seen[2]]
    const actor = opts.session?.snapshot().world.actors.get(id)
    const place = opts.sessionPlaces?.placeAt(actor?.place)
    return place ? [place.at[0], place.at[1] + HERO_LIFT, place.at[2]] : null
  }
  const harbourPoint = (): Vec3 | null => {
    const ships = opts.ships?.() ?? null
    if (ships && ships.length > 0) {
      let x = 0
      let z = 0
      for (const s of ships) {
        x += s.at[0]
        z += s.at[2]
      }
      return [x / ships.length, Math.max(0, ships[0]?.at[1] ?? 0), z / ships.length]
    }
    const p = opts.places.find((q) => q.kind === "harbour") ?? opts.places[0]
    return p ? [p.at[0], p.at[1], p.at[2]] : null
  }
  const placeOf = (zone: number) => opts.places.find((p) => p.zone === zone)
  /** An island with no built places (the home): where the heroes standing at a zone are, on average. */
  const crowdAt = (zone: number): Vec3 | null => {
    const world = opts.session?.snapshot().world
    if (!world) return null
    let n = 0
    const sum: Vec3 = [0, 0, 0]
    for (const a of world.actors.values()) {
      if (a.gone !== undefined || a.place !== zone) continue
      const feet = opts.heroAt(a.id)
      if (!feet) continue
      n++
      sum[0] += feet[0]
      sum[1] += feet[1]
      sum[2] += feet[2]
    }
    return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : null
  }
  const subjectOf = (focus: Focus): Vec3 | null => {
    switch (focus.kind) {
      case "hero":
        return heroPoint(focus.id)
      case "place": {
        const p = placeOf(focus.place)
        return p ? [p.at[0], p.at[1], p.at[2]] : crowdAt(focus.place)
      }
      case "harbour":
        return harbourPoint()
      case "show": {
        // a world event: where its render task says it stands (hall/events.ts), else over the island
        const world = rig.world()
        const p = hallEvents()?.pointOf(focus)
        return p
          ? [p[0], p[1], p[2]]
          : world
            ? [world.centre[0], focus.lift ?? 0, world.centre[1]]
            : [0, 0, 0]
      }
      default: {
        const world = rig.world()
        return world ? [world.centre[0], 0, world.centre[1]] : [0, 0, 0]
      }
    }
  }
  const mapDistance = () => {
    const world = rig.world()
    const l = lens()
    return world ? distanceRange(world, { ...l, far: stage.camera.far })[1] * 0.92 : 300
  }

  const mode = (): CameraMode => (followId ? "follow" : shot ? "director" : "free")
  let chipFollowed: string | null = null
  const changed = () => {
    const m = mode()
    lastMode = m
    // the chips place the followed hero first, pinned and full
    if (opts.chips && chipFollowed !== followId) {
      chipFollowed = followId
      opts.chips.select(followId)
    }
    notify()
  }

  const letGo = () => {
    if (!followId) return
    followId = null
    tracked = null
    rig.aim(null)
  }
  const stopShot = () => {
    if (!shot) return
    shot = null
    tracked = null
    rig.aim(null)
  }

  /** The director's turn: pick, and cut when the pick says so and the last cut is old enough. */
  const decide = (t: number) => {
    const session = opts.session
    if (!session || !directorFree(directorOn, followId !== null, t, userAt)) return
    const snap = session.snapshot()
    if (snap.events === 0) return
    const next = director.pick(
      snap.world,
      snap.world.recent,
      snap.clock.at,
      shot ? { shot } : {},
      hallEvents()?.hints(),
    )
    if (shot && next.key === shot.key) {
      // the same subject: its beat may have risen (a closer framing), no cut
      if (next.distance !== shot.distance) {
        const target = subjectOf(next.focus)
        if (target) {
          const pose = shotPose(next.focus.kind, next.distance, target, rig.goal(), sizesOf(next.focus))
          rig.steer({ distance: pose.distance, elevation: pose.elevation })
        }
      }
      shot = next
      return
    }
    if (shot && !mayCut(t, lastCut)) return
    const target = subjectOf(next.focus)
    if (!target) return
    shot = next
    lastCut = t
    tracked = target
    const from = rig.get()
    const pose = shotPose(next.focus.kind, next.distance, target, from, sizesOf(next.focus))
    pose.target = framedTarget(target, pose, lens(), frame())
    rig.aim(target, frame())
    glide(pose, glideMs(from, pose))
    changed()
  }
  const sizesOf = (focus: Focus): ShotSizes => ({
    map: mapDistance(),
    ...(focus.kind === "place" ? { tiles: placeOf(focus.place)?.tiles ?? 0 } : {}),
    ...(focus.kind === "show" ? { show: focus.show } : {}),
    ...(focus.kind === "show" && rig.world() ? { centre: rig.world()?.centre as [number, number] } : {}),
  })

  /** Each frame, before the rig eases: aim at the followed hero or the shot's subject, drift a held shot. */
  const drive = (dt: number) => {
    const start = performance.now()
    const t = now()
    decideIn -= dt * 1000
    if (decideIn <= 0) {
      const begin = performance.now()
      decideIn = DECIDE_MS
      if (followId && opts.session) {
        const actor = opts.session.snapshot().world.actors.get(followId)
        if (actor?.gone !== undefined) {
          letGo()
          changed()
        }
      }
      decide(t)
      keepPlea(followId ?? (shot?.focus.kind === "hero" ? shot.focus.id : null))
      if (mode() !== lastMode) changed()
      cost.decides++
      cost.decideMs += performance.now() - begin
    }
    easeFrame(shown, clear, dt)
    // nobody pleading in frame: the nudge eases away
    if (!pleading && (bias.x !== 0 || bias.y !== 0)) {
      const k = Math.exp(-FRAME_RATE * Math.max(0, dt))
      bias.x = Math.abs(bias.x * k) < 1e-3 ? 0 : bias.x * k
      bias.y = Math.abs(bias.y * k) < 1e-3 ? 0 : bias.y * k
    }
    const focus: Focus | null = followId ? { kind: "hero", id: followId } : shot ? shot.focus : null
    if (focus) {
      const subject = subjectOf(focus)
      if (subject) {
        tracked = trackStep(tracked, subject, dt)
        rig.aim(tracked, frame())
      }
      // a held director shot drifts slowly round (never while it glides, never with reduced motion)
      if (shot && !followId && !rig.gliding() && !still()) {
        const rate = shot.distance === "map" ? DRIFT.map : DRIFT.held
        rig.steer({ azimuth: rig.goal().azimuth + rate * dt })
      }
    }
    const ms = performance.now() - start
    cost.frames++
    cost.total += ms
    cost.max = Math.max(cost.max, ms)
  }
  rig.drive(drive)

  const offMove = rig.onMove((move) => {
    if (self) return
    userAt = now()
    const before = mode()
    stopShot()
    if (followId && releases(move)) letGo()
    if (mode() !== before) changed()
  })

  const typing = (t: EventTarget | null) => {
    const el = t as HTMLElement | null
    return !!el && typeof el.tagName === "string" && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
  }
  const key = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !host.isConnected) return
    if (e.code === "KeyB" && !e.repeat) api.director()
    // Esc hands the camera back: the follow ends; the director waits only for the viewer's last move
    else if (e.code === "Escape" && followId) api.release()
  }
  addEventListener("keydown", key)

  // A plain click on a hero's chip (down and up without a drag) follows them; a drag is the camera's.
  // The chips take no pointer events, so the click reaches the stage: it is matched to the chips' boxes.
  let press: { x: number; y: number; at: number; id: number } | null = null
  const down = (e: PointerEvent) => {
    press = e.button === 0 && e.isPrimary ? { x: e.clientX, y: e.clientY, at: now(), id: e.pointerId } : null
  }
  const up = (e: PointerEvent) => {
    const p = press
    press = null
    if (!p || !opts.chips || e.pointerId !== p.id) return
    if (!isClick(e.clientX - p.x, e.clientY - p.y, now() - p.at)) return
    const box = (opts.chipsHost ?? host).getBoundingClientRect()
    const id = opts.chips.hit(e.clientX - box.left, e.clientY - box.top)
    if (id) api.follow(id)
  }
  host.addEventListener("pointerdown", down)
  host.addEventListener("pointerup", up)

  const api: HallCamera = {
    follow(id) {
      const subject = heroPoint(id)
      stopShot()
      followId = id
      tracked = subject
      userAt = now()
      if (subject) {
        measure()
        const from = rig.get()
        const pose: CameraPose = {
          target: subject,
          azimuth: from.azimuth,
          elevation: Math.min(from.elevation, CLOSE.elevation + 4),
          distance: Math.min(from.distance, CLOSE.distance),
        }
        pose.target = framedTarget(subject, pose, lens(), frame())
        rig.aim(subject, frame())
        glide(pose, glideMs(from, pose, true))
      }
      changed()
    },
    release() {
      if (!followId) return
      letGo()
      changed()
    },
    director(on) {
      directorOn = on ?? !directorOn
      if (!directorOn) stopShot()
      // switched on: it may take the camera at once (B is the viewer asking for it)
      else userAt = null
      decideIn = 0
      changed()
      return directorOn
    },
    subject() {
      const focus: Focus | null = followId ? { kind: "hero", id: followId } : shot ? shot.focus : null
      return focus ? subjectOf(focus) : null
    },
    frame: () => ({ ...frame() }),
    state: () => ({
      mode: mode(),
      following: followId,
      director: directorOn,
      directable: opts.session !== null,
      shot: shot ? { key: shot.key, reason: shot.reason, distance: shot.distance } : null,
      waitMs: userAt === null ? 0 : Math.max(0, USER_WAIT_MS - (now() - userAt)),
    }),
    subscribe(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    stats() {
      const out = {
        frames: cost.frames,
        meanMs: cost.frames ? cost.total / cost.frames : 0,
        maxMs: cost.max,
        decides: cost.decides,
        decideMs: cost.decides ? cost.decideMs / cost.decides : 0,
      }
      cost.frames = 0
      cost.total = 0
      cost.max = 0
      cost.decides = 0
      cost.decideMs = 0
      return out
    },
    dispose() {
      removeEventListener("keydown", key)
      host.removeEventListener("pointerdown", down)
      host.removeEventListener("pointerup", up)
      resized?.disconnect()
      panels?.disconnect()
      offMove()
      rig.drive(null)
      rig.aim(null)
      fns.clear()
    },
  }
  return api
}

/**
 * The camera on a hall's (or the home's) HUD parts, published as `window.guildhall.ext.camera` until
 * its `dispose`. `director` sets the switch where the link does not (`?director=`, `?feed=story`).
 */
export function mountHallCamera(
  parts: HudParts,
  opts: {
    session: HallSession | null
    places: Pick<SessionPlaces, "placeAt"> | null
    query: Pick<URLSearchParams, "get">
    director?: boolean
  },
): HallCamera {
  const camera = createHallCamera({
    stage: parts.stage,
    hud: parts.viewer.hud,
    host: parts.viewer.stage,
    places: parts.places,
    heroAt: parts.heroAt,
    session: opts.session,
    sessionPlaces: opts.places,
    ships: () => parts.fx?.ships?.ships() ?? null,
    query: opts.query,
    chips: parts.chips,
    chipsHost: parts.viewer.labels,
    ...(opts.director !== undefined ? { director: opts.director } : {}),
  })
  const ext = window.guildhall?.ext as Record<string, unknown> | undefined
  if (ext) ext.camera = camera
  const dispose = camera.dispose
  camera.dispose = () => {
    dispose()
    if (ext?.camera === camera) delete ext.camera
  }
  return camera
}
