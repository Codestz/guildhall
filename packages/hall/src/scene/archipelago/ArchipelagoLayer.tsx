import { useFrame } from "@react-three/fiber"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import type { Vector3 } from "three"
import { useIslandView } from "../../guild/islandView.ts"
import type { Tier } from "../../guild/quality.ts"
import type { Archipelago, FarIsland, IslandInfo } from "../../world/archipelagoSource.ts"
import { chunksOf } from "../../world/chunks.ts"
import { HOME, type Stop } from "../../world/islandRing.ts"
import { WorldScope } from "../../world/source.ts"
import { Island } from "../Island.tsx"
import LinksLayer from "../links/LinksLayer.tsx"
import { Fields } from "../nature/Fields.tsx"
import { Grass } from "../nature/Grass.tsx"
import { Rivers } from "../nature/Rivers.tsx"
import { Water } from "../nature/Water.tsx"
import { Wilds } from "../nature/Wilds.tsx"
import { useTier } from "../Quality.tsx"
import { Ships } from "../Ships.tsx"
import { useChunksAt } from "../tiers.ts"
import { travel } from "./flight.ts"
import { IdleLights, Lighthouse } from "./IdleIsland.tsx"
import { filesOfRepo, MapMarks } from "./IslandMark.tsx"

/**
 * The archipelago's far islands (world/archipelagoSource.ts), each drawn by the hall's own layers
 * (Island, Water, Wilds, Grass, Fields, Ships) under a WorldScope of its own world, in a group
 * moved to its offset. Idle but alive: no guild there, but its districts dressed, its lanterns lit
 * at night, its ships on their laps and a lighthouse by its harbour.
 *
 * Level of detail, per island, by where the camera looks: near (the camera's target on it, zoomed
 * in) it has everything, grass and the small wilds included; far, only what reads from afar — the
 * batched land, the big trees and rocks, the fields, its water, lights and ships. Grass, once
 * grown, is hidden rather than dropped, so flying back costs nothing.
 *
 * Over them: a name on each island (its main language's colour) in the map view, and the ships
 * that join them: ferries on their lanes, bridges (scene/links).
 */
export default function ArchipelagoLayer({ archipelago }: { archipelago: Archipelago }) {
  const tier = useTier()
  const view = useIslandView()
  const map = view.stop === "map"
  const [hovered, setHovered] = useState<Stop | null>(null)
  const marks = useMemo(
    () => [
      { island: archipelago.home, stop: HOME as Stop },
      ...archipelago.islands.map((island, i) => ({
        island,
        stop: i as Stop,
        files: filesOfRepo(island.world.repo),
      })),
    ],
    [archipelago],
  )
  return (
    <group name="archipelago">
      {archipelago.islands.map((island, i) => (
        <FarIslandLayer key={island.repo} island={island} stop={i} tier={tier} />
      ))}
      <Suspense fallback={null}>
        <LinksLayer archipelago={archipelago} />
      </Suspense>
      {map && <MapMarks marks={marks} hovered={hovered} onHover={setHovered} />}
    </group>
  )
}

/** Within this many world units of its furthest land, with the camera zoomed in, an island is near. */
const NEAR_MARGIN = 40
/** …and it stays near until the target is this much further out (no flicker at the edge). */
const NEAR_HYSTERESIS = 30
/** Zoomed in past this share of the island overview: close enough for grass (orthographic). */
const NEAR_ZOOM = 0.55
/** Perspective: closer than this. */
const NEAR_DISTANCE = 240

/**
 * How finely a far island's coarse copies are held (Island's `detail`): a quarter, so they move a surface
 * up to 4 × FAR_ERROR, which is still under a pixel at the ~1 px a unit the whole map is drawn at. Measured on a
 * default archipelago round React (gen 2): its far islands' triangles fall by half.
 */
const FAR_DETAIL = 0.25

function FarIslandLayer({ island, stop, tier }: { island: FarIsland; stop: Stop; tier: Tier }) {
  const { near, warm } = useNear(island, stop)
  // Its regions' tiers go by where it lies, not by its own coordinates (scene/tiers.ts).
  useChunksAt(chunksOf(island.world), island.at)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    if (near || warm) setGrown(true)
  }, [near, warm])
  return (
    <group name={`island-${island.name}`} position={[island.at[0], 0, island.at[1]]}>
      <WorldScope value={island.world}>
        <Suspense fallback={null}>
          <Island detail={FAR_DETAIL} />
          <Water tier={tier} at={island.at} />
          {island.world.water && <Rivers waters={island.world.water} tier={tier} />}
          <Wilds tier={near ? tier : 0} />
          <Fields />
          <IdleLights near={near} />
          <Lighthouse />
        </Suspense>
        {grown && (
          <group visible={near}>
            <Suspense fallback={null}>
              <Grass tier={tier} />
              <Ships />
            </Suspense>
          </group>
        )}
      </WorldScope>
    </group>
  )
}

/**
 * A flight bound for an island has it grow its grass (unseen) as soon as it starts, and show its near
 * tier this far along (0–1): the cost lands on two frames while the camera is still crossing, not one.
 */
const PROMOTE_AT = 0.3

/**
 * Whether the camera is close on this island: its target on the island, zoomed in — or a flight
 * bound for it is well under way, so its grass and wilds are grown by the time it lands.
 * Re-renders on change.
 */
function useNear(island: IslandInfo, stop: Stop): { near: boolean; warm: boolean } {
  const [near, setNear] = useState(false)
  const [warm, setWarm] = useState(false)
  const was = useRef(false)
  const warmed = useRef(false)
  useFrame((state) => {
    const target = (state.controls as unknown as { target?: Vector3 } | null)?.target
    if (!target) return
    const d = Math.hypot(target.x - island.at[0], target.z - island.at[1])
    const camera = state.camera as { isOrthographicCamera?: boolean; zoom: number; position: Vector3 }
    const zoomed = camera.isOrthographicCamera
      ? camera.zoom >= Math.min(state.size.width / 44, state.size.height / 31) * 0.42 * NEAR_ZOOM
      : camera.position.distanceTo(target) < NEAR_DISTANCE
    const reach = island.reach + NEAR_MARGIN + (was.current ? NEAR_HYSTERESIS : 0)
    const now = (zoomed && d < reach) || (travel.heading === stop && travel.progress >= PROMOTE_AT)
    const warming = travel.heading === stop
    if (warming !== warmed.current) {
      warmed.current = warming
      setWarm(warming)
    }
    if (now !== was.current) {
      was.current = now
      setNear(now)
    }
  })
  return { near, warm }
}
