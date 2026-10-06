import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import { Color, type PointLight, Vector3 } from "three"
import { useGuild } from "../../guild/useGuild.ts"
import { HEARTH } from "../../world/layout.ts"
import { LIGHTS } from "../../world/lights.ts"
import { sky } from "../atmosphere/state.ts"

/**
 * Real firelight where you are looking: a few point lights that hop to the flames nearest the
 * camera's target, so nearby walls, roofs and adventurers actually catch warm light at night.
 * The count is fixed (shaders compile once); everything farther away keeps the cheap halo + pool.
 */
/** Two: each point light adds lighting cost to every lit pixel (measured ~1 ms per two at DPR 1.5). */
const COUNT = 2
const REPICK_S = 0.4

const FLAMES: readonly (readonly [number, number, number])[] = [
  [HEARTH[0], 1.6, HEARTH[1]],
  ...LIGHTS.map((light) => light.flame),
]

export function NearLights() {
  const { mood } = useGuild()
  const lights = useRef<(PointLight | null)[]>([])
  const chosen = useRef<number[]>([])
  const since = useRef(REPICK_S)
  const fire = useMemo(() => new Color(), [])

  useFrame((state, delta) => {
    since.current += delta
    const controls = state.controls as unknown as { target?: Vector3 } | null
    const target = controls?.target ?? ORIGIN
    if (since.current >= REPICK_S) {
      since.current = 0
      chosen.current = nearest(target, COUNT)
    }
    fire.set(mood.fire).lerp(EMBER, 0.6)
    const t = state.clock.elapsedTime
    for (let i = 0; i < COUNT; i++) {
      const light = lights.current[i]
      const index = chosen.current[i]
      if (!light) continue
      const flame = index === undefined ? undefined : FLAMES[index]
      if (!flame) {
        light.intensity = 0
        continue
      }
      light.position.set(flame[0], flame[1] + 0.3, flame[2])
      light.color.copy(fire)
      const flicker = 0.9 + Math.sin(t * 8.3 + i * 2.1) * 0.06 + Math.sin(t * 13.7 + i) * 0.04
      const goal = sky.lamps * 32 * flicker
      light.intensity += (goal - light.intensity) * Math.min(1, delta * 6)
    }
  })

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
          distance={14}
          decay={1.8}
        />
      ))}
    </>
  )
}

/** Indices of the `count` flames nearest `target` (a tiny partial sort; ~45 flames). */
function nearest(target: Vector3, count: number): number[] {
  const best: { index: number; d: number }[] = []
  for (let i = 0; i < FLAMES.length; i++) {
    const flame = FLAMES[i]
    if (!flame) continue
    const d = (flame[0] - target.x) ** 2 + (flame[2] - target.z) ** 2
    if (best.length < count) best.push({ index: i, d })
    else {
      let worst = 0
      for (let k = 1; k < best.length; k++) if ((best[k]?.d ?? 0) > (best[worst]?.d ?? 0)) worst = k
      if (d < (best[worst]?.d ?? Number.POSITIVE_INFINITY)) best[worst] = { index: i, d }
    }
  }
  return best.map((b) => b.index)
}

const EMBER = new Color("#ff8a3d")
const ORIGIN = new Vector3()
