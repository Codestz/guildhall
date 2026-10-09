import { MapControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { type ComponentRef, useEffect, useMemo, useRef } from "react"
import {
  MOUSE,
  type OrthographicCamera as Ortho,
  type PerspectiveCamera as Persp,
  TOUCH,
  Vector3,
} from "three"
import { clearFrame, hudInsets, type Point, type Shot, type ShotKind, type Stage } from "../guild/director.ts"
import { MODE } from "../guild/mode.ts"
import { opening, reducedMotion } from "../guild/opening.ts"
import { positions, useGuild, useGuildStore } from "../guild/useGuild.ts"
import { useArchipelago } from "../world/archipelagoSource.ts"
import { useWorld } from "../world/source.ts"
import {
  depthsOf,
  flightSeconds,
  flightSize,
  frameOf,
  HOME as HOME_ISLAND,
  islandView,
  mapFrame,
} from "./archipelago/view.ts"
import { bezier, closeIn, easeInOut } from "./cameraMath.ts"
import { FRAME } from "./frame.ts"
import { baseZoomOf, landOf, ORTHO_BACK, orthoBackOf, orthoMaxOf, uprightOf, widestOf } from "./frameReach.ts"
import { OpeningProgress } from "./OpeningCue.tsx"
import { ClearAngle } from "./terrain/clearAngle.ts"
import { aboveGround } from "./terrain/framing.ts"
import { useCutaway } from "./terrain/useCutaway.ts"

/**
 * The camera: yours first, the Bard's when you hand it over (ADR 0005, season 2).
 *
 *   Views     Diorama (orthographic, the tabletop look) · Explore (perspective, low and close)
 *   Mouse     left-drag pans the ground · right-drag turns and tilts · wheel zooms to the cursor
 *   Keys      WASD / arrows pan · Q/E turn · R/F tilt · +/- zoom · B Bard on/off · V view
 *   Follow    clicking an adventurer keeps them centred while you still turn and zoom; Esc lets go
 *   Bard      the director. Any input of yours switches it off until you switch it back on (B, or
 *             Esc) — it never takes the camera back. Two styles (Settings → Director):
 *               Calm       eases toward the most interesting event, drifts when quiet (season 2)
 *               Cinematic  Director v2 (guild/director.ts): scored subjects, shot language, spline
 *                          flights between distant subjects, framed in the HUD's clear area
 */

type Controls = ComponentRef<typeof MapControls>

const REVEAL_S = 3.2
/** The showcase's directed opening (guild/opening.ts): hold, then reveal, then land. */
const SHOWCASE = MODE === "showcase"
/** Portrait screens close in on the keep by up to this much (a 390×844 phone gets all of it). */
const PORTRAIT_BOOST = 0.7
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
  partner: new Vector3(),
  ground: new Vector3(),
  probe: new Vector3(),
  control1: new Vector3(),
  control2: new Vector3(),
}
const frameOut = { x: 0, y: 0, w: 1, h: 1 }

/** Shot sizes: orthographic zoom as a multiple of `fit`, perspective distance. */
const SHOT_ZOOM: Record<ShotKind, number> = {
  establishing: 0,
  medium: 1.1,
  follow: 1.45,
  "two-shot": 1.2,
  reaction: 2,
  close: 2.2,
}
const SHOT_DISTANCE: Record<ShotKind, number> = {
  establishing: FAR,
  medium: 34,
  follow: 26,
  "two-shot": 30,
  reaction: 17,
  close: 15,
}
/** Subjects further apart than this (world units) get a flight, not an ease. */
const FLIGHT_MIN = 14
/** How far a flight bows sideways, as a share of its length; how much it pulls out halfway. */
const FLIGHT_BOW = 0.22
const FLIGHT_DIP = 0.35
/** Turntable speeds, rad/s: the establishing wide, and the slow drift of a held shot. */
const TURN_WIDE = 0.045
const TURN_HELD = 0.012
/** Decisions per second: the director scores a few times a second, the camera moves every frame. */
const DECIDE_S = 0.125
/** A long flight between islands pulls out this much halfway (a short one less). */
const ISLAND_PULL = 0.45

