import { afterEach, describe, expect, test } from "bun:test"
import {
  Color,
  DataTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  Vector4,
} from "three"
import { WebGPURenderer, WGSLNodeBuilder } from "three/webgpu"
import { blobNodeMaterial, ditheredNode, glowNodeMaterial, ringNodeMaterial } from "../src/scene/castNodes.ts"
import { dithered, setNodeDither } from "../src/scene/dissolve.ts"
import { burstNodeMaterial, type SigilUniforms, sigilNodeMaterial } from "../src/scene/sigilNodes.ts"

/**
 * What WebGPU draws instead of the GLSL it can't run: the cast's onBeforeCompile patches
 * (scene/castNodes.ts) and the sigils (scene/sigilNodes.ts).
 * Each builds into WGSL (no GPU: tslGrass.test.ts's stand-in device) that does what its GLSL does.
 */
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

function instanced(geometry: Mesh["geometry"], material: Material, count = 4): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count)
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3)
  return mesh
}

describe("the cast's patches as node materials (WebGPU)", () => {
  test("the ring widens per instance before its instance places it, and dithers with its presence", () => {
    const geometry = new RingGeometry(0.75, 1, 40)
    geometry.setAttribute("aRing", new InstancedBufferAttribute(new Float32Array(12), 3))
    const material = ringNodeMaterial(0.875)
    const { vertex, fragment } = shaders(instanced(geometry, material))
    expect(vertex).toContain("aRing")
    expect(fragment).toContain("discard")
    expect([material.transparent, material.depthWrite]).toEqual([true, false])
  })

  test("a contact shadow takes its opacity from its instance colour's red", () => {
    const material = blobNodeMaterial(new DataTexture(new Uint8Array(4), 1, 1))
    expect(material.opacityNode).not.toBeNull()
    expect(() => shaders(instanced(new PlaneGeometry(2, 2), material))).not.toThrow()
  })

  test("a deed mote dithers with its adventurer's presence", () => {
    const geometry = new SphereGeometry(0.05, 8, 8)
    geometry.setAttribute("aPresence", new InstancedBufferAttribute(new Float32Array(4).fill(1), 1))
    const { fragment } = shaders(instanced(geometry, glowNodeMaterial("#ff8800")))
    expect(fragment).toContain("discard")
  })

  test("a dithered copy keeps the original's look, adds the mask, and has a program of its own", () => {
    const original = new MeshStandardMaterial({ color: "#336699" })
    const copy = ditheredNode(original, { value: 0.5 }) as MeshStandardMaterial & { maskNode: unknown }
    expect(copy).not.toBe(original)
    expect(copy.color.getHexString()).toBe("336699")
    expect(copy.maskNode).toBeTruthy()
    expect(copy.customProgramCacheKey()).toBe(`${original.customProgramCacheKey()}|dissolve`)
  })
})

describe("dissolve.ts on either backend", () => {
  afterEach(() => setNodeDither(null))

  test("by default (WebGL) the copy is the GLSL patch", () => {
    const copy = dithered(new MeshStandardMaterial(), { value: 0.5 }) as Material & { maskNode?: unknown }
    expect(copy.maskNode).toBeUndefined()
    expect(copy.customProgramCacheKey()).toContain("|dissolve")
  })

  test("once WebGPU installs its dither, copies are masked node-side", () => {
    setNodeDither(ditheredNode)
    const copy = dithered(new MeshStandardMaterial(), { value: 0.5 }) as Material & { maskNode?: unknown }
    expect(copy.maskNode).toBeTruthy()
  })
})

describe("the sigils as node materials (WebGPU)", () => {
  const uniforms = (): SigilUniforms => ({
    uViewport: { value: new Vector2(1440, 860) },
    uSize: { value: new Vector4(1.2, 18, 30, 6) },
    uBob: { value: 2 },
    uBright: { value: 1 },
    uPace: { value: 1 },
    uTime: { value: 0 },
    uInk: { value: new Color("#15110d") },
    uInkHi: { value: new Color("#3a2c1e") },
    uPaper: { value: new Color("#f3e9d4") },
  })

  function quads(names: string[], material: Material): InstancedMesh {
    const geometry = new PlaneGeometry(2, 2)
    for (const name of names)
      geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(16), 4))
    return new InstancedMesh(geometry, material, 4)
  }

  test("the medallions place themselves on screen and read the glyph atlas", () => {
    const material = sigilNodeMaterial(uniforms(), new DataTexture(new Uint8Array(4), 1, 1), 0.8)
    const { vertex, fragment } = shaders(quads(["aAnchor", "aState", "aRim", "aFlash", "aBanner"], material))
    expect(material.vertexNode).not.toBeNull()
    expect(vertex).toContain("aAnchor")
    expect(fragment).toContain("textureSample")
    expect([material.depthTest, material.transparent]).toEqual([false, true])
  })

  test("the bursts build, a dead particle sent outside the clip box", () => {
    const material = burstNodeMaterial(uniforms())
    const geometry = new PlaneGeometry(2, 2)
    geometry.setAttribute("aOrigin", new InstancedBufferAttribute(new Float32Array(12), 3))
    for (const name of ["aMotion", "aLook", "aShape"])
      geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(16), 4))
    const { vertex } = shaders(new InstancedMesh(geometry, material, 4))
    expect(vertex).toContain("aMotion")
  })
})
