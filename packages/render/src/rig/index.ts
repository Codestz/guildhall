import type { CameraPose } from "@guildhall/core"
import { type PerspectiveCamera, Vector3 } from "three"
import { cameraToPose, poseToCamera } from "../camera.ts"
import { attachRigInput, type RigHandlers } from "./input.ts"
import {
  clampEye,
  clampOrbit,
  distanceRange,
  floorAt,
  type Lens,
  nearPlane,
  pitchCeiling,
  type World,
  zoomFraction,
  zoomTilt,
} from "./world.ts"

/**
 * The stage's camera rig: one for every screen. `orbit` circles a target (drag to orbit, right drag or
 * shift to pan, the wheel zooms toward the cursor), eased so input never jerks; `free` flies (WASD,
 * Q/E, drag to look). Without a world it is the plain orbit a piece viewer wants; with one
 * (`setWorld`) it is held inside it: never under the ground or the water, never looking up from below
 * the horizon, never out past the sea. Poses set from code (`set`) land at once; input eases.
 */

export type RigMode = "orbit" | "free"

/**
 * What moved the camera (`Rig.onMove`): the viewer's input (`orbit`, `pan`, `zoom`, `free` for free
 * flight's looks and moves) or code (`glide`, `set`, `mode`). A pinch's small drift counts as `zoom`.
 */
export type RigMove = "orbit" | "pan" | "zoom" | "free" | "glide" | "set" | "mode"

/** The free camera's eye and heading: yaw as an orbit's azimuth, pitch up from level (degrees). */
export interface FreeState {
  eye: [number, number, number]
  yaw: number
  pitch: number
}

export interface Rig {
  /** The pose being drawn (in free flight, the eye and the point it looks at on the ground). */
  get(): CameraPose
  /** Puts the orbit at `pose` at once (leaving free flight). */
  set(pose: CameraPose): void
  /** Eases the orbit to `pose` (from free flight too). */
  glide(pose: CameraPose, ms?: number): void
  mode(): RigMode
  /** Free flight from the current view, or back to orbit (to `to`, else where it left off), eased. */
  setMode(mode: RigMode, to?: CameraPose): void
  /** Where leaving free flight glides to (by default the orbit pose it was entered from). */
  setHome(pose: CameraPose): void
  /** Holds the camera inside `world`; null frees it (a piece viewer). */
  setWorld(world: World | null): void
  world(): World | null
  /** Free flight's cruising speed, m/s (the wheel sets it). */
  speed(): number
  /** Places the free camera (debug and shots); enters free flight. */
  fly(state: FreeState): void
  free(): FreeState
  /** True while a glide runs. */
  gliding(): boolean
  /**
   * The orbit's target follows `target` (eased at the orbit's rate; a running glide lands on it) while
   * the viewer still turns and zooms, and a zoom closes in on it rather than on the cursor. Called each
   * frame by a follow camera; null lets go. Not a move (`onMove` does not hear it).
   */
  aim(target: Vec3 | null): void
  /** Eases the orbit's angles and distance toward `change` (a director's drift, a framing). Not a move. */
  steer(change: Partial<Omit<CameraPose, "target">>): void
  /** Where the orbit is easing to (its goal; the pose being drawn is `get`). */
  goal(): CameraPose
  /** Hears every move: the viewer's input, and code's glides and sets (see `RigMove`). */
  onMove(fn: (move: RigMove) => void): () => void
  /** Runs at the start of each `update`, before the easing (a follow camera aims here). */
  drive(fn: ((dt: number) => void) | null): void
  /** Called on a mode or speed change. */
  subscribe(fn: () => void): () => void
  /** Steps the easing and writes the camera; the stage calls it each frame before drawing. */
  update(dt: number): void
  dispose(): void
}

type Vec3 = [number, number, number]

const RAD = Math.PI / 180
/** Per-second easing rates: the orbit toward its goal, the free look toward its goal, free velocity. */
const ORBIT_RATE = 11
const LOOK_RATE = 18
const MOVE_RATE = 7
const GLIDE_MS = 900
/** Free flight's cruising speed range and start, m/s; shift multiplies it. */
const SPEED = { min: 2, max: 320, start: 22, fast: 4 } as const
/** Free flight's pitch range, degrees. */
const PITCH: [number, number] = [-88, 60]
/** The free camera's focus (what the haze, shadows and lamps centre on) stays within this, metres. */
const FOCUS: [number, number] = [20, 600]

