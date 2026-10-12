import type { CameraPose } from "@guildhall/core"

/**
 * The orbit camera's maths. A pose sits on a sphere around its target: azimuth 0 looks from +z (the
 * side a piece's front faces), positive azimuth swings toward +x, elevation 90 looks straight down.
 */

type Vec3 = [number, number, number]

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
/** Orbit input stops short of the poles, where the view would flip. */
const MAX_ELEVATION = 89
const MIN_DISTANCE = 0.1

/** Where the camera stands for a pose. */
export function poseToCamera(pose: CameraPose): Vec3 {
  const [tx, ty, tz] = pose.target
  const az = pose.azimuth * RAD
  const el = pose.elevation * RAD
  const flat = pose.distance * Math.cos(el)
  return [tx + flat * Math.sin(az), ty + pose.distance * Math.sin(el), tz + flat * Math.cos(az)]
}

/** The pose of a camera standing at `position` and looking at `target`. */
export function cameraToPose(position: Vec3, target: Vec3): CameraPose {
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  const dz = position[2] - target[2]
  const distance = Math.hypot(dx, dy, dz)
  return {
    target: [...target],
    azimuth: Math.atan2(dx, dz) * DEG,
    elevation: distance === 0 ? 0 : Math.asin(dy / distance) * DEG,
    distance,
  }
}

/**
 * Mouse orbit on an element: left drag orbits, right (or shift) drag pans across the view, the wheel
 * zooms. It only reads and writes poses, so the pose stays the one source of truth. Returns a detach.
 */
export function attachOrbitInput(
  el: HTMLElement,
  pose: { get(): CameraPose; set(p: CameraPose): void },
): () => void {
  let drag: { x: number; y: number; pan: boolean } | null = null

  const down = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }
    el.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.x = e.clientX
    drag.y = e.clientY
    const p = pose.get()
    if (!drag.pan) {
      const elevation = Math.min(MAX_ELEVATION, Math.max(-MAX_ELEVATION, p.elevation + dy * 0.3))
      pose.set({ ...p, azimuth: p.azimuth - dx * 0.3, elevation })
      return
    }
    // Pan across the ground plane, faster the farther out the camera stands.
    const k = p.distance * 0.0015
    const az = p.azimuth * RAD
    const right: Vec3 = [Math.cos(az), 0, -Math.sin(az)]
    const forward: Vec3 = [-Math.sin(az), 0, -Math.cos(az)]
    const [tx, ty, tz] = p.target
    pose.set({
      ...p,
      target: [
        tx - right[0] * dx * k + forward[0] * dy * k,
        ty,
        tz - right[2] * dx * k + forward[2] * dy * k,
      ],
    })
  }
  const up = (e: PointerEvent) => {
    drag = null
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }
  const wheel = (e: WheelEvent) => {
    e.preventDefault()
    const p = pose.get()
    pose.set({ ...p, distance: Math.max(MIN_DISTANCE, p.distance * Math.exp(e.deltaY * 0.001)) })
  }
  const menu = (e: Event) => e.preventDefault()

  el.addEventListener("pointerdown", down)
  el.addEventListener("pointermove", move)
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
  el.addEventListener("wheel", wheel, { passive: false })
  el.addEventListener("contextmenu", menu)
  return () => {
    el.removeEventListener("pointerdown", down)
    el.removeEventListener("pointermove", move)
    el.removeEventListener("pointerup", up)
    el.removeEventListener("pointercancel", up)
    el.removeEventListener("wheel", wheel)
    el.removeEventListener("contextmenu", menu)
  }
}
