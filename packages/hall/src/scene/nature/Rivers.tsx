import { useThree } from "@react-three/fiber"
import { use, useEffect, useMemo, useState } from "react"
import {
  type DirectionalLight,
  type Material,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type WebGLRenderer,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { isWebGPU } from "../../render/backend.ts"
import type { Waterways } from "../../world/waterways.ts"
import { useLooks } from "../atmosphere/looks.ts"
import { installNodes, TSL } from "../tsl.ts"
import { fallsGeometry } from "./fallMesh.ts"
import { surfaceGeometry } from "./riverMesh.ts"
import { fallFragment, fallVertex, riverFragment, riverVertex } from "./riverShaders.ts"
import { type WaterUniforms, waterUniforms } from "./Water.tsx"
import { useWaterSky } from "./waterSky.ts"

/**
 * Inland water (world-gen v2 §2.3; R1, the water spike): every river and lake on the terraces as
 * one mesh, every waterfall as one more — two draw calls however many there are, no extra pass,
 * and nothing in the shadow pass (water casts none). The sea stays Water.tsx's. Each body of water
 * is flat at its own height and the land's tiles clip it at the banks; how it runs, where its banks
 * are and where falls land it reads per vertex (riverMesh.ts), not from a baked texture, so a
 * generated island needs no bake for it.
 *
 * GLSL by default (riverShaders.ts), the same water as TSL node materials (riverNodes.ts) on WebGPU
 * and on WebGL with `?tsl=1`, reading the same uniforms (Water.tsx's set; useWaterSky writes them).
 */
export function Rivers({ waters, tier }: { waters: Waterways; tier: Tier }) {
  const gl = useThree((state) => state.gl)
  const node = isWebGPU(gl) || TSL
  const build = node ? use(nodeRivers(gl)) : riverMaterials
  const v2 = useLooks().water
  // The node materials' shadow is the key light's own (grassNodes.ts keyShadow): rebuilt once it has a map.
  const [key, setKey] = useState<DirectionalLight | null>(null)
  const surface = useMemo(() => surfaceGeometry(waters), [waters])
  const falls = useMemo(() => fallsGeometry(waters), [waters])
  const { materials, uniforms } = useMemo(() => build(tier === 0, v2, key), [build, tier, v2, key])
  useWaterSky(uniforms, node ? setKey : undefined)
  useEffect(
    () => () => {
      for (const material of materials) material.dispose()
    },
    [materials],
  )
  useEffect(() => () => surface.dispose(), [surface])
  useEffect(() => () => falls.dispose(), [falls])

  return (
    <>
      {waters.rivers.length + waters.lakes.length > 0 && (
        <mesh name="nature-rivers" geometry={surface} material={materials[0]} receiveShadow />
      )}
      {waters.falls.length > 0 && (
        <mesh name="nature-falls" geometry={falls} material={materials[1]} receiveShadow />
      )}
    </>
  )
}

/** The surface's and the falls' materials, either path, and the uniforms both read. */
interface RiverMaterials {
  materials: readonly [Material, Material]
  uniforms: WaterUniforms
}
type Build = (low: boolean, v2: boolean, key: DirectionalLight | null) => RiverMaterials

function riverMaterials(low: boolean, v2: boolean): RiverMaterials {
  const defines: Record<string, unknown> = {}
  if (low) defines.NATURE_LOW = ""
  if (v2) defines.WATER_V2 = ""
  const uniforms = waterUniforms()
  // Three's light (the key's shadow) and fog uniforms, then the water's own, shared by both.
  const all = { ...UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog]), ...uniforms }
  const material = (vertexShader: string, fragmentShader: string) =>
    new ShaderMaterial({ uniforms: all, vertexShader, fragmentShader, lights: true, fog: true, defines })
  return { materials: [material(riverVertex, riverFragment), material(fallVertex, fallFragment)], uniforms }
}

const nodeBuilds = new WeakMap<object, Promise<Build>>()

/**
 * The node-material water, once the renderer can draw it (one promise per renderer, for `use`).
 * WebGPU draws node materials natively; WebGL needs the nodes handler first.
 */
function nodeRivers(gl: object): Promise<Build> {
  let build = nodeBuilds.get(gl)
  if (!build) {
    const ready = isWebGPU(gl) ? Promise.resolve() : installNodes(gl as WebGLRenderer)
    build = ready
      .then(() => import("./riverNodes.ts"))
      .then(({ fallNodeMaterial, riverNodeMaterial }) => (low, v2, key) => {
        const uniforms = waterUniforms()
        return {
          materials: [riverNodeMaterial(uniforms, { low, v2, key }), fallNodeMaterial(uniforms, { key })],
          uniforms,
        }
      })
    nodeBuilds.set(gl, build)
  }
  return build
}
