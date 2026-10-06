import { useEffect, useMemo, useState } from "react"
import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three"
import { plant, RIDGE_HEIGHT, SOIL } from "../../world/fields.ts"
import { shadows } from "../atmosphere/shadows.ts"
import { mergePlacements, useKit } from "../Kit.tsx"

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
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), [])
  const material = useMemo(
    () => new MeshStandardMaterial({ color: "#6e4a2c", roughness: 1, flatShading: true }),
    [],
  )
  const [mesh, setMesh] = useState<InstancedMesh | null>(null)

  useEffect(() => {
    const built = new InstancedMesh(geometry, material, PLANTED.ridges.length)
    PLANTED.ridges.forEach((r, i) => {
      rotation.setFromAxisAngle(UP, r.rot)
      built.setMatrixAt(
        i,
        matrix.compose(
          position.set(r.x, SOIL - 0.02, r.z),
          rotation,
          scale.set(0.55, RIDGE_HEIGHT + 0.02, r.length),
        ),
      )
    })
    built.receiveShadow = true
    built.computeBoundingSphere()
    setMesh(built)
    return () => built.dispose()
  }, [geometry, material])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return mesh ? <primitive object={mesh} /> : null
}

function Crops() {
  const kit = useKit()
  const [meshes, setMeshes] = useState<readonly Mesh[]>([])

  useEffect(() => {
    const built = mergePlacements(kit, PLANTED.crops)
    for (const mesh of built) {
      mesh.castShadow = false
      mesh.receiveShadow = true
    }
    setMeshes(built)
    shadows.request()
    return () => {
      for (const mesh of built) mesh.geometry.dispose()
    }
  }, [kit])

  return (
    <>
      {meshes.map((mesh) => (
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
