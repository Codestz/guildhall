import { useFrame } from "@react-three/fiber"
import { useMemo, useRef, useState } from "react"
import { Color, type PointLight, Vector3 } from "three"
import { useGuild } from "../../guild/useGuild.ts"
import { HEARTH } from "../../world/layout.ts"
import { GLOWS } from "../../world/lights.ts"
import { sky } from "../atmosphere/state.ts"
import { AFTER_POSE, carried, type Flame, isCarried, nearestFlames, nightGlow } from "./carried.ts"

/**
 * Real firelight where you are looking: a few point lights that hop to the flames nearest the
 * camera's target, so nearby walls, roofs and adventurers actually catch warm light at night.
 * Carried lanterns (scene/lights/carried.ts) are candidates too: walk one past the camera's target
 * and it lights the walls and faces beside it. The count is fixed (shaders compile once);
 * everything farther away keeps the cheap halo + pool.
 */
/** Two: each point light adds lighting cost to every lit pixel (measured ~1 ms per two at DPR 1.5). */
const COUNT = 2
const REPICK_S = 0.4

const FLAMES: readonly (readonly [number, number, number])[] = [
  [HEARTH[0], 1.6, HEARTH[1]],
  ...GLOWS.map((light) => light.flame),
]

/** A carried lantern's light: smaller than a street flame's, and it walks with them. */
const CARRIED_INTENSITY = 8
const CARRIED_DISTANCE = 9
const FIXED_DISTANCE = 14

export function NearLights() {
  const { mood } = useGuild()
  const lights = useRef<(PointLight | null)[]>([])
  const [pick] = useState(() => ({
    chosen: new Array<Flame | undefined>(COUNT),
    distances: new Array<number>(COUNT).fill(0),
  }))
  const since = useRef(REPICK_S)
  const fire = useMemo(() => new Color(), [])

  // After the carried lanterns have been tracked this frame (StreetLights' `Carried`, AFTER_POSE).
  useFrame((state, delta) => {
    since.current += delta
    const controls = state.controls as unknown as { target?: Vector3 } | null
    const target = controls?.target ?? ORIGIN
    if (since.current >= REPICK_S) {
      since.current = 0
      nearestFlames(target.x, target.z, FLAMES, carried, pick.chosen, pick.distances)
    }
    fire.set(mood.fire).lerp(EMBER, 0.6)
    const t = state.clock.elapsedTime
    for (let i = 0; i < COUNT; i++) {
      const light = lights.current[i]
      if (!light) continue
      const flame = pick.chosen[i]
      // A lantern put down (or out of sight) since the pick: dark until the next pick.
      if (!flame || (isCarried(flame) && (!flame.lit || !carried.includes(flame)))) {
        light.intensity = 0
        continue
      }
      const moving = isCarried(flame)
      if (moving) light.position.copy(flame.at)
      else light.position.set(flame[0], flame[1] + 0.3, flame[2])
      light.distance = moving ? CARRIED_DISTANCE : FIXED_DISTANCE
      light.color.copy(fire)
      const flicker = 0.9 + Math.sin(t * 8.3 + i * 2.1) * 0.06 + Math.sin(t * 13.7 + i) * 0.04
      const goal = moving ? nightGlow(sky.lamps) * CARRIED_INTENSITY * flicker : sky.lamps * 32 * flicker
      light.intensity += (goal - light.intensity) * Math.min(1, delta * 6)
    }
  }, AFTER_POSE + 0.1)

  return (
    <>
      {Array.from({ length: COUNT }, (_, i) => (
        <pointLight
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool of lights
          key={i}
          ref={(light) => {
            lights.current[i] = light
          }}
          intensity={0}
          distance={FIXED_DISTANCE}
          decay={1.8}
        />
      ))}
    </>
  )
}

const EMBER = new Color("#ff8a3d")
const ORIGIN = new Vector3()
