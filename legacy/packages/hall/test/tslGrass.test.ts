import { describe, expect, test } from "bun:test"
import {
  BatchedMesh,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  type InstancedMesh,
  type Material,
  type Mesh,
  Mesh as MeshClass,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  type ShaderMaterial,
  WebGLRenderTarget,
} from "three"
import { WebGPURenderer, WGSLNodeBuilder } from "three/webgpu"
import { wind } from "../src/scene/atmosphere/wind.ts"
import { glslGrass, grassUniforms, meadow } from "../src/scene/nature/Grass.tsx"
import { grassNodeMaterial, keyShadow, wildsNodeMaterial } from "../src/scene/nature/grassNodes.ts"

/**
 * The grass, its flowers and the wilds' sway as node materials (nature/grassNodes.ts: WebGPU, and
 * WebGL with `?tsl=1`): each builds into WGSL that sways with the one wind, as the GLSL does.
 */

/** `mesh`'s shaders as WebGPU would compile them (no GPU: crowdNodes.test.ts's stand-in device). */
function shaders(mesh: Mesh): { vertex: string; fragment: string } {
  const canvas = { getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} }
  const renderer = new WebGPURenderer({ canvas: canvas as never })
  const device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() }
  Object.assign(renderer.backend, { device })
  Object.assign(renderer, { hasFeature: () => false })
  const builder = new WGSLNodeBuilder(mesh, renderer)
  builder.scene = new Scene()
  builder.camera = new PerspectiveCamera()
  builder.material = mesh.material as Material
  builder.build()
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader }
}

const triangle = () => {
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  g.setAttribute("normal", new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  g.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
  return g
}

function nodeMeadow() {
  const uniforms = grassUniforms(null)
  const materials = {
    tuft: grassNodeMaterial(uniforms, { flowers: false, key: null }),
    flower: grassNodeMaterial(uniforms, { flowers: true, key: null }),
  }
  const [grass, flowers] = meadow({ tuft: triangle(), flower: triangle() }, materials, 150)
  return { grass: grass as InstancedMesh, flowers: flowers as InstancedMesh }
}

describe("the grass as node materials", () => {
  test("is drawn like the GLSL grass: both faces, fogged, the same two meshes", () => {
    const glsl = glslGrass(grassUniforms(null))
    const { grass, flowers } = nodeMeadow()
    const pick = (m: Material) => [m.side, (m as ShaderMaterial).fog]
    expect([pick(grass.material as Material), pick(flowers.material as Material)]).toEqual([
      pick(glsl.tuft),
      pick(glsl.flower),
    ])
    expect(pick(glsl.tuft)).toEqual([DoubleSide, true])
  })

  test("the tufts and the flowers each build to WGSL, swaying with the one wind; only flowers read their tint", () => {
    const { grass, flowers } = nodeMeadow()
    const tuft = shaders(grass)
    const flower = shaders(flowers)
    for (const { vertex } of [tuft, flower]) {
      expect(vertex).toContain("sin(")
      expect(vertex).toMatch(/textureSampleLevel|textureLoad/)
    }
    expect(flower.vertex).toContain("aTint")
    expect(tuft.vertex).not.toContain("aTint")
  })

  test("the two materials keep separate programs (the flower step is no node property)", () => {
    const { grass, flowers } = nodeMeadow()
    const key = (m: unknown) => (m as { customProgramCacheKey(): string }).customProgramCacheKey()
    expect(key(grass.material)).not.toBe(key(flowers.material))
  })

  test("reads the GLSL path's very uniform objects, the wind's included", () => {
    const u = grassUniforms(null)
    expect([u.uTime, u.uWind, u.uWindDir]).toEqual([
      wind.uniforms.uTime,
      wind.uniforms.uWind,
      wind.uniforms.uWindDir,
    ])
    expect(u.uTime).toBe(wind.uniforms.uTime)
    const glsl = glslGrass(u)
    expect((glsl.tuft as ShaderMaterial).uniforms.uSnow).toBe(u.uSnow)
    expect((glsl.flower as ShaderMaterial).uniforms).toBe((glsl.tuft as ShaderMaterial).uniforms)
  })
})

describe("the key light's shadow, borrowed", () => {
  test("reads the light's own map and never draws one of its own", () => {
    const light = new DirectionalLight()
    light.shadow.map = new WebGLRenderTarget(4, 4)
    const node = keyShadow(light) as unknown as {
      setupRenderTarget(shadow: unknown): { shadowMap: unknown; depthTexture: unknown }
      updateBefore(frame: unknown): void
    }
    expect(node.setupRenderTarget(light.shadow)).toEqual({
      shadowMap: light.shadow.map,
      depthTexture: light.shadow.map.depthTexture,
    })
    light.shadow.needsUpdate = true
    node.updateBefore({})
    // The on-demand redraw is left to the light's own shadow (render/shims.ts syncShadows).
    expect(light.shadow.needsUpdate).toBe(true)
  })
})

describe("the wilds' sway as a node material", () => {
  function wilds(): BatchedMesh {
    const base = new MeshStandardMaterial({ roughness: 0.7 })
    const material = wildsNodeMaterial(base)
    const piece = triangle()
    piece.setAttribute("aSway", new Float32BufferAttribute([0.5, 0.5, 0.5], 1))
    const mesh = new BatchedMesh(2, 3, 0, material)
    const id = mesh.addGeometry(piece)
    mesh.addInstance(id)
    mesh.addInstance(id)
    return mesh
  }

  test("keeps the pack material's look (copied, lit, standard)", () => {
    const material = wilds().material as MeshStandardMaterial
    expect([material.roughness, material.isMeshStandardMaterial]).toEqual([0.7, true])
  })

  test("builds to WGSL, bending each batched vertex by aSway", () => {
    const { vertex } = shaders(wilds() as unknown as Mesh)
    expect(vertex).toContain("aSway")
    expect(vertex).toContain("sin(")
  })

  /** Wilds.tsx on WebGPU: the batch merged into one mesh, each vertex with its root and height. */
  function merged(root: boolean): Mesh {
    const piece = triangle()
    piece.setAttribute("aSway", new Float32BufferAttribute([0.5, 0.5, 0.5], 1))
    if (root) piece.setAttribute("aRoot", new Float32BufferAttribute([4, 2, 0, 4, 2, 0, 4, 2, 1], 3))
    return new MeshClass(piece, wildsNodeMaterial(new MeshStandardMaterial()))
  }

  test("sways a merged mesh too, from its per-vertex roots (aRoot) instead of a batch's matrices", () => {
    const { vertex } = shaders(merged(true))
    expect(vertex).toContain("aRoot")
    expect(vertex).toContain("aSway")
    expect(vertex).toContain("sin(")
  })

  test("leaves a plain mesh (no batch, no roots) unbent", () => {
    const { vertex } = shaders(merged(false))
    expect(vertex).not.toContain("aSway")
  })
})
