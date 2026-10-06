import { MapControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { type ComponentRef, useEffect, useRef } from "react"
import {
  MOUSE,
  type OrthographicCamera as Ortho,
  type PerspectiveCamera as Persp,
  TOUCH,
  Vector3,
} from "three"
import { MODE } from "../guild/mode.ts"
import { opening, reducedMotion } from "../guild/opening.ts"
import { positions, useGuild, useGuildStore } from "../guild/useGuild.ts"
import { OpeningProgress } from "./OpeningCue.tsx"

/**
 * The camera: yours first, the Bard's when you hand it over (ADR 0005, season 2).
 *
 *   Views     Diorama (orthographic, the tabletop look) · Explore (perspective, low and close)
 *   Mouse     left-drag pans the ground · right-drag turns and tilts · wheel zooms to the cursor
 *   Keys      WASD / arrows pan · Q/E turn · R/F tilt · +/- zoom · B Bard on/off · V view
 *   Follow    clicking an adventurer keeps them centred while you still turn and zoom; Esc lets go
 *   Bard      the director (frames the most interesting event, drifts when quiet). Any input of
 *             yours switches it off until you switch it back on — it never takes the camera back.
 */

type Controls = ComponentRef<typeof MapControls>

const REVEAL_S = 3.2
/** The showcase's directed opening (guild/opening.ts): hold, then reveal, then land. */
const SHOWCASE = MODE === "showcase"
/** Portrait screens close in on the keep by up to this much (a 390×844 phone gets all of it). */
const PORTRAIT_BOOST = 0.7
const PORTRAIT_ASPECT = 0.46
/** Direction from the target to the camera: the isometric angle. */
const ISO_DIR = new Vector3(1, 0.93, 1).normalize()
const TOP_DIR = new Vector3(0.001, 1, 0.01).normalize()
const HOME = new Vector3(0, 1, 10)
/** Perspective distances: overview, something happening, following someone. */
const FAR = 95
const NEAR = 30
const CLOSE = 11

const PAN_SPEED = 0.9
const TURN_SPEED = 1.4
const TILT_SPEED = 0.9
const UP = new Vector3(0, 1, 0)
/** Reused every frame: the camera loop allocates nothing (docs/perf-budget.md). */
const scratch = {
  dir: new Vector3(),
  offset: new Vector3(),
  forward: new Vector3(),
  right: new Vector3(),
  move: new Vector3(),
  axis: new Vector3(),
  tilted: new Vector3(),
  goal: new Vector3(),
  before: new Vector3(),
  hint: new Vector3(),
}

export function CameraRig() {
  const store = useGuildStore()
  const { view } = useGuild()
  const controls = useRef<Controls>(null)
  const ortho = useRef<Ortho>(null)
  const persp = useRef<Persp>(null)
  const revealed = useRef(0)
  const keys = useRef(new Set<string>())
  const following = useRef<string | null>(null)
  const size = useThree((state) => state.size)
  /** The default camera: switching views makes the other one default, and drei rebuilds the controls. */
  const defaultCamera = useThree((state) => state.camera)
  /**
   * Orthographic zoom that fits the keep; the island overview is a fraction of it. A portrait
   * screen fits by width, which leaves the island a band between two seas with 6px characters,
   * so it closes in (×1.7 on a phone held upright). Zooming out still reaches the whole island.
   */
  const base = Math.min(size.width / 44, size.height / 31)
  const upright = (1 - size.width / Math.max(size.height, 1)) / (1 - PORTRAIT_ASPECT)
  const portrait = Math.min(1, Math.max(0, upright))
  const fit = base * (1 + PORTRAIT_BOOST * portrait)
  const wide = fit * 0.42
  const widest = base * 0.42 * 0.5

  // Your input turns the Bard off — and keeps it off. Listened to on the canvas itself: drei
  // recreates the controls whenever the default camera changes, so a listener on them gets lost.
  const dom = useThree((state) => state.gl.domElement)
  useEffect(() => {
    const takeOver = () => {
      if (revealed.current >= 1 && store.bard) store.setBard(false)
    }
    dom.addEventListener("pointerdown", takeOver)
    dom.addEventListener("wheel", takeOver, { passive: true })
    return () => {
      dom.removeEventListener("pointerdown", takeOver)
      dom.removeEventListener("wheel", takeOver)
    }
  }, [dom, store])

  // Keyboard: held keys move the camera smoothly (read in useFrame); B and V are toggles.
  useEffect(() => {
    const typing = (event: KeyboardEvent) =>
      event.target instanceof HTMLElement && /input|textarea|select/i.test(event.target.tagName)
    const down = (event: KeyboardEvent) => {
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === "b") return store.setBard(!store.bard)
      if (key === "v") return store.setView(store.view === "diorama" ? "explore" : "diorama")
      if (MOVE_KEYS.has(key)) {
        keys.current.add(key)
        if (store.bard && revealed.current >= 1) store.setBard(false)
        if (key.startsWith("arrow")) event.preventDefault()
      }
    }
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const blur = () => keys.current.clear()
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [store])

  /** Where the camera looked and stood last frame: restored after drei recreates the controls. */
  const last = useRef({ target: HOME.clone(), position: HOME.clone().addScaledVector(ISO_DIR, FAR), zoom: 0 })

  // Switching views (or any recreation of the controls) keeps where you were looking and from
  // which side; the distance carries over as the equivalent zoom.
  useEffect(() => {
    const control = controls.current
    if (!control || revealed.current < 1) return
    const camera = defaultCamera as Ortho | Persp
    const { target, position, zoom } = last.current
    const dir = position.clone().sub(target).normalize()
    control.target.copy(target)
    if ((camera as Ortho).isOrthographicCamera) {
      const o = camera as Ortho
      const distance = position.distanceTo(target)
      o.zoom = zoom > 0 ? zoom : Math.min(fit * 8, Math.max(wide * 0.5, wide * (FAR / Math.max(distance, 1))))
      o.position.copy(target).addScaledVector(dir, 220)
      o.updateProjectionMatrix()
    } else {
      const distance =
        zoom > 0 ? Math.min(260, Math.max(CLOSE, FAR * (wide / zoom))) : position.distanceTo(target)
      camera.position.copy(target).addScaledVector(dir, distance)
    }
    control.update()
  }, [defaultCamera, fit, wide])

  useFrame((_, delta) => {
    const control = controls.current
    if (!control) return
    const camera = control.object as Ortho | Persp
    const isOrtho = (camera as Ortho).isOrthographicCamera === true

    // 1. The dollhouse reveal, once. The showcase holds it until the world has loaded (the title
    //    card is up), cuts straight to the end for reduced motion, and lands the opening.
    if (revealed.current < 1) {
      const stage = SHOWCASE ? opening.get().stage : "landed"
      // A long first frame (shader compiles) must not skip half the showcase's sweep.
      const step = SHOWCASE ? Math.min(delta, 1 / 30) : delta
      if (stage === "card") revealed.current = 0
      else if (SHOWCASE && reducedMotion()) revealed.current = 1
      else revealed.current = Math.min(1, revealed.current + step / REVEAL_S)
      const p = easeInOut(revealed.current)
      const dir = scratch.dir.copy(TOP_DIR).lerp(ISO_DIR, p).normalize()
      control.target.copy(HOME)
      if (isOrtho) {
        camera.position.copy(HOME).addScaledVector(dir, 220)
        ;(camera as Ortho).zoom = wide * (0.5 + 0.5 * p)
      } else {
        camera.position.copy(HOME).addScaledVector(dir, FAR * (2 - p))
      }
      camera.updateProjectionMatrix()
      control.update()
      if (SHOWCASE && revealed.current >= 1) opening.land()
      return
    }

    // 2. Your keys.
    const held = keys.current
    if (held.size > 0) {
      const offset = scratch.offset.copy(camera.position).sub(control.target)
      const azimuth = Math.atan2(offset.x, offset.z)
      const forward = scratch.forward.set(-Math.sin(azimuth), 0, -Math.cos(azimuth))
      const right = scratch.right.set(-forward.z, 0, forward.x)
      const scale = isOrtho ? 60 / (camera as Ortho).zoom : offset.length() * 0.9
      const move = scratch.move.set(0, 0, 0)
      if (held.has("w") || held.has("arrowup")) move.add(forward)
      if (held.has("s") || held.has("arrowdown")) move.sub(forward)
      if (held.has("d") || held.has("arrowright")) move.add(right)
      if (held.has("a") || held.has("arrowleft")) move.sub(right)
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(PAN_SPEED * scale * delta)
        control.target.add(move)
        camera.position.add(move)
      }
      if (held.has("q") || held.has("e")) {
        offset.applyAxisAngle(UP, (held.has("q") ? 1 : -1) * TURN_SPEED * delta)
        camera.position.copy(control.target).add(offset)
      }
      if (held.has("r") || held.has("f")) {
        const axis = scratch.axis.crossVectors(UP, offset).normalize()
        const tilted = scratch.tilted
          .copy(offset)
          .applyAxisAngle(axis, (held.has("r") ? -1 : 1) * TILT_SPEED * delta)
        const polar = tilted.angleTo(UP)
        if (polar > control.minPolarAngle && polar < control.maxPolarAngle)
          camera.position.copy(control.target).add(tilted)
      }
      const zoomIn = held.has("+") || held.has("=")
      if (zoomIn || held.has("-") || held.has("_")) {
        const factor = 1 + (zoomIn ? 1.6 : -1.6) * delta
        if (isOrtho) {
          const o = camera as Ortho
          o.zoom = Math.min(control.maxZoom, Math.max(control.minZoom, o.zoom * factor))
        } else {
          const next = offset.length() / factor
          if (next > control.minDistance && next < control.maxDistance)
            camera.position.copy(control.target).add(offset.setLength(next))
        }
      }
      camera.updateProjectionMatrix()
    }

    // 3. Following the selected adventurer: keep them centred, let the viewer turn and zoom.
    const selected = store.selected ? positions.get(store.selected) : undefined
    if (selected) {
      const goal = scratch.goal.set(selected.x, 1.2, selected.z)
      const fresh = following.current !== store.selected
      // A new pick: glide there quickly; then track tightly so walking never leaves the frame.
      const k = 1 - Math.exp(-delta * (fresh ? 8 : 6))
      const before = scratch.before.copy(control.target)
      control.target.lerp(goal, fresh ? 1 : k)
      camera.position.add(before.subVectors(control.target, before))
      if (fresh) {
        following.current = store.selected
        closeIn(camera, control, isOrtho ? fit * 2.2 : CLOSE)
      }
    } else {
      following.current = null
    }

    // 4. The Bard directs, when it's on and nobody is being followed.
    if (store.bard && !selected) {
      // A focus hint: a skeleton rising live gets a short glance (guild/undead.ts), then the
      // director goes back to whoever it was watching.
      const glance = store.undead.glancing()
      const focus = glance
        ? scratch.hint.set(glance.x, 1.2, glance.z)
        : store.focus
          ? positions.get(store.focus.id)
          : undefined
      const goal = focus ? scratch.goal.set(focus.x, 1.2, focus.z) : HOME
      const slow = 1 - Math.exp(-delta * (glance ? 3 : 1.1))
      const before = scratch.before.copy(control.target)
      control.target.lerp(goal, slow)
      camera.position.add(before.subVectors(control.target, before))
      const quiet = store.time - store.lastEventAt > 5000 || !focus
      if (quiet) {
        const offset = scratch.offset
          .copy(camera.position)
          .sub(control.target)
          .applyAxisAngle(UP, delta * 0.05)
        camera.position.copy(control.target).add(offset)
      }
      const score = glance ? 3 : (store.focus?.score ?? 0)
      if (isOrtho) {
        const o = camera as Ortho
        const zoomGoal = focus ? fit * (0.7 + score * 0.05) : wide
        o.zoom += (zoomGoal - o.zoom) * slow
      } else {
        const offset = scratch.offset.copy(camera.position).sub(control.target)
        const distance = offset.length()
        const goalDistance = focus ? NEAR - score * 2 : FAR
        camera.position
          .copy(control.target)
          .add(offset.setLength(distance + (goalDistance - distance) * slow))
      }
      camera.updateProjectionMatrix()
    }
    control.update()
    last.current.target.copy(control.target)
    last.current.position.copy(camera.position)
    last.current.zoom = isOrtho ? (camera as Ortho).zoom : 0
  })

  return (
    <>
      {SHOWCASE && <OpeningProgress />}
      <OrthographicCamera
        ref={ortho}
        makeDefault={view === "diorama"}
        position={[0.01, 240, 2]}
        zoom={wide * 0.5}
        near={0.1}
        far={900}
      />
      <PerspectiveCamera
        ref={persp}
        makeDefault={view === "explore"}
        fov={38}
        near={0.5}
        far={1200}
        position={[60, 60, 60]}
      />
      <MapControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        zoomToCursor
        screenSpacePanning={false}
        minPolarAngle={0.12}
        maxPolarAngle={view === "explore" ? 1.45 : 1.25}
        minZoom={widest}
        maxZoom={fit * 8}
        minDistance={4}
        maxDistance={300}
        mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
        touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }}
      />
    </>
  )
}

const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "q",
  "e",
  "r",
  "f",
  "+",
  "=",
  "-",
  "_",
])

/**
 * Close in on whoever was just picked (once, so the viewer can zoom back out). In Explore the
 * camera also drops to a three-quarter angle: low enough to see the character's animation, not
 * the top of their head.
 */
function closeIn(camera: Ortho | Persp, control: Controls, goal: number): void {
  if ((camera as Ortho).isOrthographicCamera) {
    const o = camera as Ortho
    o.zoom = Math.max(o.zoom, goal)
    o.updateProjectionMatrix()
    return
  }
  const offset = camera.position.clone().sub(control.target)
  const azimuth = Math.atan2(offset.x, offset.z)
  const elevation = FOLLOW_ELEVATION
  camera.position
    .copy(control.target)
    .add(
      new Vector3(
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.cos(azimuth) * Math.cos(elevation),
      ).multiplyScalar(goal),
    )
}

/** Following someone in Explore: ~30° above the ground. */
const FOLLOW_ELEVATION = 0.52

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}
