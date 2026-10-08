import { useFrame } from "@react-three/fiber"
import { type RefObject, useEffect, useState } from "react"
import {
  CanvasTexture,
  InstancedBufferAttribute,
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
 * Walkers register their root; `size` scales the disc (0 hides it, e.g. a villager indoors) and
 * `opacity` fades it (a character dissolving in or out: its shadow fades with it, never shrinks).
 * Each disc's opacity rides in its instance colour's red channel (the disc itself is always black).
 */
export interface Walker {
  node: Pick<Object3D, "visible">
  radius: number
  size?: (() => number) | undefined
  opacity?: (() => number) | undefined
}

/** One walker's disc this frame: its radius and opacity. Pure, for tests. */
export interface BlobLook {
  size: number
  alpha: number
}

/** Fills `out` with `walker`'s disc; false when there is nothing to draw (hidden, tiny or faded out). */
export function blobOf(walker: Walker, out: BlobLook): boolean {
  if (!walker.node.visible) return false
  out.size = (walker.size?.() ?? 1) * walker.radius
  const opacity = walker.opacity?.() ?? 1
  out.alpha = opacity < 0 ? 0 : opacity > 1 ? 1 : opacity
  return out.size > 0.01 && out.alpha > 0.005
}

const walkers = new Set<Walker & { node: Object3D }>()

/**
 * How many instances a layer needs room for: `capacity` while `needed` fits, else doubled until it
 * does (a crowd grows the buffer; it never drops anyone). Never shrinks. Shared by the cast's
 * instanced layers (Rings, DeedEffects).
 */
export function capacityFor(needed: number, capacity: number): number {
  let size = Math.max(1, capacity)
  while (size < needed) size *= 2
  return size
}

/**
 * Puts a soft shadow under `node` while mounted. `size` and `opacity` must be stable (ref'd
 * closures): `opacity` is how present the character is (its dissolve, scene/dissolve.ts).
 */
export function useBlob(
  node: RefObject<Object3D | null>,
  radius: number,
  size?: () => number,
  opacity?: () => number,
): void {
  useEffect(() => {
    if (!node.current) return
    const entry: Walker & { node: Object3D } = { node: node.current, radius, size, opacity }
    walkers.add(entry)
    return () => {
      walkers.delete(entry)
    }
  }, [node, radius, size, opacity])
}

export function Blobs() {
  const [capacity, setCapacity] = useState(64)
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
    // Per-disc opacity: the instance colour's red channel scales alpha; the colour stays black.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#ifdef USE_COLOR\n\tdiffuseColor.a *= vColor.r;\n#endif",
      )
    }
    material.customProgramCacheKey = () => "blob-alpha"
    const mesh = new InstancedMesh(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material, capacity)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    mesh.castShadow = false
    mesh.receiveShadow = false
    return { meshes: [mesh] }
  }, [capacity])

  useFrame(() => {
    // More walkers than discs: rebuilt bigger (until then, the first `capacity` keep theirs).
    const wanted = capacityFor(walkers.size, capacity)
    if (wanted !== capacity) setCapacity(wanted)
    const instances = built?.meshes[0]
    if (!instances) return
    const material = instances.material
    // As dark as the sun's own shadows: softer under cloud, faint by moonlight.
    material.opacity = 0.5 * sky.keyShadow * Math.min(1, sky.keyIntensity / 1.5 + 0.35)
    const alphas = instances.instanceColor?.array
    let k = 0
    for (const walker of walkers) {
      if (k >= capacity) break
      if (!blobOf(walker, look)) continue
      walker.node.getWorldPosition(position)
      position.y += 0.03
      scale.set(look.size, 1, look.size)
      if (alphas) alphas[k * 3] = look.alpha
      instances.setMatrixAt(k++, matrix.compose(position, IDENTITY, scale))
    }
    instances.count = k
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
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
const look: BlobLook = { size: 0, alpha: 0 }
