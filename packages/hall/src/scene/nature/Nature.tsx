import { useThree } from "@react-three/fiber"
import { useEffect } from "react"
import type { Vector3 } from "three"
import { frameStats } from "../../guild/stats.ts"
import { useTier } from "../Quality.tsx"
import { Grass } from "./Grass.tsx"
import { Water } from "./Water.tsx"

/** Nature: water and grass shaders on island().water / island().meadow. (ADR 0007). */
export function Nature() {
  const tier = useTier()
  return (
    <>
      <Water tier={tier} />
      <Grass tier={tier} />
      {import.meta.env.DEV && <DevLook />}
    </>
  )
}

/** Dev only: `natureLook(x, y, z, tx, ty, tz)` puts the explore camera somewhere, for probes. */
function DevLook() {
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as unknown as {
    target: Vector3
    update(): void
  } | null
  useEffect(() => {
    Object.assign(window, {
      natureLook(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
        camera.position.set(x, y, z)
        controls?.target.set(tx, ty, tz)
        controls?.update()
        return "ok"
      },
      /** This frame's totals (draw calls, triangles), as the Stats panel reads them. */
      natureStats: () => ({ calls: frameStats.calls, triangles: frameStats.triangles }),
      /** Shows or hides everything Nature draws: for before/after frame-rate comparisons. */
      natureShow(show: boolean) {
        scene.traverse((object) => {
          if (object.name.startsWith("nature-")) object.visible = show
        })
        return show
      },
    })
  }, [camera, controls, scene])
  return null
}
