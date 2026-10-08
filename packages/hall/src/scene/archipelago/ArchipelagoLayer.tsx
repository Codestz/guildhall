import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { type CSSProperties, Suspense, useEffect, useMemo, useRef, useState } from "react"
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  type Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import type { Archipelago, FarIsland, IslandInfo } from "../../world/archipelagoSource.ts"
import { LANDS_URL, SHIPS_URL } from "../../world/cast.ts"
import { HEX_SCALE } from "../../world/lands.ts"
import { glowsOf, lightsOf } from "../../world/lights.ts"
import { useWorld, WorldScope } from "../../world/source.ts"
import { halos } from "../atmosphere/Lamps.tsx"
import { sky } from "../atmosphere/state.ts"
import { bakeNode } from "../events/common.ts"
import { FRAME } from "../frame.ts"
import { Island } from "../Island.tsx"
import { mergePlacements, useKit } from "../Kit.tsx"
import { Label } from "../Label.tsx"
import { Pools } from "../lights/StreetLights.tsx"
import { Fields } from "../nature/Fields.tsx"
import { Grass } from "../nature/Grass.tsx"
import { Water } from "../nature/Water.tsx"
import { Wilds } from "../nature/Wilds.tsx"
import { useOwnedMeshes } from "../owned.ts"
import { useTier } from "../Quality.tsx"
import { SEA_Y, Ships, watersOf } from "../Ships.tsx"
import { harbourOf, lighthouseSpot } from "../seas/fleet.ts"
import { FERRIES, type FerryAt, ferryAt } from "./ferries.ts"
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
 * that cross between them now and then (scene/archipelago/ferries.ts).
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
        <Ferries archipelago={archipelago} />
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

