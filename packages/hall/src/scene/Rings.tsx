import { useFrame } from "@react-three/fiber"
import { type RefObject, useEffect, useState } from "react"
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  RingGeometry,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { capacityFor } from "./Blobs.tsx"
import { DITHER_GLSL } from "./dissolve.ts"
import { useOwnedMeshes } from "./owned.ts"

/**
 * The coloured ring under every adventurer's feet: one instanced draw for the whole cast. Each
 * adventurer registers its root and a look it keeps current (colour, selected); the ring follows the
 * root, dissolves with it (its presence, dithered as scene/dissolve.ts does) and hides with it.
 * Selected, it is wider (outer 1.05, not 0.9) and stronger (0.95, not 0.55): the ring's outer edge
 * is moved per instance in the vertex shader, so both are the same 40-segment ring as before.
 */
export interface RingLook {
  color: string
  selected: boolean
}

interface Ring {
  node: Object3D
  look: RingLook
  presence: () => number
}

/** One ring's shape and strength. Pure, for tests. */
export function ringOf(selected: boolean): { outer: number; alpha: number } {
  return selected ? { outer: 1.05, alpha: 0.95 } : { outer: 0.9, alpha: 0.55 }
}

const rings = new Set<Ring>()

/** A ring under `node` while mounted. `look` is read every frame (mutate it, no re-render needed). */
export function useRing(node: RefObject<Object3D | null>, look: RingLook, presence: () => number): void {
  useEffect(() => {
    if (!node.current) return
    const entry: Ring = { node: node.current, look, presence }
    rings.add(entry)
    return () => {
      rings.delete(entry)
    }
  }, [node, look, presence])
}

/**
 * GLSL for a dither driven per instance: `presence` (0 gone … 1 whole) instead of a uniform, the
 * same 4×4 Bayer threshold as scene/dissolve.ts. First thing in main().
 */
export function presenceDiscard(presence: string): string {
  return `if ( ${presence} < 1.0 && guildDither( gl_FragCoord.xy ) >= ${presence} ) discard;`
}
/** The dither's functions without dissolve.ts's uniform (each instance carries its own presence). */
export const DITHER_FUNCTIONS = DITHER_GLSL.replace("uniform float uDissolve;", "")

/** The ring's geometry: outer vertices at radius 1, moved to each instance's outer radius. */
const INNER = 0.75
const SEGMENTS = 40
/** Under the feet, flat (the ring is modelled in XY): set on top of each root's world matrix. */
const UNDERFOOT = new Matrix4()
  .makeTranslation(0, 0.06, 0)
  .multiply(new Matrix4().makeRotationX(-Math.PI / 2))

export function Rings() {
  const [capacity, setCapacity] = useState(64)
  const built = useOwnedMeshes(() => {
    const material = new MeshBasicMaterial({ transparent: true, depthWrite: false })
    material.onBeforeCompile = patchRing
    material.customProgramCacheKey = () => "cast-ring"
    const mesh = new InstancedMesh(new RingGeometry(INNER, 1, SEGMENTS), material, capacity)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
    // Per ring: outer radius, opacity, presence.
    mesh.geometry.setAttribute("aRing", new InstancedBufferAttribute(new Float32Array(capacity * 3), 3))
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    return { meshes: [mesh] }
  }, [capacity])

  useFrame(() => {
    const wanted = capacityFor(rings.size, capacity)
    if (wanted !== capacity) setCapacity(wanted)
    const mesh = built?.meshes[0] as InstancedMesh<RingGeometry, Material> | undefined
    if (!mesh) return
    const shape = mesh.geometry.getAttribute("aRing") as InstancedBufferAttribute
    let k = 0
    for (const ring of rings) {
      if (k >= capacity) break
      if (!ring.node.visible) continue
      ring.node.updateWorldMatrix(true, false)
      mesh.setMatrixAt(k, matrix.multiplyMatrices(ring.node.matrixWorld, UNDERFOOT))
      mesh.setColorAt(k, color.set(ring.look.color))
      const { outer, alpha } = ringOf(ring.look.selected)
      shape.setXYZ(k, outer, alpha, ring.presence())
      k++
    }
    mesh.count = k
    mesh.visible = k > 0
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    shape.needsUpdate = true
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

function patchRing(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec3 aRing;\nvarying vec2 vRing;")
    .replace(
      "#include <begin_vertex>",
      // Outer vertices (radius 1) out to this ring's outer radius; inner ones stay at INNER.
      `#include <begin_vertex>\nif ( length( position.xy ) > ${((INNER + 1) / 2).toFixed(3)} ) transformed.xy *= aRing.x;\nvRing = aRing.yz;`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nvarying vec2 vRing;\n${DITHER_FUNCTIONS}`)
    .replace("void main() {", `void main() {\n\t${presenceDiscard("vRing.y")}`)
    .replace("#include <color_fragment>", "#include <color_fragment>\n\tdiffuseColor.a *= vRing.x;")
}

const matrix = new Matrix4()
const color = new Color()
