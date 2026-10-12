import { useFrame } from "@react-three/fiber"
import { useLayoutEffect, useMemo, useRef } from "react"
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three"
import { useGuild } from "../../guild/useGuild.ts"
import { FURNITURE, NORMALS, type Piece, type Side, WALL_DECOR } from "../../world/furniture.ts"
import { glowsOf } from "../../world/lights.ts"
import { useWorld } from "../../world/source.ts"
import type { World } from "../../world/world.ts"
import { useOwnedMeshes } from "../owned.ts"
import type { SkyState } from "./sky.ts"

/**
 * Flames that glow (ADR 0007, task "Sky"): the hall's torches, lanterns and candles are merged
 * static meshes (Room), so their light is added here — one camera-facing, additive halo per
 * flame, all one InstancedMesh (one draw call, no dynamic lights). Faint by day, bright at night
 * (HDR, so bloom catches them); a torch on a cut-away wall fades with that wall.
 */
interface Lamp {
  x: number
  y: number
  z: number
  size: number
  side?: Side
  /** Flicker phase. */
  phase: number
}

/** Where the flame sits on each piece, from its origin (kit units), and how big its halo is. */
const FLAMES: Partial<Record<Piece, { up: number; out: number; size: number }>> = {
  torch_mounted: { up: 0.6, out: 0.42, size: 3.6 },
  lantern: { up: 0.62, out: 0, size: 3 },
  candle_lit: { up: 0.98, out: 0, size: 1.6 },
  candle_triple: { up: 0.85, out: 0, size: 1.9 },
}

function lamps(world: World): Lamp[] {
  const out: Lamp[] = []
  // The keep's own (the hand map's: a repo's island has no keep).
  for (const placement of world.kind === "hand" ? [...FURNITURE, ...WALL_DECOR] : []) {
    const flame = FLAMES[placement.piece]
    if (!flame) continue
    const rot = placement.rot ?? 0
    out.push({
      x: placement.x + Math.sin(rot) * flame.out,
      y: (placement.y ?? 0) + flame.up,
      z: placement.z + Math.cos(rot) * flame.out,
      size: flame.size * (placement.scale ?? 1),
      side: "side" in placement ? (placement.side as Side) : undefined,
      phase: out.length * 1.7,
    })
  }
  // The island's street torches and lanterns, and the graveyard's (world/lights.ts GLOWS).
  for (const light of glowsOf(world)) {
    out.push({
      x: light.flame[0],
      y: light.flame[1],
      z: light.flame[2],
      size: light.halo,
      phase: out.length * 1.7,
    })
  }
  return out
}

export function Lamps({ sky }: { sky: SkyState }) {
  const { mood } = useGuild()
  const world = useWorld()
  const list = useMemo(() => lamps(world), [world])
  const fade = useRef(list.map(() => 1))
  const fire = useMemo(() => new Color(), [])
  const built = useOwnedMeshes(() => ({ meshes: [halos(list.length)] }), [list])

  useLayoutEffect(() => {
    fire.set(mood.fire)
  }, [fire, mood.fire])

  useFrame(({ camera, clock }, delta) => {
    const instances = built?.meshes[0]
    if (!instances) return
    const t = clock.elapsedTime
    camera.getWorldQuaternion(facing)
    for (let i = 0; i < list.length; i++) {
      const lamp = list[i] as Lamp
      // Same rule as Room's cut-away: a wall whose outside faces the camera is faded out.
      let goal = 1
      if (lamp.side) {
        const [nx, nz] = NORMALS[lamp.side]
        if (camera.position.x * nx + camera.position.z * nz > 0) goal = 0
      }
      const current = (fade.current[i] ?? 1) + (goal - (fade.current[i] ?? 1)) * Math.min(1, delta * 5)
      fade.current[i] = current
      const flicker =
        0.88 + Math.sin(t * 9.1 + lamp.phase) * 0.06 + Math.sin(t * 15.7 + lamp.phase * 2) * 0.05
      const size = lamp.size * (0.8 + sky.lamps * 0.35) * flicker
      matrix.compose(position.set(lamp.x, lamp.y, lamp.z), facing, scale.set(size, size, size))
      instances.setMatrixAt(i, matrix)
      // HDR at night so bloom catches it; a whisper by day.
      tint.copy(fire).multiplyScalar(current * flicker * (0.1 + sky.lamps * 1.6))
      instances.setColorAt(i, tint)
    }
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

/**
 * `count` flame halos, one draw: camera-facing quads (set each instance's matrix with the camera's
 * quaternion), additive, depth-tested, over everything else (renderOrder 10). Colour per instance:
 * HDR at night so bloom catches them. Also the carried lanterns' halos (scene/lights/CarriedLights).
 */
export function halos(count: number): InstancedMesh {
  const material = new MeshBasicMaterial({
    map: halo(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  })
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, count)
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  return mesh
}

const facing = new Quaternion()
const matrix = new Matrix4()
const position = new Vector3()
const scale = new Vector3()
const tint = new Color()

/** A soft round falloff with a hot core, drawn once. */
function halo(): CanvasTexture {
  const size = 64
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    // A small hot core and a long, faint falloff: light in the air, not an orb.
    gradient.addColorStop(0, "rgba(255,255,255,1)")
    gradient.addColorStop(0.06, "rgba(255,255,255,0.55)")
    gradient.addColorStop(0.2, "rgba(255,255,255,0.16)")
    gradient.addColorStop(0.5, "rgba(255,255,255,0.04)")
    gradient.addColorStop(1, "rgba(255,255,255,0)")
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
