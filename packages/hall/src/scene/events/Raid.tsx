import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import { type Group, Mesh, MeshStandardMaterial, type Object3D } from "three"
import { SHIPS_URL } from "../../world/cast.ts"
import { HEX_SCALE } from "../../world/lands.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { bakeNode, clamp01, flutter, lerp, smooth } from "./common.ts"
import type { ShowProps } from "./EventsLayer.tsx"

/**
 * The raid (a very expensive or very long session, guild/events.ts): a pirate ship sails in out of
 * the haze, swings broadside and drops anchor off the south shore with its black flag snapping;
 * a rowboat of raiders pulls for the quay and back, again and again, for as long as the quest runs.
 * When the quest ends (or a seek, or the cap) it weighs anchor and sails off into the fog. Two draw
 * calls: the ship baked into one mesh (flags and sails flutter in its vertex shader), the rowboat.
 */

const SEA_Y = -0.2 * HEX_SCALE + 0.05
/** Off the south shore, inside the merchants' lap (Ships.tsx), in front of the default camera. */
const ANCHOR = [34, 100] as const
const FROM = [170, 175] as const
const AWAY = [190, 40] as const
/** Bow along +x at anchor: broadside to the island. */
const MOORED = Math.PI / 2
const SCALE = 1.2
const DRAFT = 1.3
const ARRIVE_S = 20
const LEAVE_S = 18
/** The raiders' landing, by the quay, and the rowboat's round trip (s). */
const LANDING = [14, 85] as const
const ROW_S = 13
const WAIT_S = 5

export default function Raid({ show, events }: ShowProps) {
  const { nodes } = useGLTF(SHIPS_URL) as unknown as { nodes: Record<string, Object3D> }
  const ship = useRef<Group>(null)
  const boat = useRef<Group>(null)
  const age = useRef(0)
  /** Age when it was told to leave, and where it was then. */
  const left = useRef<{ at: number; x: number; z: number; heading: number } | null>(null)
  const finished = useRef(false)
  const uniforms = useRef({ uTime: { value: 0 } }).current
  const built = useOwnedMeshes(
    () => buildRaid(nodes["ship-pirate-medium"], nodes["boat-row-small"], uniforms),
    [nodes],
    "textures",
  )

  useFrame((_, delta) => {
    const s = ship.current
    const b = boat.current
    if (!built || !s || !b) return
    age.current += Math.min(delta, 0.1)
    const t = age.current
    uniforms.uTime.value = t

    let x: number
    let z: number
    let heading: number
    let visible = 1
    if (show.leaving && !left.current)
      left.current = { at: t, x: s.position.x, z: s.position.z, heading: s.rotation.y }
    const leaving = left.current
    if (leaving) {
      // Weigh anchor: turn for the open sea and go, fading into the haze.
      const p = clamp01((t - leaving.at) / LEAVE_S)
      const e = p * p
      x = lerp(leaving.x, AWAY[0], e)
      z = lerp(leaving.z, AWAY[1], e)
      const out = Math.atan2(AWAY[0] - leaving.x, AWAY[1] - leaving.z)
      heading = lerp(leaving.heading, out, smooth(0, 0.3, p))
      visible = 1 - smooth(0.6, 1, p)
      if (p >= 1 && !finished.current) {
        finished.current = true
        events.done(show.id)
      }
    } else {
      // Sail in, easing to a stop, and swing broadside for the last stretch.
      const p = clamp01(t / ARRIVE_S)
      const e = 1 - (1 - p) ** 3
      x = lerp(FROM[0], ANCHOR[0], e)
      z = lerp(FROM[1], ANCHOR[1], e)
      const course = Math.atan2(ANCHOR[0] - FROM[0], ANCHOR[1] - FROM[1])
      heading = lerp(course, MOORED, smooth(0.65, 1, p))
      visible = smooth(0, 0.15, p)
    }
    const bob = Math.sin(t * 0.9) * 0.12
    s.position.set(x, SEA_Y - DRAFT * SCALE + bob, z)
    s.rotation.set(Math.sin(t * 0.6) * 0.02, heading, Math.sin(t * 0.8) * 0.04)
    s.scale.setScalar(SCALE * (0.4 + 0.6 * visible))
    s.visible = visible > 0.01

    // The rowboat: out from the ship's landward side to the quay and back, once anchored.
    const rowing = !leaving && t > ARRIVE_S + 2
    b.visible = rowing
    if (rowing) {
      const cycle = (t - ARRIVE_S - 2) % (2 * (ROW_S + WAIT_S))
      const sideX = ANCHOR[0] - 3
      const sideZ = ANCHOR[1] - 5
      let k: number
      let back = false
      if (cycle < WAIT_S) k = 0
      else if (cycle < WAIT_S + ROW_S) k = smooth(0, 1, (cycle - WAIT_S) / ROW_S)
      else if (cycle < 2 * WAIT_S + ROW_S) k = 1
      else {
        k = 1 - smooth(0, 1, (cycle - 2 * WAIT_S - ROW_S) / ROW_S)
        back = true
      }
      const bx = lerp(sideX, LANDING[0], k)
      const bz = lerp(sideZ, LANDING[1], k)
      const stroke = Math.sin(t * 3.2)
      b.position.set(bx, SEA_Y - 0.25 + Math.abs(stroke) * 0.05, bz)
      const toShore = Math.atan2(LANDING[0] - sideX, LANDING[1] - sideZ)
      b.rotation.set(stroke * 0.04, back ? toShore + Math.PI : toShore, Math.sin(t * 1.4) * 0.05)
    }
  }, FRAME.WORLD)

  if (!built) return null
  return (
    <group name="raid">
      <group ref={ship}>{built.ship && <primitive object={built.ship} />}</group>
      <group ref={boat} scale={1.15} visible={false}>
        {built.boat && <primitive object={built.boat} />}
      </group>
    </group>
  )
}

function buildRaid(
  shipNode: Object3D | undefined,
  boatNode: Object3D | undefined,
  uniforms: { uTime: { value: number } },
) {
  const meshes: Mesh[] = []
  const make = (node: Object3D | undefined, flutters: boolean): Mesh | null => {
    const baked = node ? bakeNode(node) : null
    if (!baked) return null
    const material = new MeshStandardMaterial({ map: baked.material.map, roughness: 0.85 })
    if (flutters) flutter(material, uniforms, 0.18)
    const mesh = new Mesh(baked.geometry, material)
    // It moves: never in the static shadow map (atmosphere/shadows.ts).
    mesh.castShadow = false
    mesh.receiveShadow = true
    meshes.push(mesh)
    return mesh
  }
  const ship = make(shipNode, true)
  const boat = make(boatNode, false)
  return { meshes, ship, boat }
}