function FarIslandLayer({ island, tier }: { island: FarIsland; tier: Tier }) {
  const near = useNear(island)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    if (near) setGrown(true)
  }, [near])
  return (
    <group name={`island-${island.name}`} position={[island.at[0], 0, island.at[1]]}>
      <WorldScope value={island.world}>
        <Suspense fallback={null}>
          <Island />
          <Water tier={tier} at={island.at} />
          <Wilds tier={near ? tier : 0} />
          <Fields />
          <IdleLights />
          <Lighthouse />
          <Ships />
        </Suspense>
        {grown && (
          <group visible={near}>
            <Suspense fallback={null}>
              <Grass tier={tier} />
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
 * A far island's night lights: its lanterns and torch posts (merged), a pool under each and a
 * halo on each flame, waking with `sky.lamps` — the home island's look (lights/StreetLights.tsx,
 * atmosphere/Lamps.tsx), without the carried lanterns or the point lights (nobody walks there).
 */
function IdleLights() {
  const kit = useKit()
  const world = useWorld()
  const lights = lightsOf(world)
  const glows = glowsOf(world)
  const models = useOwnedMeshes(
    () => {
      const meshes = mergePlacements(
        kit,
        lights.map((light) => light.placement),
      )
      for (const mesh of meshes) mesh.castShadow = false
      return { meshes }
    },
    [kit, lights],
    "materials",
  )
  const flames = useOwnedMeshes(() => ({ meshes: [halos(glows.length)] }), [glows])
  const store = useGuildStore()
  useFrame(({ camera, clock }) => {
    const mesh = flames?.meshes[0] as ReturnType<typeof halos> | undefined
    if (!mesh) return
    camera.getWorldQuaternion(facing)
    tint.set(store.mood.fire)
    const t = clock.elapsedTime
    for (let i = 0; i < glows.length; i++) {
      const glow = glows[i]
      if (!glow) continue
      const flicker = 0.88 + Math.sin(t * 9.1 + i * 1.7) * 0.06 + Math.sin(t * 15.7 + i * 3.4) * 0.05
      const size = glow.halo * (0.8 + sky.lamps * 0.35) * flicker
      matrix.compose(
        place.set(glow.flame[0], glow.flame[1], glow.flame[2]),
        facing,
        scale.set(size, size, size),
      )
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, colour.copy(tint).multiplyScalar(flicker * (0.1 + sky.lamps * 1.6)))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
  return (
    <group name="idle-lights">
      {models?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      {flames?.meshes[0] && <primitive object={flames.meshes[0]} />}
      <Pools glows={glows} />
    </group>
  )
}

/** The lighthouse's lamp, over the tower's roof (scene/seas/SeasLayer.tsx's). */
const LAMP_Y = 11.8
const BEAM_LENGTH = 70

/**
 * A lighthouse on the coast by the island's harbour (scene/seas/fleet.ts `lighthouseSpot`), when
 * it has a coast to stand on: the tower, a lamp that wakes at dusk, and at night a beam sweeping
 * the sea. Three draws.
 */
function Lighthouse() {
  const world = useWorld()
  const lands = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const spot = useMemo(() => lighthouseSpot(world.island, harbourOf(watersOf(world).quay)), [world])
  const built = useOwnedMeshes(() => {
    const source = lands.nodes.building_tower_A_blue
    const baked = source ? bakeNode(source) : null
    if (!spot || !baked) return { meshes: [] as Mesh[], lamp: null, beam: null }
    const tower = new Mesh(
      baked.geometry,
      new MeshStandardMaterial({ map: baked.material.map, roughness: 0.9 }),
    )
    tower.position.set(spot.x, 0, spot.z)
    tower.scale.setScalar(HEX_SCALE)
    tower.rotation.y = Math.atan2(-spot.x, -spot.z)
    tower.castShadow = true
    tower.receiveShadow = true
    const lamp = new Mesh(new SphereGeometry(0.9, 12, 8), new MeshBasicMaterial({ toneMapped: false }))
    lamp.position.set(spot.x, LAMP_Y, spot.z)
    const cone = new ConeGeometry(7, BEAM_LENGTH, 20, 6, true)
    cone.translate(0, -BEAM_LENGTH / 2, 0)
    // Bright at the lamp, gone at the far end: additive, so a black vertex adds nothing.
    const along = cone.getAttribute("position")
    const fade = new Float32Array(along.count * 3)
    for (let i = 0; i < along.count; i++) fade.fill((1 + along.getY(i) / BEAM_LENGTH) ** 2, i * 3, i * 3 + 3)
    cone.setAttribute("color", new Float32BufferAttribute(fade, 3))
    cone.rotateX(-Math.PI / 2 + 0.06)
    const beam = new Mesh(
      cone,
      new MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        blending: AdditiveBlending,
        vertexColors: true,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    beam.position.copy(lamp.position)
    beam.renderOrder = 2
    beam.frustumCulled = false
    return { meshes: [tower, lamp, beam], lamp, beam }
  }, [lands.nodes, spot])

  useFrame(({ clock }) => {
    if (!built?.lamp || !built.beam) return
    const lamps = sky.lamps
    ;(built.lamp.material as MeshBasicMaterial).color
      .setRGB(0.25, 0.24, 0.27)
      .lerp(WARM, Math.min(1, lamps * 1.2))
    const beam = built.beam.material as MeshBasicMaterial
    built.beam.visible = sky.night > 0.15
    beam.opacity = 0.32 * sky.night
    built.beam.rotation.y = clock.elapsedTime * 0.5
  })

  return built?.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />) ?? null
}

/** The ships that cross between the islands: a hull each, rising at one quay and sinking at the next. */
function Ferries({ archipelago }: { archipelago: Archipelago }) {
  const store = useGuildStore()
  const { nodes } = useGLTF(SHIPS_URL) as unknown as { nodes: Record<string, Object3D> }
  const shores = useMemo(() => [archipelago.home, ...archipelago.islands], [archipelago])
  const hulls = useMemo(
    () =>
      Array.from({ length: FERRIES }, (_, i) => {
        const source = nodes[FERRY_HULLS[i % FERRY_HULLS.length] as string]
        if (!source) return null
        const copy = source.clone(true)
        copy.traverse((child) => {
          const mesh = child as Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = false
          mesh.receiveShadow = true
        })
        return copy
      }),
    [nodes],
  )
  const refs = useRef<(Group | null)[]>([])
  const at = useMemo<FerryAt>(() => ({ x: 0, z: 0, heading: 0, shown: 0 }), [])

  useFrame((state) => {
    const t = store.time / 1000
    const bob = state.clock.elapsedTime
    for (let i = 0; i < FERRIES; i++) {
      const group = refs.current[i]
      if (!group) continue
      const sailing = ferryAt(shores, archipelago.crossings, i, t, at)
      group.visible = sailing
      if (!sailing) continue
      const sink = (1 - at.shown) * 3
      group.position.set(at.x, SEA_Y - FERRY_DRAFT + Math.sin(bob * 0.9 + i) * 0.12 - sink, at.z)
      group.rotation.set(Math.sin(bob * 0.6 + i * 2) * 0.03, at.heading, Math.sin(bob * 0.8 + i) * 0.05)
      group.scale.setScalar(FERRY_SCALE * (0.4 + 0.6 * at.shown))
    }
  }, FRAME.WORLD)

  return (
    <group name="ferries">
      {hulls.map((hull, i) =>
        hull ? (
          <group
            // biome-ignore lint/suspicious/noArrayIndexKey: one slot per ferry, fixed
            key={i}
            ref={(group) => {
              refs.current[i] = group
            }}
            visible={false}
          >
            <primitive object={hull} />
          </group>
        ) : null,
      )}
    </group>
  )
}
const FERRY_HULLS = ["ship-medium", "ship-small", "ship-large"]
const FERRY_SCALE = 1
const FERRY_DRAFT = 1

/**
 * An island's name on its far coast in the map view (clear of the adventurers' chips over the keep), in its main language's colour: a button that flies
 * there. Also an invisible disc over its land in the map view, so a click on the island itself
 * does the same.
 */
function IslandMark({ island, stop, map }: { island: IslandInfo; stop: Stop; map: boolean }) {
  const disc = useMemo(() => new CircleGeometry(island.reach, 24).rotateX(-Math.PI / 2), [island.reach])
  useEffect(() => () => disc.dispose(), [disc])
  if (!map) return null
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
      <Label position={[-island.reach * 0.5, 10, -island.reach * 0.5]} center zIndexRange={[18, 0]}>
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

const facing = new Quaternion()
const place = new Vector3()
const scale = new Vector3()
const matrix = new Matrix4()
const tint = new Color()
const colour = new Color()
/** The lighthouse lamp lit. */
const WARM = new Color("#ffcf7a").multiplyScalar(1.6)