export function CameraRig() {
  const store = useGuildStore()
  const { view } = useGuild()
  const controls = useRef<Controls>(null)
  const ortho = useRef<Ortho>(null)
  const persp = useRef<Persp>(null)
  const revealed = useRef(0)
  const keys = useRef(new Set<string>())
  const following = useRef<string | null>(null)
  /** The last framing put on screen (store.framing `n`). */
  const framed = useRef(0)
  /** prefers-reduced-motion, kept current without asking every frame. */
  const still = useRef(reducedMotion())
  useEffect(() => {
    const list = window.matchMedia("(prefers-reduced-motion: reduce)")
    const change = () => {
      still.current = list.matches
    }
    list.addEventListener("change", change)
    return () => list.removeEventListener("change", change)
  }, [])
  const archipelago = useArchipelago()
  const world = useWorld()
  const land = useMemo(() => landOf(world), [world])
  const { outreach, peak, reach } = land
  const size = useThree((state) => state.size)
  // The orthographic camera stands far enough back that the ground nearest it, at the widest zoom-out
  // or the growth film's pull-back on this screen, is not clipped (frameReach.ts); the far plane keeps its room beyond.
  // An archipelago's camera stands further back and sees further (view.ts `depthsOf`): no far island is behind it.
  const depths = archipelago && depthsOf(archipelago)
  const back = depths ? depths.back : orthoBackOf(size, land)
  const orthoFar = depths ? depths.orthoFar : back + Math.max((900 - ORTHO_BACK) * outreach, back)
  /** A flight between islands (scene/archipelago/view.ts): the request flown, and where it is. */
  const trip = useRef({
    // From 0, not the current count: a link's `island=` may be asked before the rig mounts.
    n: 0,
    flying: false,
    t: 0,
    duration: 1,
    from: new Vector3(),
    to: new Vector3(),
    sizeFrom: 1,
    sizeTo: 1,
    pull: 0,
    home: false,
  })
  /** The Cinematic director's transition state (one object, mutated). */
  const film = useRef({
    active: false,
    cut: -1,
    decideIn: 0,
    flying: false,
    t: 0,
    duration: 1,
    from: new Vector3(),
    /** Flight start: orthographic zoom or perspective distance. */
    sizeFrom: 0,
    bow: 0,
    turn: 0,
    last: 0,
  })
  /** The cinematic camera's swing round a mountain that hides its subject (scene/terrain/clearAngle.ts). */
  const clear = useRef(new ClearAngle())
  /** The default camera: switching views makes the other one default, and drei rebuilds the controls. */
  const defaultCamera = useThree((state) => state.camera)
  /**
   * Orthographic zoom that fits the keep; the island overview is a fraction of it. A portrait
   * screen fits by width, which leaves the island a band between two seas with 6px characters,
   * so it closes in (×1.7 on a phone held upright). Zooming out still reaches the whole island.
   */
  const base = baseZoomOf(size.width, size.height)
  const fit = base * (1 + PORTRAIT_BOOST * uprightOf(size))
  const wide = fit * 0.42
  const widest = widestOf(size, land)
  /** The archipelago's map: the zoom (orthographic) and distance (perspective) that hold it all. */
  const mapRadius = archipelago ? mapFrame(archipelago).radius : 0
  const mapZoom = archipelago ? Math.min(size.width, size.height * 1.4) / (mapRadius * 2) : widest
  const mapDistance = mapRadius * 2.6

  // Your input turns the Bard off — and keeps it off. Listened to on the canvas itself: drei
  // recreates the controls whenever the default camera changes, so a listener on them gets lost.
  const dom = useThree((state) => state.gl.domElement)
  /** What the director may ask about the stage (allocated once; reads live state). */
  const stage = useMemo<Stage & { camera: Ortho | Persp | null }>(
    () => ({
      camera: null,
      get views() {
        return store.views
      },
      locate(id: string, out: Point): boolean {
        const at = positions.get(id)
        if (!at) return false
        out.x = at.x
        out.z = at.z
        return true
      },
      walking(id: string): boolean {
        const at = positions.get(id)
        if (!at) return false
        for (let i = 0; i < store.views.length; i++) {
          const view = store.views[i]
          if (view?.id === id) return Math.hypot(view.target[0] - at.x, view.target[1] - at.z) > 1.5
        }
        return false
      },
      onScreen(x: number, z: number): boolean {
        if (!this.camera) return true
        const p = scratch.probe.set(x, 1, z).project(this.camera)
        return Math.abs(p.x) < 0.85 && Math.abs(p.y) < 0.85 && p.z < 1
      },
    }),
    [store],
  )
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
      o.position.copy(target).addScaledVector(dir, back)
      o.updateProjectionMatrix()
    } else {
      const distance =
        zoom > 0 ? Math.min(260, Math.max(CLOSE, FAR * (wide / zoom))) : position.distanceTo(target)
      camera.position.copy(target).addScaledVector(dir, distance)
    }
    control.update()
  }, [defaultCamera, fit, wide, back])

  useFrame((_, delta) => {
    const control = controls.current
    if (!control) return
    const camera = control.object as Ortho | Persp
    const isOrtho = (camera as Ortho).isOrthographicCamera === true

    // A deep link's `look` skips the sweep below (once the showcase's title card is down): it cuts
    // straight to its framing (1b).
    if (revealed.current < 1 && store.framing && (!SHOWCASE || opening.get().stage !== "card")) {
      revealed.current = 1
      if (SHOWCASE) opening.land()
    }
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
        camera.position.copy(HOME).addScaledVector(dir, back)
        ;(camera as Ortho).zoom = wide * (0.5 + 0.5 * p)
      } else {
        camera.position.copy(HOME).addScaledVector(dir, FAR * (2 - p))
      }
      camera.updateProjectionMatrix()
      control.update()
      if (SHOWCASE && revealed.current >= 1) opening.land()
      return
    }

    // 1b. A framing asked for (a deep link's `look`): put the camera on it at once, from the
    //     isometric side (Explore: a three-quarter angle), sized to hold its radius. Once, on the
    //     camera of the view asked for (a link may switch views in the same breath).
    const framing = store.framing
    if (framing && framing.n !== framed.current && isOrtho === (store.view === "diorama")) {
      framed.current = framing.n
      const radius = framing.radius ?? 4
      control.target.set(framing.x, 1 + (framing.y ?? 0), framing.z)
      if (isOrtho) {
        camera.position.copy(control.target).addScaledVector(ISO_DIR, back)
        ;(camera as Ortho).zoom = Math.min(fit * 8, Math.max(widest, (size.width * 0.6) / (radius * 2.4)))
      } else {
        const d = Math.max(CLOSE, radius * 2.6 + (framing.y ?? 0) * 2.4)
        camera.position.copy(control.target).addScaledVector(scratch.dir.set(1, 0.62, 1).normalize(), d)
      }
      camera.updateProjectionMatrix()
    }

    // 1c. The archipelago: a flight to an island or the map, asked for by the switcher or a label.
    //     While it flies nothing else moves the camera; away from home the Bard is off.
    if (archipelago && fly(delta, camera, control, isOrtho)) {
      control.update()
      last.current.target.copy(control.target)
      last.current.position.copy(camera.position)
      last.current.zoom = isOrtho ? (camera as Ortho).zoom : 0
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
      const goal = scratch.goal.set(selected.x, 1.2 + rise(selected.x, selected.z), selected.z)
      clearShift(camera, control, isOrtho, goal)
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
    const directing = store.bard && !selected
    if (directing && store.directorStyle === "cinematic") {
      direct(delta, camera, control, isOrtho)
    } else if (directing) {
      calm(delta, camera, control, isOrtho)
    }
    film.current.active = directing && store.directorStyle === "cinematic"
    if (!isOrtho && world.relief) aboveGround(camera, world.ground.heightAt)
    control.update()
    last.current.target.copy(control.target)
    last.current.position.copy(camera.position)
    last.current.zoom = isOrtho ? (camera as Ortho).zoom : 0
  }, FRAME.WORLD)
  // After the camera has moved: the relief's see-through cut follows the figures it hides.
  useCutaway(world)

  /**
   * The archipelago's flights (scene/archipelago/view.ts): a new request starts one — a straight
   * glide over the sea that pulls out halfway, keeping the angle you look from — or, with reduced
   * motion or a deep link, a cut. Leaving the home island hands the camera to you (the Bard off);
   * arriving home hands it back. The Bard switched back on away from home flies there itself (its
   * own flight), so the request just notes that. True while a flight is moving the camera.
   */
  function fly(delta: number, camera: Ortho | Persp, control: Controls, isOrtho: boolean): boolean {
    if (!archipelago) return false
    const f = trip.current
    // Away from home with the Bard switched back on (B, Esc): it is taking the camera home.
    const asked = islandView.get()
    if (asked.n === f.n && asked.stop !== HOME_ISLAND && store.bard && !f.flying)
      islandView.go(HOME_ISLAND, { quiet: true })
    const request = islandView.get()
    if (request.n !== f.n) {
      f.n = request.n
      if (request.quiet) return false
      const frame = frameOf(request.stop, archipelago)
      const map = request.stop === "map"
      f.home = request.stop === HOME_ISLAND
      if (!f.home && store.bard) store.setBard(false)
      if (store.selected) store.select(null)
      f.from.copy(control.target)
      f.to.set(frame.x, 1, frame.z)
      const o = camera as Ortho
      const distance = camera.position.distanceTo(control.target)
      f.sizeFrom = isOrtho ? o.zoom : distance
      f.sizeTo = isOrtho ? (map ? mapZoom : wide) : map ? mapDistance : Math.max(FAR, frame.radius * 1.3)
      const length = f.from.distanceTo(f.to)
      f.pull = map ? 0 : Math.min(ISLAND_PULL, length / 600)
      f.duration = flightSeconds(length + (map ? 200 : 0))
      f.t = request.cut || still.current ? 1 : 0
      f.flying = true
    }
    if (!f.flying) return false
    f.t = Math.min(1, f.t + delta / f.duration)
    const p = easeInOut(f.t)
    control.target.lerpVectors(f.from, f.to, p)
    const dir = scratch.dir.copy(camera.position).sub(control.target)
    if (dir.lengthSq() < 1e-6) dir.copy(ISO_DIR)
    dir.normalize()
    const size = flightSize(f.sizeFrom, f.sizeTo, p, f.pull, isOrtho)
    if (isOrtho) {
      ;(camera as Ortho).zoom = size
      camera.position.copy(control.target).addScaledVector(dir, back)
    } else {
      camera.position.copy(control.target).addScaledVector(dir, size)
    }
    camera.updateProjectionMatrix()
    if (f.t >= 1) {
      f.flying = false
      // Home again: the Bard has the camera back.
      if (f.home && !store.bard) store.setBard(true)
    }
    return true
  }

  /** Calm: the season-2 Bard. Eases toward store.focus (or a rise in the graveyard), turntables when quiet. */
  function calm(delta: number, camera: Ortho | Persp, control: Controls, isOrtho: boolean): void {
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
      camera.position.copy(control.target).add(offset.setLength(distance + (goalDistance - distance) * slow))
    }
    camera.updateProjectionMatrix()
  }

  /**
   * Cinematic: run the director's shot (guild/director.ts). A new shot on a distant subject is a
   * flight along a curved path that pulls out halfway (none with reduced motion: a straight cut);
   * a near one eases. The subject lands in the middle of what the HUD leaves clear.
   */
  function direct(delta: number, camera: Ortho | Persp, control: Controls, isOrtho: boolean): void {
    const f = film.current
    const reduced = still.current
    store.director.calm = reduced
    f.decideIn -= delta
    if (f.decideIn <= 0 || !f.active) {
      f.decideIn = DECIDE_S
      stage.camera = camera
      store.director.update(stage)
    }
    const shot = store.director.shot
    const goal = subjectOf(shot, scratch.goal)
    const o = camera as Ortho
    const offset = scratch.offset.copy(camera.position).sub(control.target)
    const distance = offset.length()
    const framing = shotSize(shot, isOrtho, goal)
    // A mountain between camera and subject: swing round it (the see-through cut covers the rest).
    if (world.relief) clear.current.update(delta, camera, control.target, goal, world.relief.heightAt, peak)
    // Land the subject in the HUD's clear area.
    clearShift(camera, control, isOrtho, goal)

    // A new shot: fly, cut or ease.
    if (shot.cut !== f.cut || !f.active) {
      f.cut = shot.cut
      clear.current.reset()
      const far = control.target.distanceTo(goal) > FLIGHT_MIN
      f.flying = false
      if (far && reduced) {
        // Reduced motion: no travel at all; the next frame simply shows the new subject.
        const before = scratch.before.copy(control.target)
        control.target.copy(goal)
        camera.position.add(before.subVectors(control.target, before))
        if (isOrtho) o.zoom = framing
        else camera.position.copy(control.target).add(offset.setLength(framing))
      } else if (far) {
        f.flying = true
        f.t = 0
        f.last = 0
        f.duration = Math.min(2.4, Math.max(1.1, 0.9 + control.target.distanceTo(goal) / 40))
        f.from.copy(control.target)
        f.sizeFrom = isOrtho ? o.zoom : distance
        f.bow = control.target.distanceTo(goal) * FLIGHT_BOW * (shot.cut % 2 === 0 ? 1 : -1)
        f.turn = 0.22 * (shot.cut % 2 === 0 ? 1 : -1)
      }
    }

    const before = scratch.before.copy(control.target)
    if (f.flying) {
      f.t = Math.min(1, f.t + delta / f.duration)
      const p = easeInOut(f.t)
      // A cubic Bézier from where we were to where the subject is now, bowed sideways.
      const side = scratch.ground.set(-(goal.z - f.from.z), 0, goal.x - f.from.x)
      side.normalize().multiplyScalar(f.bow)
      const c1 = scratch.control1.copy(f.from).lerp(goal, 0.25).add(side)
      const c2 = scratch.control2.copy(f.from).lerp(goal, 0.75).add(side)
      bezier(f.from, c1, c2, goal, p, control.target)
      camera.position.add(before.subVectors(control.target, before))
      // A little swing round as it goes (parallax), and a pull-out halfway: a crane, not a dolly.
      const swing = scratch.offset
        .copy(camera.position)
        .sub(control.target)
        .applyAxisAngle(UP, f.turn * (p - f.last))
      camera.position.copy(control.target).add(swing)
      f.last = p
      const dip = 1 - FLIGHT_DIP * Math.sin(Math.PI * p)
      if (isOrtho)
        o.zoom = Math.exp(Math.log(f.sizeFrom) + (Math.log(framing) - Math.log(f.sizeFrom)) * p) * dip
      else {
        const d = (f.sizeFrom + (framing - f.sizeFrom) * p) / dip
        camera.position.copy(control.target).add(swing.setLength(d))
      }
      if (f.t >= 1) f.flying = false
    } else {
      // Track: tight on a walker so they never leave the frame, softer otherwise.
      const tight =
        shot.kind === "follow" ||
        shot.kind === "two-shot" ||
        (shot.id !== undefined && stage.walking(shot.id))
      const k = 1 - Math.exp(-delta * (tight ? 3.5 : 1.8))
      control.target.lerp(goal, k)
      camera.position.add(before.subVectors(control.target, before))
      const z = 1 - Math.exp(-delta * (reduced ? 0.8 : 1.4))
      if (isOrtho) o.zoom += (framing - o.zoom) * z
      else {
        const current = scratch.offset.copy(camera.position).sub(control.target)
        const d = current.length()
        camera.position.copy(control.target).add(current.setLength(d + (framing - d) * z))
      }
      // Turntable: the wide drifts round; a held shot barely breathes. Never with reduced motion.
      const turn = reduced ? 0 : shot.kind === "establishing" ? TURN_WIDE : TURN_HELD
      if (turn > 0) {
        const around = scratch.offset
          .copy(camera.position)
          .sub(control.target)
          .applyAxisAngle(UP, delta * turn)
        camera.position.copy(control.target).add(around)
      }
    }
    camera.updateProjectionMatrix()
  }

  /**
   * Shift a goal so its subject lands in the middle of what the HUD leaves clear (not under the
   * dossier, the roster, the captions or a plea banner): the target moves the other way, on the
   * ground. Reads hudInsets (written by hud/Hud.tsx).
   */
  function clearShift(camera: Ortho | Persp, control: Controls, isOrtho: boolean, goal: Vector3): void {
    clearFrame(size.width, size.height, hudInsets, frameOut)
    if (frameOut.x === 0 && frameOut.y === 0) return
    const offset = scratch.offset.copy(camera.position).sub(control.target)
    const distance = offset.length()
    const halfH = isOrtho
      ? size.height / 2 / (camera as Ortho).zoom
      : distance * Math.tan(((camera as Persp).fov * Math.PI) / 360)
    const halfW = isOrtho ? size.width / 2 / (camera as Ortho).zoom : halfH * (camera as Persp).aspect
    const azimuth = Math.atan2(offset.x, offset.z)
    const forward = scratch.forward.set(-Math.sin(azimuth), 0, -Math.cos(azimuth))
    const right = scratch.right.set(-forward.z, 0, forward.x)
    const lift = Math.max(0.3, offset.y / Math.max(distance, 1e-3))
    goal.addScaledVector(right, -frameOut.x * halfW).addScaledVector(forward, (-frameOut.y * halfH) / lift)
  }

  /**
   * Where the shot's subject is now (a two-shot: between its two). A sky event's shot aims `y` above
   * the ground: the target rises to it (a flight there and back, like any distant subject).
   */
  function subjectOf(shot: Shot, out: Vector3): Vector3 {
    const at = shot.id ? positions.get(shot.id) : undefined
    if (at) out.set(at.x, 1.2 + rise(at.x, at.z), at.z)
    else out.set(shot.x, 1.2 + shot.y + rise(shot.x, shot.z), shot.z)
    if (shot.kind === "establishing") out.set(shot.x, 1 + shot.y, shot.z)
    const partner = shot.partner ? positions.get(shot.partner) : undefined
    if (shot.kind === "two-shot" && partner)
      out.lerp(scratch.partner.set(partner.x, 1.2 + rise(partner.x, partner.z), partner.z), 0.5)
    return out
  }

  /** How high the ground stands at a point, for the camera to follow a figure up a mountain (0 on a flat world). */
  function rise(x: number, z: number): number {
    return world.relief ? world.ground.heightAt(x, z) : 0
  }

  /** The shot's size: orthographic zoom, or perspective distance. */
  function shotSize(shot: Shot, isOrtho: boolean, centre: Vector3): number {
    const partner = shot.partner ? positions.get(shot.partner) : undefined
    // A two-shot holds both: their separation (plus a margin) across 60% of the clear width.
    const apart =
      shot.kind === "two-shot" && partner
        ? 2 * Math.hypot(partner.x - centre.x, partner.z - centre.z) + 6
        : shot.id === undefined && shot.kind !== "establishing"
          ? shot.radius * 2.4
          : 0
    const clear = Math.max(0.3, frameOut.w) * size.width * 0.6
    if (isOrtho) {
      // A sky event's wide holds its radius (the rainbow's arc and the island under it), never
      // closer than the usual wide nor past the furthest zoom-out.
      if (shot.kind === "establishing" && shot.y > 0 && shot.radius > 0)
        return Math.min(wide, Math.max(widest, clear / (shot.radius * 2.4)))
      if (shot.kind === "establishing") return wide
      const sized = fit * SHOT_ZOOM[shot.kind]
      // Never wider than a third of the way to the island overview: past that it's no two-shot.
      return apart > 0 ? Math.min(sized, Math.max(wide + (fit - wide) * 0.35, clear / apart)) : sized
    }
    if (shot.kind === "establishing") return FAR
    const sized = SHOT_DISTANCE[shot.kind]
    return apart > 0 ? Math.max(sized, Math.min(FAR, apart * 1.6)) : sized
  }

  return (
    <>
      {SHOWCASE && <OpeningProgress />}
      <OrthographicCamera
        ref={ortho}
        makeDefault={view === "diorama"}
        position={[0.01, 240, 2]}
        zoom={wide * 0.5}
        near={0.1}
        far={orthoFar}
      />
      <PerspectiveCamera
        ref={persp}
        makeDefault={view === "explore"}
        fov={38}
        near={0.5}
        far={depths ? depths.far : 1200 * outreach + 2 * peak}
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
        minZoom={archipelago ? Math.min(widest, mapZoom * 0.8) : widest}
        maxZoom={fit * 8}
        minDistance={4}
        maxDistance={
          depths ? depths.back * 1.5 : view === "explore" ? 300 * outreach : orthoMaxOf(outreach, back)
        }
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
