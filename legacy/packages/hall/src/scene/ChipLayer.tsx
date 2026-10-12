import { addAfterEffect, type RootStore } from "@react-three/fiber"
import type { CSSProperties, ReactNode } from "react"
import { useSyncExternalStore } from "react"
import { createRoot, type Root } from "react-dom/client"
import { type Camera, type Object3D, OrthographicCamera, PerspectiveCamera, Vector3 } from "three"

/**
 * One HTML overlay for every `<Label>` (scene/Label.tsx) on a canvas: one container over the canvas,
 * one React root rendering every label into it, and one pass a frame that places them all.
 *
 * drei's `<Html>` made each label a ReactDOM root of its own with its own frame callback; with a
 * crowd of hundreds that was hundreds of roots, commits and callbacks. Here a label is an entry in
 * its canvas's layer: the layer renders its content (re-rendering only the entries that changed),
 * and after each frame is drawn it projects every anchor and writes a transform, a z-index and a
 * display — each only when it changed. A label behind the camera or well off screen is not shown.
 *
 * The DOM is drei's, so hall.css and the declutter (scene/chips.ts) see the same thing: an outer
 * box at the anchor's screen point (transform-origin 0 0, z-index by distance) holding the label's
 * own box (centred on it with `center`, then the label's style and class).
 */

/** What a label shows: set on every render of its `<Label>`. */
export interface LabelContent {
  children: ReactNode
  style: CSSProperties | undefined
  className: string | undefined
  center: boolean
}

export interface Placed {
  key: number
  /** The `<Label>`'s group: the label sits on its world position. */
  anchor: Object3D | null
  content: LabelContent
  /** Z-index at the camera's near plane and at its far plane (drei's `zIndexRange`). */
  zIndexRange: readonly [number, number]
  /** The outer box (null until the layer has rendered it). */
  outer: HTMLElement | null
  // ── written state ──
  shown: boolean
  x: number
  y: number
  z: number
  // ── for the layer's React root ──
  version: number
  listener: (() => void) | null
  subscribe: (listener: () => void) => () => void
  attach: (el: HTMLElement | null) => void
}

/** drei's default z-index range. */
export const Z_RANGE: readonly [number, number] = [16777271, 0]
/** Px past the canvas edge an anchor may sit and still show: a chip stands up to ~250 px above it. */
export const MARGIN = 300
/** A move under this (px) is not written. */
const EPS = 0.001

let keys = 0

export function placed(): Placed {
  const label: Placed = {
    key: keys++,
    anchor: null,
    content: { children: null, style: undefined, className: undefined, center: false },
    zIndexRange: Z_RANGE,
    outer: null,
    shown: false,
    x: Number.NaN,
    y: Number.NaN,
    z: Number.NaN,
    version: 0,
    listener: null,
    subscribe(listener) {
      label.listener = listener
      return () => {
        if (label.listener === listener) label.listener = null
      }
    },
    attach(el) {
      label.outer = el
      // Hidden until the layer has placed it: never a frame at the canvas's top-left corner.
      label.shown = false
      label.x = Number.NaN
      label.y = Number.NaN
      label.z = Number.NaN
      if (el) el.style.display = "none"
    },
  }
  return label
}

/** New content for `label` (from its `<Label>`'s render): its entry in the layer re-renders. */
export function setContent(
  label: Placed,
  content: LabelContent,
  zIndexRange: readonly [number, number],
): void {
  label.content = content
  label.zIndexRange = zIndexRange
  label.version++
  label.listener?.()
}

const at = new Vector3()
const eye = new Vector3()
const look = new Vector3()

/**
 * Place every label for `camera` on a canvas `width` × `height` CSS px: one pass, no allocations,
 * the DOM written only where something changed. Exported for tests.
 */