const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, dt))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const copy = (p: CameraPose): CameraPose => ({ ...p, target: [...p.target] })
const smooth = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
/** The angle nearest `from` that equals `to` modulo 360. */
const near = (from: number, to: number) => to - 360 * Math.round((to - from) / 360)

/** The unit vector a free camera looks along. */
export function lookVector(yawDeg: number, pitchDeg: number): Vec3 {
  const y = yawDeg * RAD
  const p = pitchDeg * RAD
  return [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)]
}

/** The pose between `a` and `b` at `t` (0..1): the target on a line, the angles the short way, the distance on a log scale. */
export function blendPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  if (t <= 0) return copy(a)
  const mix = (x: number, y: number) => x + (y - x) * t
  return {
    target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])],
    azimuth: mix(a.azimuth, near(a.azimuth, b.azimuth)),
    elevation: mix(a.elevation, b.elevation),
    distance: Math.exp(mix(Math.log(Math.max(1e-3, a.distance)), Math.log(Math.max(1e-3, b.distance)))),
  }
}

export function createRig(camera: PerspectiveCamera, el: HTMLElement, initial: CameraPose): Rig {
  let world: World | null = null
  let mode: RigMode = "orbit"
  /** The orbit as drawn, and where input sends it. */
  let pose = copy(initial)
  let goal = copy(initial)
  /** The orbit pose free flight left from: Escape glides back to it. */
  let home: CameraPose | null = null
  const fly = {
    eye: [0, 0, 0] as Vec3,
    yaw: 0,
    pitch: 0,
    goalYaw: 0,
    goalPitch: 0,
    velocity: [0, 0, 0] as Vec3,
    speed: SPEED.start as number,
  }
  let glide: { from: CameraPose; to: CameraPose; t: number; ms: number } | null = null
  /** The target a follow camera holds the orbit on (`aim`), and the driver run before each step. */
  let aimed: Vec3 | null = null
  let driver: ((dt: number) => void) | null = null
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const fn of listeners) fn()
  }
  const movers = new Set<(move: RigMove) => void>()
  const moved = (move: RigMove) => {
    for (const fn of movers) fn(move)
  }

  const lens = (): Lens => ({ fov: camera.fov, aspect: camera.aspect, far: camera.far })
  const held = (p: CameraPose) => (world ? clampOrbit(p, world, lens()) : p)
  /** The highest free flight may look from where its eye is: tipped down high up (world.ts). */
  const pitchCap = () => {
    const cap = world ? Math.min(PITCH[1], pitchCeiling(fly.eye, world, lens())) : PITCH[1]
    return Math.max(PITCH[0], cap)
  }
  const pitchHeld = (pitch: number) => clamp(pitch, PITCH[0], pitchCap())

  /** The point the free eye looks at on the floor (or out to the focus range when it looks up). */
  const freePose = (): CameraPose => {
    const dir = lookVector(fly.yaw, fly.pitch)
    const floor = world ? floorAt(world, fly.eye[0], fly.eye[2]) : 0
    const drop = fly.eye[1] - floor
    const hit = dir[1] < -1e-3 ? drop / -dir[1] : FOCUS[1]
    const d = clamp(hit, FOCUS[0], FOCUS[1])
    const target: Vec3 = [fly.eye[0] + dir[0] * d, fly.eye[1] + dir[1] * d, fly.eye[2] + dir[2] * d]
    return cameraToPose([...fly.eye], target)
  }

  /** Inside a world the near plane follows the eye's height over the floor (world.ts `nearPlane`). */
  const fitNear = () => {
    if (!world) return
    const { x, y, z } = camera.position
    const near = nearPlane(y - floorAt(world, x, z))
    if (Math.abs(near - camera.near) <= camera.near * 0.01) return
    camera.near = near
    camera.updateProjectionMatrix()
  }

  const write = () => {
    if (mode === "free" && !glide) {
      const dir = lookVector(fly.yaw, fly.pitch)
      camera.position.set(...fly.eye)
      camera.lookAt(fly.eye[0] + dir[0], fly.eye[1] + dir[1], fly.eye[2] + dir[2])
    } else {
      camera.position.set(...poseToCamera(pose))
      camera.lookAt(...pose.target)
    }
    fitNear()
  }

  const enterFree = (state?: FreeState) => {
    if (mode === "orbit") home = copy(goal)
    glide = null
    if (state) {
      fly.eye = [...state.eye]
      fly.yaw = state.yaw
      fly.pitch = state.pitch
    } else {
      fly.eye = poseToCamera(pose)
      fly.yaw = pose.azimuth
      fly.pitch = -pose.elevation
    }
    if (world) fly.eye = clampEye(fly.eye, world, lens())
    fly.pitch = pitchHeld(fly.pitch)
    fly.goalYaw = fly.yaw
    fly.goalPitch = fly.pitch
    fly.velocity = [0, 0, 0]
    const changed = mode !== "free"
    mode = "free"
    write()
    if (changed) notify()
  }

  const startGlide = (to: CameraPose, ms: number) => {
    const from = mode === "free" ? freePose() : copy(pose)
    const end = held(to)
    const changed = mode !== "orbit"
    mode = "orbit"
    pose = from
    goal = copy(end)
    glide = { from, to: end, t: 0, ms: Math.max(1, ms) }
    home = null
    write()
    if (changed) notify()
  }

  const step = (v: Vec3, target: Vec3, a: number) => {
    for (let i = 0; i < 3; i++) v[i] = (v[i] as number) + ((target[i] as number) - (v[i] as number)) * a
  }

  const input: RigHandlers = {
    mode: () => mode,
    world: () => world,
    busy: () => glide !== null,
    orbit(dAz, dEl) {
      goal = held({ ...goal, azimuth: goal.azimuth + dAz, elevation: goal.elevation + dEl })
      moved("orbit")
    },
    pan(dx, dy, soft) {
      moved(soft ? "zoom" : "pan")
      // held on a followed target, a pinch's drift does not slide the view off it
      if (soft && aimed) return
      // Across the ground, faster the farther out the camera stands.
      const k = goal.distance * 0.0015
      const az = goal.azimuth * RAD
      const [tx, ty, tz] = goal.target
      const x = tx - Math.cos(az) * dx * k - Math.sin(az) * dy * k
      const z = tz + Math.sin(az) * dx * k - Math.cos(az) * dy * k
      goal = held({ ...goal, target: [x, ty, z] })
    },
    zoom(factor, cursor) {
      moved("zoom")
      // following a target, the zoom closes in on it, not on the cursor
      const ray = aimed ? null : cursor
      const distance = goal.distance * factor
      if (!world) {
        goal = { ...goal, distance: Math.max(0.1, distance) }
        return
      }
      const range = distanceRange(world, lens())
      const next = clamp(distance, range[0], range[1])
      const k = next / goal.distance
      let [tx, ty, tz] = goal.target
      // Toward the point under the cursor: scaling about it keeps it under the cursor.
      if (ray && ray.dir[1] < -1e-3) {
        const s = (ray.origin[1] - ty) / -ray.dir[1]
        const hx = ray.origin[0] + ray.dir[0] * s
        const hz = ray.origin[2] + ray.dir[2] * s
        tx = hx + (tx - hx) * k
        tz = hz + (tz - hz) * k
      }
      const tilt = zoomTilt(goal.elevation, zoomFraction(goal.distance, range), zoomFraction(next, range))
      goal = held({ target: [tx, ty, tz], azimuth: goal.azimuth, elevation: tilt, distance: next })
    },
    look(dYaw, dPitch) {
      moved("free")
      fly.goalYaw += dYaw
      fly.goalPitch = pitchHeld(fly.goalPitch + dPitch)
    },
    nudge(forward, right, up) {
      moved("free")
      const dir = lookVector(fly.yaw, fly.pitch)
      const r: Vec3 = [Math.cos(fly.yaw * RAD), 0, -Math.sin(fly.yaw * RAD)]
      const eye: Vec3 = [
        fly.eye[0] + dir[0] * forward + r[0] * right,
        fly.eye[1] + dir[1] * forward + up,
        fly.eye[2] + dir[2] * forward + r[2] * right,
      ]
      fly.eye = world ? clampEye(eye, world, lens()) : eye
    },
    speed: () => fly.speed,
    setSpeed(factor) {
      fly.speed = clamp(fly.speed * factor, SPEED.min, SPEED.max)
      notify()
    },
    toggle() {
      moved("mode")
      if (mode === "free") startGlide(home ?? held(freePose()), GLIDE_MS)
      else enterFree()
    },
    leave() {
      if (mode === "free") moved("mode")
      if (mode === "free") startGlide(home ?? held(freePose()), GLIDE_MS)
    },
    ray(ndcX, ndcY) {
      const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld)
      const dir = new Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize()
      return { origin: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] }
    },
  }
  const handle = attachRigInput(el, input)

  const rig: Rig = {
    get: () => (mode === "free" && !glide ? freePose() : copy(pose)),
    set(p) {
      moved("set")
      const changed = mode !== "orbit"
      mode = "orbit"
      glide = null
      home = null
      pose = held(copy(p))
      goal = copy(pose)
      write()
      if (changed) notify()
    },
    glide(p, ms = GLIDE_MS) {
      moved("glide")
      startGlide(p, ms)
    },
    mode: () => mode,
    setMode(next, to) {
      moved("mode")
      if (next === "free") {
        if (mode !== "free" || glide) enterFree()
        return
      }
      if (mode === "free" || to) startGlide(to ?? home ?? held(freePose()), GLIDE_MS)
    },
    setHome(p) {
      home = copy(p)
    },
    setWorld(next) {
      world = next
      if (mode === "free") {
        if (world) fly.eye = clampEye(fly.eye, world, lens())
      } else {
        pose = held(pose)
        goal = held(goal)
      }
      handle.sync()
      write()
    },
    world: () => world,
    speed: () => fly.speed,
    fly(state) {
      moved("mode")
      enterFree(state)
    },
    free: () => ({ eye: [...fly.eye], yaw: fly.yaw, pitch: fly.pitch }),
    gliding: () => glide !== null,
    aim(target) {
      aimed = target ? [target[0], target[1], target[2]] : null
    },
    steer(change) {
      if (mode !== "orbit") return
      goal = held({ ...goal, ...change, target: goal.target })
    },
    goal: () => copy(goal),
    onMove(fn) {
      movers.add(fn)
      return () => movers.delete(fn)
    },
    drive(fn) {
      driver = fn
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    update(seconds) {
      // A frame after a hidden tab is long: step as if it were short, rather than leap.
      const dt = Math.min(0.1, seconds)
      driver?.(dt)
      // a followed target: the glide lands on where it is now, then the goal rides it
      if (aimed && mode === "orbit") {
        if (glide) glide.to = held({ ...glide.to, target: aimed })
        else goal = held({ ...goal, target: aimed })
      }
      if (glide) {
        glide.t = Math.min(1, glide.t + (dt * 1000) / glide.ms)
        pose = blendPose(glide.from, glide.to, smooth(glide.t))
        if (glide.t >= 1) {
          pose = copy(glide.to)
          goal = copy(glide.to)
          glide = null
        }
      } else if (mode === "orbit") {
        const a = ease(ORBIT_RATE, dt)
        const next = blendPose(pose, goal, a)
        // The goal's azimuth may wind past 360: follow it exactly rather than the short way round.
        next.azimuth = pose.azimuth + (goal.azimuth - pose.azimuth) * a
        pose = held(next)
      } else {
        const look = ease(LOOK_RATE, dt)
        fly.yaw += (fly.goalYaw - fly.yaw) * look
        fly.pitch += (fly.goalPitch - fly.pitch) * look
        const keys = handle.keys()
        const dir = lookVector(fly.yaw, fly.pitch)
        const r: Vec3 = [Math.cos(fly.yaw * RAD), 0, -Math.sin(fly.yaw * RAD)]
        const want: Vec3 = [
          dir[0] * keys.forward + r[0] * keys.right,
          dir[1] * keys.forward + keys.up,
          dir[2] * keys.forward + r[2] * keys.right,
        ]
        const len = Math.hypot(...want)
        const v = (fly.speed * (keys.fast ? SPEED.fast : 1)) / Math.max(1, len)
        step(fly.velocity, [want[0] * v, want[1] * v, want[2] * v], ease(MOVE_RATE, dt))
        const moved: Vec3 = [
          fly.eye[0] + fly.velocity[0] * dt,
          fly.eye[1] + fly.velocity[1] * dt,
          fly.eye[2] + fly.velocity[2] * dt,
        ]
        const kept = world ? clampEye(moved, world, lens()) : moved
        // Against a limit, the velocity into it stops (no pressing into the floor, then a lurch off it).
        for (let i = 0; i < 3; i++) if (kept[i] !== moved[i]) fly.velocity[i] = 0
        fly.eye = kept
        // Climbing tips the view down as it must; the goal follows so a drag never fights it.
        const cap = pitchCap()
        fly.goalPitch = Math.min(fly.goalPitch, cap)
        fly.pitch = Math.min(fly.pitch, cap)
      }
      write()
    },
    dispose() {
      handle.detach()
      listeners.clear()
      movers.clear()
      driver = null
    },
  }
  write()
  return rig
}
