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
import { distanceRange, type RigMove, type Stage } from "@guildhall/render"
import { type Shot as DirectorShot, type Distance, director, type Focus } from "@guildhall/sim"
import type { ViewerHud } from "@guildhall/ui"
import type { BuiltPlace } from "../hexworld/job.ts"
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

const RAD = Math.PI / 180
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

/** The camera's lens: vertical field of view (degrees), width over height. */
export interface Lens {
  fov: number
  aspect: number
}

/**
 * The orbit target that puts `subject` at the clear frame's middle, seen from `pose`'s angles and
 * distance: moved across the ground along the view's right and forward (foreshortened by the tilt).
 * Pure and exact for a subject level with the target (the subject sits on the ray through the frame's
 * middle): a point `s` metres ahead of the target on its level shows at NDC y = s sin e / ((D + s cos e) ty).
 */
export function framedTarget(
  subject: Vec3,
  pose: Pick<CameraPose, "azimuth" | "elevation" | "distance">,
  lens: Lens,
  frame: ClearFrame,
): Vec3 {
  if (frame.x === 0 && frame.y === 0) return [subject[0], subject[1], subject[2]]
  const ty = Math.tan((lens.fov / 2) * RAD)
  const el = clamp(pose.elevation, 5, 89) * RAD
  const sin = Math.sin(el)
  const cos = Math.cos(el)
  const d = pose.distance
  // how far ahead of the target the subject must stand (its depth grows with it), then how far across
  const fy = clamp(frame.y, -0.9, 0.9)
  const along = (fy * ty * d) / Math.max(0.05, sin - fy * ty * cos)
  const across = frame.x * ty * lens.aspect * (d + along * cos)
  const az = pose.azimuth * RAD
  // the rig looks along (-sin az, -cos az) on the ground; its right is (cos az, -sin az)
  const rx = Math.cos(az)
  const rz = -Math.sin(az)
  const fx = -Math.sin(az)
  const fz = -Math.cos(az)
  return [subject[0] - rx * across - fx * along, subject[1], subject[2] - rz * across - fz * along]
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
  if (distance === "map") return at(sizes.map, 60)
  if (distance === "close") return at(CLOSE.distance, CLOSE.elevation)
  if (focus === "place") return at(Math.min(150, 42 + Math.sqrt(Math.max(0, sizes.tiles ?? 0)) * 6), 40)
  if (focus === "harbour") return at(58, 34)
  return at(30, 32)
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
  sessionPlaces: SessionPlaces | null
  /** The harbour's ships now (their centroid frames the harbour), else null. */
  ships?: () => readonly { at: Vec3 }[] | null
  query: Pick<URLSearchParams, "get">
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
  let directorOn = directorDefault(opts.query)
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
  const frame = (): ClearFrame => clear
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
  const subjectOf = (focus: Focus): Vec3 | null => {
    switch (focus.kind) {
      case "hero":
        return heroPoint(focus.id)
      case "place": {
        const p = placeOf(focus.place)
        return p ? [p.at[0], p.at[1], p.at[2]] : null
      }
      case "harbour":
        return harbourPoint()
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
  const changed = () => {
    const m = mode()
    lastMode = m
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
    const next = director.pick(snap.world, snap.world.recent, snap.clock.at, shot ? { shot } : {})
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
    rig.aim(pose.target)
    glide(pose, glideMs(from, pose))
    changed()
  }
  const sizesOf = (focus: Focus): ShotSizes => ({
    map: mapDistance(),
    ...(focus.kind === "place" ? { tiles: placeOf(focus.place)?.tiles ?? 0 } : {}),
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
      if (mode() !== lastMode) changed()
      cost.decides++
      cost.decideMs += performance.now() - begin
    }
    const focus: Focus | null = followId ? { kind: "hero", id: followId } : shot ? shot.focus : null
    if (focus) {
      const subject = subjectOf(focus)
      if (subject) {
        tracked = trackStep(tracked, subject, dt)
        rig.aim(framedTarget(tracked, rig.goal(), lens(), frame()))
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
        rig.aim(pose.target)
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
    frame: () => ({ ...clear }),
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
