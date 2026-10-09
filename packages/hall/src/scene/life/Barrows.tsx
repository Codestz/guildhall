import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { InstancedMesh, Matrix4, type Object3D, Quaternion, Vector3 } from "three"
import { LANDS_URL } from "../../world/cast.ts"
import { HEX_SCALE } from "../../world/lands.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { merged } from "./pieces.ts"
import type { Troupe } from "./troupe.ts"

/**
 * The traders' barrows (the land pack's wheelbarrow with a crate in it), pushed ahead of whoever
 * pushes one along the road: one instanced draw for all of them, laid out once a frame from the
 * walkers (troupe.ts). Nothing here casts into the static shadow map.
 */

/** How far ahead of the trader the barrow rides, and the crate's lift on it. */
const AHEAD = 1.25
const CRATE_AT = [0, 0.62, -0.05] as const

export function Barrows({ troupe }: { troupe: Troupe }) {
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const pushers = troupe.walkers.filter((walker) => walker.folk.barrow)
  const built = useOwnedMeshes(
    () => {
      const part = merged(nodes, ["wheelbarrow", "crate_A_small"], HEX_SCALE, (name, geometry) => {
        if (name === "crate_A_small") geometry.translate(...CRATE_AT)
      })
      if (!part || pushers.length === 0) return { meshes: [] }
      const mesh = new InstancedMesh(part.geometry, part.material, pushers.length)
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.count = 0
      return { meshes: [mesh] }
    },
    [nodes, pushers.length],
    "materials",
  )

  useFrame(() => {
    const mesh = built?.meshes[0] as InstancedMesh | undefined
    if (!mesh) return
    let n = 0
    for (const walker of pushers) {
      // Out on the road with it; at night it waits by the stall (and is not drawn).
      if (!walker.visible || walker.slot !== "work") continue
      const y = troupe.heightAt(walker.x, walker.z) + walker.level
      mesh.setMatrixAt(
        n++,
        matrix.compose(
          position.set(walker.x + Math.sin(walker.yaw) * AHEAD, y, walker.z + Math.cos(walker.yaw) * AHEAD),
          turn.setFromAxisAngle(UP, walker.yaw),
          unit,
        ),
      )
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
  }, FRAME.WORLD)

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

const matrix = new Matrix4()
const position = new Vector3()
const turn = new Quaternion()
const unit = new Vector3(1, 1, 1)
const UP = new Vector3(0, 1, 0)
