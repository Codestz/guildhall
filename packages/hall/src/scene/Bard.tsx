import { OrbitControls } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { type ComponentRef, useEffect, useRef } from "react"
import { type OrthographicCamera, Vector3 } from "three"
import { positions, useGuildStore } from "../guild/useGuild.ts"

/**
 * The Bard (ADR 0005): the hall films itself.
 *  1. Dollhouse reveal — starts above the roof, swings down into the isometric view.
 *  2. Director — eases toward the most interesting recent event, holding each shot (the store
 *     decides what is interesting and for how long; the Bard only frames it).
 *  3. Quiet guild → slow turntable drift.
 *  4. Any drag/scroll hands the camera to the viewer; the Bard comes back after 10 s.
 */

const REVEAL_S = 3.2
const HANDBACK_MS = 10_000
const ISO = new Vector3(120, 112, 120)
const TOP = new Vector3(0.01, 240, 2)
/** Overview centre: the keep, nudged south so the road and the southern sites are in frame. */
const HOME = new Vector3(0, 1, 10)

export function Bard() {
  const store = useGuildStore()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const revealed = useRef(0)
  const manualUntil = useRef(0)
  const size = useThree((state) => state.size)
  /** Zoom that fits the room at this viewport size. */
  const fit = Math.min(size.width / 44, size.height / 31)
  /** The overview: the keep and the nearest sites. */
  const wide = fit * 0.42

  useEffect(() => {
    const control = controls.current
    if (!control) return
    const takeOver = () => {
      if (revealed.current >= 1) manualUntil.current = performance.now() + HANDBACK_MS
    }
    control.addEventListener("start", takeOver)
    return () => control.removeEventListener("start", takeOver)
  }, [])

  useFrame((state, delta) => {
    const camera = state.camera as OrthographicCamera
    const control = controls.current
    if (!control) return

    if (revealed.current < 1) {
      revealed.current = Math.min(1, revealed.current + delta / REVEAL_S)
      const p = easeInOut(revealed.current)
      camera.position.lerpVectors(TOP, ISO, p)
      camera.zoom = wide * (0.5 + 0.5 * p)
      camera.updateProjectionMatrix()
      control.target.copy(HOME)
      control.update()
      return
    }
    if (!store.selected && (!store.bard || performance.now() < manualUntil.current)) return

    const picked = store.selected ? positions.get(store.selected) : undefined
    const focus = picked ?? (store.focus ? positions.get(store.focus.id) : undefined)
    const goal = focus ? new Vector3(focus.x, 1.2, focus.z) : HOME
    // Quiet: the overview. Something happening: close enough to read it. Picked: closer still.
    const zoomGoal = picked ? fit * 1.4 : focus && store.focus ? fit * (0.7 + store.focus.score * 0.05) : wide
    const k = 1 - Math.exp(-delta * 1.1)

    const before = control.target.clone()
    control.target.lerp(goal, k)
    camera.position.add(control.target.clone().sub(before))

    const quiet = store.time - store.lastEventAt > 5000 || !focus
    if (quiet) {
      const offset = camera.position.clone().sub(control.target)
      offset.applyAxisAngle(UP, delta * 0.05)
      camera.position.copy(control.target).add(offset)
    }

    camera.zoom += (zoomGoal - camera.zoom) * k
    camera.updateProjectionMatrix()
    control.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      minPolarAngle={0.35}
      maxPolarAngle={1.15}
      minZoom={wide * 0.6}
      maxZoom={fit * 3}
      enablePan
    />
  )
}

const UP = new Vector3(0, 1, 0)

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}