export function place(labels: readonly Placed[], camera: Camera, width: number, height: number): void {
  eye.setFromMatrixPosition(camera.matrixWorld)
  camera.getWorldDirection(look)
  const ranged = camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera
  const near = ranged ? camera.near : 0
  const far = ranged ? camera.far : 1
  for (const label of labels) {
    const { outer, anchor } = label
    if (!outer || !anchor) continue
    at.setFromMatrixPosition(anchor.matrixWorld)
    const distance = at.distanceTo(eye)
    // Behind the camera (drei: more than 90° off the view direction) projects to a mirrored point.
    const behind = (at.x - eye.x) * look.x + (at.y - eye.y) * look.y + (at.z - eye.z) * look.z < 0
    at.project(camera)
    const x = (at.x * 0.5 + 0.5) * width
    const y = (-at.y * 0.5 + 0.5) * height
    const show = !behind && x > -MARGIN && x < width + MARGIN && y > -MARGIN && y < height + MARGIN
    if (show !== label.shown) {
      label.shown = show
      outer.style.display = show ? "block" : "none"
    }
    if (!show) continue
    if (!(Math.abs(x - label.x) <= EPS && Math.abs(y - label.y) <= EPS)) {
      label.x = x
      label.y = y
      outer.style.transform = `translate3d(${x}px,${y}px,0)`
    }
    if (ranged) {
      // drei's objectZIndex: linear in the distance, zIndexRange[0] at the near plane.
      const [front, back] = label.zIndexRange
      const a = (back - front) / (far - near)
      const z = Math.round(a * distance + back - a * far)
      if (z !== label.z) {
        label.z = z
        outer.style.zIndex = `${z}`
      }
    }
  }
}

// ── the layer: one per canvas ─────────────────────────────────────────────────────────────────

interface Layer {
  labels: readonly Placed[]
  listener: (() => void) | null
  container: HTMLElement
  root: Root
  stop: () => void
  /** A pending teardown (the last label left). */
  drop: ReturnType<typeof setTimeout> | null
}

const layers = new Map<RootStore, Layer>()

/** Put `label` in its canvas's layer (made on the first label); returns the way out. */
export function join(store: RootStore, label: Placed): () => void {
  const layer = layerOf(store)
  if (layer.drop !== null) {
    clearTimeout(layer.drop)
    layer.drop = null
  }
  layer.labels = [...layer.labels, label]
  layer.listener?.()
  return () => {
    layer.labels = layer.labels.filter((other) => other !== label)
    layer.listener?.()
    // A root is never unmounted inside a commit (React refuses): from a task, if still empty then.
    if (layer.labels.length === 0 && layer.drop === null)
      layer.drop = setTimeout(() => {
        layer.drop = null
        if (layer.labels.length > 0 || layers.get(store) !== layer) return
        layers.delete(store)
        layer.stop()
        layer.root.unmount()
        layer.container.remove()
      }, 0)
  }
}

function layerOf(store: RootStore): Layer {
  const known = layers.get(store)
  if (known) return known
  const { gl, events } = store.getState()
  // Where drei put each label: the element events are connected to, or the canvas's parent.
  const target = (events.connected as HTMLElement | undefined) ?? gl.domElement.parentElement ?? document.body
  const container = document.createElement("div")
  // Fills the canvas's box; no events; its layout and paint kept to itself (a chip's change never
  // lays out the page).
  container.style.cssText = "position:absolute;inset:0;pointer-events:none;contain:layout paint;"
  target.appendChild(container)
  const layer: Layer = {
    labels: [],
    listener: null,
    container,
    root: createRoot(container),
    // After the frame is drawn: every anchor and the camera hold this frame's matrices.
    stop: addAfterEffect(() => {
      const { camera, size } = store.getState()
      place(layer.labels, camera, size.width, size.height)
    }),
    drop: null,
  }
  layers.set(store, layer)
  layer.root.render(<Labels layer={layer} />)
  return layer
}

function Labels({ layer }: { layer: Layer }) {
  const labels = useSyncExternalStore(
    (listener) => {
      layer.listener = listener
      return () => {
        if (layer.listener === listener) layer.listener = null
      }
    },
    () => layer.labels,
  )
  return labels.map((label) => <Entry key={label.key} label={label} />)
}

const OUTER: CSSProperties = { position: "absolute", top: 0, left: 0, transformOrigin: "0 0" }
const CENTRED = "translate3d(-50%,-50%,0)"

function Entry({ label }: { label: Placed }) {
  useSyncExternalStore(label.subscribe, () => label.version)
  const { children, style, className, center } = label.content
  return (
    <div ref={label.attach} style={OUTER}>
      <div
        className={className}
        style={{ position: "absolute", transform: center ? CENTRED : "none", ...style }}
      >
        {children}
      </div>
    </div>
  )
}
