/**
 * A translate / yaw handle on the stage (three's TransformControls), for the composer and the grip
 * editor, so apps never import three. Snapping is ours and absolute: positions land on multiples of
 * the step, yaw on multiples of the step in degrees, whatever the object started at.
 */
import { log } from "@guildhall/core"
import { Euler, type Object3D, type Quaternion } from "three"
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"
import type { Stage } from "./stage.ts"

const logger = log("render:gizmo")

export type GizmoMode = "translate" | "rotate"

/** Where the attached object stands: metres, and `rot` radians about +y (a recipe instance's terms). */
export interface GizmoPose {
  position: [number, number, number]
  rot: number
}

export interface GizmoOpts {
  mode: GizmoMode
  /** Metres in translate mode, degrees in rotate mode; 0 is free. */
  snap: number
  /** Every drag step, after snapping. */
  onChange?(pose: GizmoPose): void
}

export interface Gizmo {
  attach(object: Object3D): void
  detach(): void
  setMode(mode: GizmoMode): void
  /** In the current mode's unit (see `GizmoOpts.snap`), e.g. a finer step while alt is held. */
  setSnap(snap: number): void
  dispose(): void
}

const RAD = Math.PI / 180

/** `value` on the nearest multiple of `step`; a step of 0 (or less) leaves it free. */
export function snapTo(value: number, step: number): number {
  if (!(step > 0)) return value
  const snapped = Math.round(value / step) * step
  // Fold -0 into 0 so snapped poses compare and print cleanly.
  return snapped === 0 ? 0 : snapped
}

/** `rad` wrapped into (-π, π] and snapped to `stepDeg` degrees (0 = free). */
export function snapYaw(rad: number, stepDeg: number): number {
  let yaw = snapTo(rad, stepDeg * RAD)
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
  if (yaw === -Math.PI) yaw = Math.PI
  return yaw === 0 ? 0 : yaw
}

/** The heading of `q` about +y, whatever the turn (an XYZ Euler flips x and z past ±90°; YXZ does not). */
export function yawOf(q: Quaternion): number {
  return new Euler().setFromQuaternion(q, "YXZ").y
}

/** A client-space point as normalized device coordinates of `rect` (x right, y up, both -1…1). */
export function toNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }
}

/**
 * A gizmo on `stage`. Translate moves on all three axes; rotate turns about +y only. It takes the
 * canvas's pointer events in the capture phase: a press on a handle never reaches the orbit camera,
 * while a press anywhere else orbits as before.
 */
export function createGizmo(stage: Stage, opts: GizmoOpts): Gizmo {
  const canvas = stage.renderer.domElement
  // No dom element: we route the pointer ourselves, so the orbit input can be held off a drag.
  const controls = new TransformControls(stage.camera)
  const helper = controls.getHelper()
  stage.scene.add(helper)
  let mode = opts.mode
  let snap = opts.snap

  const applyMode = () => {
    controls.setMode(mode)
    controls.setSpace("world")
    controls.showX = mode === "translate"
    controls.showZ = mode === "translate"
  }
  applyMode()

  const pose = (object: Object3D): GizmoPose => {
    const p = object.position
    return { position: [p.x, p.y, p.z], rot: yawOf(object.quaternion) }
  }

  controls.addEventListener("objectChange", () => {
    const object = controls.object
    if (!object) return
    if (mode === "translate") {
      const p = object.position
      p.set(snapTo(p.x, snap), snapTo(p.y, snap), snapTo(p.z, snap))
    } else {
      object.rotation.set(0, snapYaw(yawOf(object.quaternion), snap), 0)
    }
    opts.onChange?.(pose(object))
  })

  // TransformControls reads the pointer as NDC plus button (its own handlers pass the same shape);
  // the typings say PointerEvent.
  const pointer = (e: PointerEvent) =>
    ({
      ...toNdc(e.clientX, e.clientY, canvas.getBoundingClientRect()),
      button: e.button,
    }) as unknown as PointerEvent

  const down = (e: PointerEvent) => {
    if (!controls.object) return
    controls.pointerHover(pointer(e))
    if (controls.axis === null) return
    e.stopImmediatePropagation()
    canvas.setPointerCapture(e.pointerId)
    controls.pointerDown(pointer(e))
  }
  const move = (e: PointerEvent) => {
    if (!controls.object) return
    if (!controls.dragging) {
      controls.pointerHover(pointer(e))
      return
    }
    e.stopImmediatePropagation()
    controls.pointerMove(pointer(e))
  }
  const up = (e: PointerEvent) => {
    if (!controls.dragging) return
    e.stopImmediatePropagation()
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    controls.pointerUp(pointer(e))
  }
  canvas.addEventListener("pointerdown", down, { capture: true })
  canvas.addEventListener("pointermove", move, { capture: true })
  canvas.addEventListener("pointerup", up, { capture: true })
  canvas.addEventListener("pointercancel", up, { capture: true })

  return {
    attach(object) {
      controls.attach(object)
    },
    detach() {
      controls.detach()
    },
    setMode(next) {
      mode = next
      applyMode()
    },
    setSnap(next) {
      snap = next
    },
    dispose() {
      canvas.removeEventListener("pointerdown", down, { capture: true })
      canvas.removeEventListener("pointermove", move, { capture: true })
      canvas.removeEventListener("pointerup", up, { capture: true })
      canvas.removeEventListener("pointercancel", up, { capture: true })
      controls.detach()
      helper.removeFromParent()
      // Not controls.dispose(): it disconnects a dom element this one never had, which throws.
      helper.dispose()
      logger.debug("disposed")
    },
  }
}
