import { useThree } from "@react-three/fiber"
import { useEffect } from "react"
import type { Vector3 } from "three"
import { frameStats } from "../../guild/stats.ts"
import { useWorld } from "../../world/source.ts"
import { useTier } from "../Quality.tsx"
import { Fields } from "./Fields.tsx"
import { Grass } from "./Grass.tsx"
import { Rivers } from "./Rivers.tsx"
import { Water } from "./Water.tsx"
import { Wilds } from "./Wilds.tsx"

/**
 * Nature: water and grass shaders on island().water / island().meadow, and the character-scale
 * wilds along roads, sites, village and shore (world/wilds.ts), and the farms' crops
 * (world/fields.ts). (ADR 0007).
 */
export function Nature() {
  const tier = useTier()
  const waters = useWorld().water
  return (
    <>
      <Water tier={tier} />
      {waters && <Rivers waters={waters} tier={tier} />}
      <Grass tier={tier} />
      <Wilds tier={tier} />
      <Fields />
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
