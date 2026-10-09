import { useFrame, useThree } from "@react-three/fiber"
import { useEffect } from "react"
import { quality } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { useWorld } from "../../world/source.ts"
import { FRAME } from "../frame.ts"
import { useTier } from "../Quality.tsx"
import { Birds } from "./Birds.tsx"
import { Machines } from "./Machines.tsx"
import { TracePiles } from "./Piles.tsx"
import { Ravens } from "./Ravens.tsx"
import { Smoke } from "./Smoke.tsx"
import { Sparks } from "./Sparks.tsx"
import { life, readGuild } from "./state.ts"
import { Venues } from "./Venues.tsx"
import { Villagers } from "./Villagers.tsx"
import { Windows } from "./Windows.tsx"
import { WorkFx } from "./WorkFx.tsx"

/**
 * Life (ADR 0007): the island lives and keeps a record of the work done on it.
 *   traces     logs, stones, fish, books, arrows pile up at each site as its deeds complete
 *   machines   windmill sails (wind), water wheel (river), lumber-mill saw (explorers chopping)
 *   smoke      chimneys (temperature, wind, rain), the smithy (implementers at work)
 *   sparks     the smithy's anvil (implementers at work)
 *   birds      a quiet flock over the forest by day, in fair weather
 *   windows    the village's windows glow from dusk, going dark through the night
 *   townsfolk  farmers, a fisher, merchants, gate guards, children, a graveyard keeper and villagers
 *              about their day (rounds.ts, Villagers.tsx): home at dusk and in the rain, guards and a
 *              night watchman out after dark with lanterns, on the square at a festival
 *   venues     a gen 2 island's occupied venues light their windows and smoke their chimneys (Venues.tsx)
 *   ravens     carry quests out, news of loot home, and circle over a plea (Ravens.tsx)
 *   work       what working looks like between results: chips, sparks, steam, splashes, arrows in
 *              flight, the forest's shaking work trees, the forge's quench buckets (WorkFx.tsx)
 * Draw calls (High): machines 1, traces 1, smoke 1, sparks 1, birds 1, windows 2, venues 2, ravens 2, work 5,
 * plus one per townsperson out (14 at High, 8 Medium, 4 Low) and one per held thing or lantern
 * showing. Nothing here casts into the (static) sun shadow map; townsfolk get a blob shadow
 * (scene/Blobs.tsx).
 *
 * A repo's island (world/world.ts) has its machines, birds, ravens and the guild's work: traces and
 * work trees by the districts its sites took (world/siteMap.ts). The village's smoke, sparks,
 * windows and townsfolk are the hand map's, placed for its houses and rounds.
 */
export function Life() {
  const store = useGuildStore()
  const tier = useTier()
  const world = useWorld()
  const hand = world.kind === "hand"
  // After the guild's clock, before every Life piece reads it this frame.
  useFrame(() => readGuild(store), FRAME.SKY)

  return (
    <group name="life">
      <Machines />
      <TracePiles />
      <WorkFx />
      <Birds tier={tier} />
      <Ravens />
      {world.venues && <Venues venues={world.venues} tier={tier} />}
      {hand && (
        <>
          <Smoke tier={tier} />
          <Sparks />
          <Windows />
          <Villagers tier={tier} />
        </>
      )}
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
