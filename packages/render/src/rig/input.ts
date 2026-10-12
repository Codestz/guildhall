import type { World } from "./world.ts"

/**
 * The rig's DOM input: pointer, wheel, touch and keys, turned into the rig's moves. It holds no camera
 * state of its own, only what is pressed.
 *
 *   orbit  drag orbits · right drag or shift drag pans · wheel zooms toward the cursor
 *          touch: one finger orbits, two pinch to zoom and drag to pan
 *   free   WASD or arrows move along the view · E or Space up, Q or C down · shift fast
 *          drag looks (double click locks the pointer) · wheel sets the speed · Escape back to orbit
 *          touch: one finger looks, two drag and pinch to move
 *   F      toggles free flight on a world that allows it
 */

type Vec3 = [number, number, number]

export interface Ray {
  origin: Vec3
  dir: Vec3
}

/** What the rig does for its input. */
export interface RigHandlers {
  mode(): "orbit" | "free"
  world(): World | null
  /** True while the rig glides: input waits. */
  busy(): boolean
  /** Orbit by degrees. */
  orbit(dAzimuth: number, dElevation: number): void
  /** Pan by screen pixels. */
  pan(dx: number, dy: number): void
  /** Zoom by a distance factor toward the point `ray` meets (null: toward the target). */
  zoom(factor: number, ray: Ray | null): void
  /** Turn the free camera by degrees. */
  look(dYaw: number, dPitch: number): void
  /** Move the free camera at once, metres along its view, its right and up. */
  nudge(forward: number, right: number, up: number): void
  speed(): number
  setSpeed(factor: number): void
  toggle(): void
  leave(): void
  /** The camera's ray through a point of the canvas (normalised device coordinates). */
  ray(ndcX: number, ndcY: number): Ray
}

/** The keys held: each axis −1..1. */
export interface Keys {
  forward: number
  right: number
  up: number
  fast: boolean
}

export interface RigInputHandle {
  keys(): Keys
  /** Re-reads the world (touch handling depends on it). */
  sync(): void
  detach(): void
}

const ORBIT_DEG_PX = 0.3
const LOOK_DEG_PX = 0.22
const LOCKED_DEG_PX = 0.12
const ZOOM_PER_PX = 0.001
const SPEED_PER_PX = 0.0015

const MOVES: Record<string, keyof Omit<Keys, "fast">> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "forward",
  ArrowDown: "forward",
  KeyD: "right",
  ArrowRight: "right",
  KeyA: "right",
  ArrowLeft: "right",
  KeyE: "up",
  Space: "up",
  KeyQ: "up",
  KeyC: "up",
}
const NEGATIVE = new Set(["KeyS", "ArrowDown", "KeyA", "ArrowLeft", "KeyQ", "KeyC"])

/** True when a key belongs to whatever has focus (a field), not to the camera. */
function typing(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null
  if (!t || typeof t.tagName !== "string") return false
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable
}

/** Wheel pixels whatever unit the browser reports in. */
const wheelPx = (e: WheelEvent) => e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)

