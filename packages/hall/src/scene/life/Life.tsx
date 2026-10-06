import { useFrame, useThree } from "@react-three/fiber"
import { useEffect } from "react"
import { quality } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { useTier } from "../Quality.tsx"
import { Birds } from "./Birds.tsx"
import { Machines } from "./Machines.tsx"
import { TracePiles } from "./Piles.tsx"
import { Ravens } from "./Ravens.tsx"
import { Smoke } from "./Smoke.tsx"
import { Sparks } from "./Sparks.tsx"
import { life, readGuild } from "./state.ts"
import { Villagers } from "./Villagers.tsx"
import { Windows } from "./Windows.tsx"

/**
 * Life (ADR 0007): the island lives and keeps a record of the work done on it.
 *   traces     logs, stones, fish, books, arrows pile up at each site as its deeds complete
 *   machines   windmill sails (wind), water wheel (river), lumber-mill saw (explorers chopping)
 *   smoke      chimneys (temperature, wind, rain), the smithy (implementers at work)
 *   sparks     the smithy's anvil (implementers at work)
 *   birds      a quiet flock over the forest by day, in fair weather
 *   windows    the village's windows glow from dusk, going dark through the night
 *   villagers  a farmer and two townsfolk on their rounds by day, indoors by night
 *   ravens     carry quests out, news of loot home, and circle over a plea (Ravens.tsx)
 * Draw calls (High): machines 1, traces 1, smoke 1, sparks 1, birds 1, windows 2, villagers 3, ravens 2 = 12.
 * Medium: 2 villagers = 11. Low: none = 9. Nothing here casts into the (static) sun shadow map;
 * villagers get a blob shadow (scene/Blobs.tsx).
 */
export function Life() {
  const store = useGuildStore()
  const tier = useTier()
  // Before every Life piece reads it this frame.
  useFrame(() => readGuild(store), -1)

  return (
    <group name="life">
      <Machines />
      <TracePiles />
      <Smoke tier={tier} />
      <Sparks />
      <Birds tier={tier} />
      <Ravens />
      <Windows />
      <Villagers tier={tier} />
      {import.meta.env.DEV && <LookBridge />}
    </group>
  )
}

/** Dev only: `lifeLook([x, y, z], [tx, ty, tz])` puts the camera there, for close-up probes. */
function LookBridge() {
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as unknown as {
    target: { set(x: number, y: number, z: number): void }
    update(): void
  } | null
  useEffect(() => {
    Object.assign(window, {
      life,
      lifeScene: scene,
      lifeQuality: quality,
      lifeLook(from: [number, number, number], to: [number, number, number]) {
        camera.position.set(...from)
        controls?.target.set(...to)
        camera.lookAt(...to)
        controls?.update()
      },
    })
  }, [camera, controls, scene])
  return null
}
