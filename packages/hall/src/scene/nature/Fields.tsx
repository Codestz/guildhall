import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three"
import { plant, RIDGE_HEIGHT, SOIL } from "../../world/fields.ts"
import { mergePlacements, useKit } from "../Kit.tsx"
import { useOwnedMeshes } from "../owned.ts"

/**
 * The farms' plots (world/fields.ts): soil ridges on every plot, lettuce or carrots along them, or
 * nothing on a plot that's resting. Draw calls: ridges 1, crops 1 (merged, simplified to 30% in
 * scripts/assets.ts). Nothing here casts into the static shadow map: it's all low.
 */
const PLANTED = plant()

export function Fields() {
  return (
    <group name="fields">
      <Ridges />
      <Crops />
    </group>
  )
}

function Ridges() {
  const built = useOwnedMeshes(() => {
    const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const material = new MeshStandardMaterial({ color: "#6e4a2c", roughness: 1, flatShading: true })
    const mesh = new InstancedMesh(geometry, material, PLANTED.ridges.length)
    PLANTED.ridges.forEach((r, i) => {
      rotation.setFromAxisAngle(UP, r.rot)
      mesh.setMatrixAt(
        i,
        matrix.compose(
          position.set(r.x, SOIL - 0.02, r.z),
          rotation,
          scale.set(0.55, RIDGE_HEIGHT + 0.02, r.length),
        ),
      )
    })
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    return { meshes: [mesh] }
  }, [])

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

function Crops() {
  const kit = useKit()
  // The kit's materials are borrowed: only the merged geometry is ours.
  const built = useOwnedMeshes(
    () => {
      const meshes = mergePlacements(kit, PLANTED.crops)
      for (const mesh of meshes) {
        mesh.castShadow = false
        mesh.receiveShadow = true
      }
      return { meshes }
    },
    [kit],
    "materials",
  )

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

const UP = new Vector3(0, 1, 0)
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const matrix = new Matrix4()