export function attachRigInput(el: HTMLElement, rig: RigHandlers): RigInputHandle {
  const pointers = new Map<number, { x: number; y: number }>()
  let drag: { pan: boolean } | null = null
  /** The two-finger gesture's last midpoint and spread. */
  let pinch: { x: number; y: number; spread: number } | null = null
  const held = new Set<string>()
  let shift = false

  const flies = () => {
    const w = rig.world()
    return w !== null && w.free !== false
  }
  const ndc = (x: number, y: number) => {
    const box = el.getBoundingClientRect()
    return [
      ((x - box.left) / Math.max(1, box.width)) * 2 - 1,
      -((y - box.top) / Math.max(1, box.height)) * 2 + 1,
    ]
  }
  const rayAt = (x: number, y: number) => {
    const [nx, ny] = ndc(x, y)
    return rig.ray(nx as number, ny as number)
  }
  const twoFinger = () => {
    const [a, b] = [...pointers.values()]
    if (!a || !b) return null
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }

  const down = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    el.setPointerCapture?.(e.pointerId)
    drag = { pan: e.button === 2 || e.shiftKey }
    pinch = pointers.size === 2 ? twoFinger() : null
  }
  const move = (e: PointerEvent) => {
    if (document.pointerLockElement === el && rig.mode() === "free") {
      if (!rig.busy()) rig.look(-e.movementX * LOCKED_DEG_PX, -e.movementY * LOCKED_DEG_PX)
      return
    }
    const last = pointers.get(e.pointerId)
    if (!last) return
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    last.x = e.clientX
    last.y = e.clientY
    if (rig.busy()) return
    const free = rig.mode() === "free"
    if (pointers.size >= 2) {
      const now = twoFinger()
      if (!now || !pinch) {
        pinch = now
        return
      }
      const mx = now.x - pinch.x
      const my = now.y - pinch.y
      const grow = now.spread / pinch.spread
      pinch = now
      if (free) {
        const k = rig.speed() * 0.02
        rig.nudge(my * k + (grow - 1) * rig.speed() * 1.5, -mx * k, 0)
      } else {
        rig.zoom(1 / grow, rayAt(now.x, now.y))
        rig.pan(mx, my)
      }
      return
    }
    if (free) rig.look(-dx * LOOK_DEG_PX, -dy * LOOK_DEG_PX)
    else if (drag?.pan) rig.pan(dx, dy)
    else rig.orbit(-dx * ORBIT_DEG_PX, dy * ORBIT_DEG_PX)
  }
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    pinch = pointers.size === 2 ? twoFinger() : null
    if (pointers.size === 0) drag = null
  }
  const wheel = (e: WheelEvent) => {
    e.preventDefault()
    if (rig.busy()) return
    const px = wheelPx(e)
    if (rig.mode() === "free") rig.setSpeed(Math.exp(-px * SPEED_PER_PX))
    else rig.zoom(Math.exp(px * ZOOM_PER_PX), rayAt(e.clientX, e.clientY))
  }
  const menu = (e: Event) => e.preventDefault()
  const dblclick = () => {
    if (rig.mode() !== "free" || document.pointerLockElement === el) return
    // Not every browser (nor headless) grants the lock: dragging still looks.
    Promise.resolve(el.requestPointerLock?.()).catch(() => {})
  }

  const keydown = (e: KeyboardEvent) => {
    shift = e.shiftKey
    if (!flies() || !el.isConnected || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    const free = rig.mode() === "free"
    if (e.code === "KeyF" && !e.repeat) {
      e.preventDefault()
      rig.toggle()
      return
    }
    if (e.code === "Escape" && free) {
      e.preventDefault()
      if (document.pointerLockElement === el) document.exitPointerLock?.()
      rig.leave()
      return
    }
    if (!free || !(e.code in MOVES)) return
    // A focused button must not take Space, nor the page the arrows.
    e.preventDefault()
    held.add(e.code)
  }
  const keyup = (e: KeyboardEvent) => {
    shift = e.shiftKey
    if (held.delete(e.code) && rig.mode() === "free") e.preventDefault()
  }
  const blur = () => {
    held.clear()
    shift = false
  }

  el.addEventListener("pointerdown", down)
  el.addEventListener("pointermove", move)
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
  el.addEventListener("wheel", wheel, { passive: false })
  el.addEventListener("contextmenu", menu)
  el.addEventListener("dblclick", dblclick)
  addEventListener("keydown", keydown)
  addEventListener("keyup", keyup)
  addEventListener("blur", blur)

  const axis = (name: keyof Omit<Keys, "fast">) => {
    let v = 0
    for (const code of held) if (MOVES[code] === name) v += NEGATIVE.has(code) ? -1 : 1
    return Math.max(-1, Math.min(1, v))
  }

  return {
    keys: () =>
      held.size === 0
        ? { forward: 0, right: 0, up: 0, fast: false }
        : { forward: axis("forward"), right: axis("right"), up: axis("up"), fast: shift },
    sync() {
      // A world screen owns its touches (pinch, two-finger moves); elsewhere the page keeps scrolling.
      el.style.touchAction = flies() ? "none" : ""
      if (!flies()) held.clear()
    },
    detach() {
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
      el.removeEventListener("wheel", wheel)
      el.removeEventListener("contextmenu", menu)
      el.removeEventListener("dblclick", dblclick)
      removeEventListener("keydown", keydown)
      removeEventListener("keyup", keyup)
      removeEventListener("blur", blur)
      if (document.pointerLockElement === el) document.exitPointerLock?.()
    },
  }
}
