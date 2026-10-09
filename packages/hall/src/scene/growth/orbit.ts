import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import type { OrthographicCamera, PerspectiveCamera, Vector3 } from "three"
import { EPILOGUE_S } from "../../world/chronicle/growth.ts"
import type { GrowthFrame } from "../../world/chronicle/growthFrame.ts"
import { useWorld } from "../../world/source.ts"
import { filmZoom, landOf, orthoBackOf } from "../frameReach.ts"

/**
 * The timelapse's establishing shot (ADR 0021): a slow orbit round the land that is up, widening
 * as the island grows, at the hall's isometric elevation. In the epilogue it turns back to the
 * hall's own angle, so the hand-back to the Bard is seamless. Any pointer, wheel or movement key of
 * yours ends it for this film: the camera is then yours (CameraRig), the film keeps playing.
 *
 * It runs after CameraRig (priority 0.5, before the composer at 1) and overwrites what it set.
 */

/** The hall's default view direction (CameraRig ISO_DIR: (1, 0.93, 1)): azimuth and elevation. */
const HOME_AZIMUTH = Math.PI / 4
const ELEVATION = Math.atan2(0.93, Math.SQRT2)
/** One turn in this many film seconds. */
const TURN_S = 110
const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "r",
  "f",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
])

/** The orbit's azimuth at film time `t`: turning, then easing home over the epilogue. Pure. */
export function azimuthAt(t: number, duration: number): number {
  const turn = (2 * Math.PI) / TURN_S
  const end = duration - EPILOGUE_S
  const turning = HOME_AZIMUTH + turn * Math.min(t, end)
  if (t <= end) return turning
  const home = HOME_AZIMUTH + 2 * Math.PI * Math.round((turning - HOME_AZIMUTH) / (2 * Math.PI))
  const p = Math.min(1, (t - end) / EPILOGUE_S)
  return turning + (home - turning) * p * p * (3 - 2 * p)
}

type Controls = { target: Vector3; object: OrthographicCamera | PerspectiveCamera; update(): void }

/** Drives the camera from `frame` while `on()`; returns whether the viewer has taken it over. */
export function useOrbit(frame: () => GrowthFrame | undefined, duration: number, on: () => boolean) {
  const controls = useThree((state) => state.controls) as unknown as Controls | null
  const size = useThree((state) => state.size)
  const world = useWorld()
  const land = useMemo(() => landOf(world), [world])
  const dom = useThree((state) => state.gl.domElement)
  const taken = useRef(false)
  const eased = useRef({ x: 0, z: 0, radius: 0, ready: false })

  useEffect(() => {
    const take = () => {
      taken.current = true
    }
    const key = (event: KeyboardEvent) => {
      if (MOVE_KEYS.has(event.key.toLowerCase()) && !(event.target instanceof HTMLInputElement)) take()
    }
    dom.addEventListener("pointerdown", take)
    dom.addEventListener("wheel", take, { passive: true })
    window.addEventListener("keydown", key)
    return () => {
      dom.removeEventListener("pointerdown", take)
      dom.removeEventListener("wheel", take)
      window.removeEventListener("keydown", key)
    }
  }, [dom])

  useFrame((_, delta) => {
    const f = frame()
    if (!controls || !f || taken.current || !on()) return
    const e = eased.current
    const k = e.ready ? 1 - Math.exp(-Math.min(delta, 0.1) * 3) : 1
    e.x += (f.center[0] - e.x) * k
    e.z += (f.center[1] - e.z) * k
    e.radius += (Math.max(24, f.radius) - e.radius) * k
    e.ready = true
    const azimuth = azimuthAt(f.t, duration)
    const dx = Math.sin(azimuth) * Math.cos(ELEVATION)
    const dy = Math.sin(ELEVATION)
    const dz = Math.cos(azimuth) * Math.cos(ELEVATION)
    const camera = controls.object
    controls.target.set(e.x, 1, e.z)
    if ((camera as OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as OrthographicCamera
      // As far back as CameraRig stands it: a pull-back over the whole land must not run it into the near plane.
      const back = orthoBackOf(size, land)
      ortho.position.set(e.x + dx * back, 1 + dy * back, e.z + dz * back)
      // The land's foreshortened height is ~0.6 of its width at this elevation; a portrait phone
      // fits it by width, a little tighter (the reach is a corner-to-corner radius).
      ortho.zoom = filmZoom(size, e.radius)
    } else {
      const distance = e.radius * 2.7
      camera.position.set(e.x + dx * distance, 1 + dy * distance, e.z + dz * distance)
    }
    camera.lookAt(controls.target)
    camera.updateProjectionMatrix()
  }, 0.5)

  return taken
}
