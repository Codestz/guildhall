import { useFrame } from "@react-three/fiber"
import { type RefObject, useEffect } from "react"
import {
  CanvasTexture,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three"
import { sky } from "./atmosphere/state.ts"
import { useOwnedMeshes } from "./owned.ts"

/**
 * Soft contact shadows under everyone who walks (docs/perf-budget.md): the sun's shadow map is
 * static and drawn on demand (atmosphere/shadows.ts), so moving characters don't cast into it.
 * A blurred dark disc at their feet grounds them instead — one instanced draw call for all.
 * Walkers register their root; `size` scales the disc (0 hides it, e.g. a villager indoors).
 */
export interface Walker {
  node: Object3D
  radius: number
  size?: () => number
}

const walkers = new Set<Walker>()
const MAX = 64

/** Puts a soft shadow under `node` while mounted. `size` must be stable (a ref'd closure). */
export function useBlob(node: RefObject<Object3D | null>, radius: number, size?: () => number): void {
  useEffect(() => {
    if (!node.current) return
    const entry: Walker = { node: node.current, radius, size }
    walkers.add(entry)
    return () => {
      walkers.delete(entry)
    }
  }, [node, radius, size])
}

export function Blobs() {
  const built = useOwnedMeshes(() => {
    const material = new MeshBasicMaterial({
      color: "#000000",
      map: blobTexture(),
      transparent: true,
      depthWrite: false,
      // Draw just above the ground without z-fighting it.
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    const mesh = new InstancedMesh(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material, MAX)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    mesh.castShadow = false
    mesh.receiveShadow = false
    return { meshes: [mesh] }
  }, [])

  useFrame(() => {
    const instances = built?.meshes[0]
    if (!instances) return
    const material = instances.material
    // As dark as the sun's own shadows: softer under cloud, faint by moonlight.
    material.opacity = 0.5 * sky.keyShadow * Math.min(1, sky.keyIntensity / 1.5 + 0.35)
    let k = 0
    for (const walker of walkers) {
      if (k >= MAX) break
      const size = (walker.size?.() ?? 1) * walker.radius
      if (size <= 0.01 || !walker.node.visible) continue
      walker.node.getWorldPosition(position)
      position.y += 0.03
      scale.set(size, 1, size)
      instances.setMatrixAt(k++, matrix.compose(position, IDENTITY, scale))
    }
    instances.count = k
    instances.instanceMatrix.needsUpdate = true
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

/** A radial falloff, dark at the centre: a soft contact shadow. */
function blobTexture(): CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const g = canvas.getContext("2d")
  if (g) {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, "rgba(255,255,255,1)")
    gradient.addColorStop(0.45, "rgba(255,255,255,0.7)")
    gradient.addColorStop(1, "rgba(255,255,255,0)")
    g.fillStyle = gradient
    g.fillRect(0, 0, 64, 64)
  }
  return new CanvasTexture(canvas)
}

const IDENTITY = new Quaternion()
const position = new Vector3()
const scale = new Vector3()
const matrix = new Matrix4()
