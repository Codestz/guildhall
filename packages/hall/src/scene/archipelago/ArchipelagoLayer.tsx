import { useFrame } from "@react-three/fiber"
import { type CSSProperties, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { CircleGeometry, type Vector3 } from "three"
import type { Tier } from "../../guild/quality.ts"
import type { Archipelago, FarIsland, IslandInfo } from "../../world/archipelagoSource.ts"
import { chunksOf } from "../../world/chunks.ts"
import { WorldScope } from "../../world/source.ts"
import { Island } from "../Island.tsx"
import { Label } from "../Label.tsx"
import LinksLayer from "../links/LinksLayer.tsx"
import { Fields } from "../nature/Fields.tsx"
import { Grass } from "../nature/Grass.tsx"
import { Rivers } from "../nature/Rivers.tsx"
import { Water } from "../nature/Water.tsx"
import { Wilds } from "../nature/Wilds.tsx"
import { useTier } from "../Quality.tsx"
import { Ships } from "../Ships.tsx"
import { useChunksAt } from "../tiers.ts"
import { IdleLights, Lighthouse } from "./IdleIsland.tsx"
import { HOME, islandView, type Stop, useIslandView } from "./view.ts"

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
  return (
    <group name="archipelago">
      {archipelago.islands.map((island) => (
        <FarIslandLayer key={island.repo} island={island} tier={tier} />
      ))}
      <Suspense fallback={null}>
        <LinksLayer archipelago={archipelago} />
      </Suspense>
      {[archipelago.home, ...archipelago.islands].map((island, i) => (
        <IslandMark key={island.repo} island={island} stop={i === 0 ? HOME : i - 1} map={map} />
      ))}
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

function FarIslandLayer({ island, tier }: { island: FarIsland; tier: Tier }) {
  const near = useNear(island)
  // Its regions' tiers go by where it lies, not by its own coordinates (scene/tiers.ts).
  useChunksAt(chunksOf(island.world), island.at)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    if (near) setGrown(true)
  }, [near])
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

/** Whether the camera is close on this island: its target on the island, zoomed in. Re-renders on change. */
function useNear(island: IslandInfo): boolean {
  const [near, setNear] = useState(false)
  const was = useRef(false)
  useFrame((state) => {
    const target = (state.controls as unknown as { target?: Vector3 } | null)?.target
    if (!target) return
    const d = Math.hypot(target.x - island.at[0], target.z - island.at[1])
    const camera = state.camera as { isOrthographicCamera?: boolean; zoom: number; position: Vector3 }
    const zoomed = camera.isOrthographicCamera
      ? camera.zoom >= Math.min(state.size.width / 44, state.size.height / 31) * 0.42 * NEAR_ZOOM
      : camera.position.distanceTo(target) < NEAR_DISTANCE
    const reach = island.reach + NEAR_MARGIN + (was.current ? NEAR_HYSTERESIS : 0)
    const now = zoomed && d < reach
    if (now !== was.current) {
      was.current = now
      setNear(now)
    }
  })
  return near
}

/**
 * An island's name on its far coast in the map view, in its main language's colour: a button that
 * flies there. Drawn over the adventurers' chips; the home island's on its near coast, clear of them.
 * Also an invisible disc over its land in the map view, so a click on the island itself does the same.
 */
function IslandMark({ island, stop, map }: { island: IslandInfo; stop: Stop; map: boolean }) {
  const disc = useMemo(() => new CircleGeometry(island.reach, 24).rotateX(-Math.PI / 2), [island.reach])
  useEffect(() => () => disc.dispose(), [disc])
  if (!map) return null
  // The home island's keep is where the guild stands, and its chips climb up the screen from there
  // into the plate's usual spot (the far coast): that plate goes to the near coast, under them.
  const out = island.reach * (stop === HOME ? HOME_PLATE_OUT : PLATE_OUT)
  return (
    <group position={[island.at[0], 0, island.at[1]]}>
      <mesh
        geometry={disc}
        position-y={1}
        onClick={(event) => {
          event.stopPropagation()
          islandView.go(stop)
        }}
      >
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <Label position={[-out, 10, -out]} center zIndexRange={PLATE_Z}>
        <button
          type="button"
          className="island-mark"
          style={{ "--accent": island.language.colour } as CSSProperties}
          onClick={() => islandView.go(stop)}
          title={`Fly to ${island.repo}`}
        >
          <i className="island-swatch" aria-hidden="true" />
          <span className="island-mark-name">{island.name}</span>
          <span className="island-mark-lang">{island.language.name}</span>
        </button>
      </Label>
    </group>
  )
}

/** A plate's spot, as a share of its island's reach out along the far diagonal. */
const PLATE_OUT = 0.5
/** The home island's: negative, the near coast. */
const HOME_PLATE_OUT = -0.6
/**
 * Over the adventurers' chips (scene/Adventurer.tsx, 20…0): on the map an island's name is what the
 * view is for, so a chip passing under it never covers it.
 */
const PLATE_Z: readonly [number, number] = [24, 21]
