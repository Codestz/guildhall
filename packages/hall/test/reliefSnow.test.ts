import { describe, expect, test } from "bun:test"
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { WebGPURenderer, WGSLNodeBuilder } from "three/webgpu"
import { newSnowline, SNOW_EDGE, snowMaterial } from "../src/scene/terrain/snow.ts"
import { snowNodeMaterial } from "../src/scene/terrain/snowNodes.ts"
import { winterOf } from "../src/scene/terrain/useSnowline.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"

/** The snow line on both backends (scene/terrain): the GLSL patch and its node twin, one uniform. */

const landMaterial = (): MeshStandardMaterial => {
  const material = new MeshStandardMaterial()
  material.map = new DataTexture(new Uint8Array(4), 1, 1)
  return material
}

describe("the snow line's GLSL patch (WebGL)", () => {
  test("a copy of the land material takes the line as a uniform and whitens faces above it", () => {
    const base = landMaterial()
    const snowline = newSnowline()
    const copy = snowMaterial(base, snowline) as MeshStandardMaterial
    expect(copy).not.toBe(base)
    expect(copy.map).toBe(base.map)
    const shader = {
      uniforms: {},
      vertexShader: "void main() {\n#include <project_vertex>\n}",
      fragmentShader: "void main() {\n#include <map_fragment>\n}",
    } as unknown as WebGLProgramParametersWithUniforms
    copy.onBeforeCompile(shader, undefined as never)
    expect((shader.uniforms as { uSnowline: unknown }).uSnowline).toBe(snowline)
    expect(shader.vertexShader).toContain("vReliefY")
    expect(shader.fragmentShader).toContain("uSnowline")
    // It samples the kit's own white swatch, not a colour of its own.
    expect(shader.fragmentShader).toContain(SWATCH.snow.u.toFixed(3))
    expect(copy.customProgramCacheKey()).toBe(`${base.customProgramCacheKey()}|snowline`)
  })

  test("no snow until the line is set: it starts out of reach", () => {
    expect(newSnowline().value).toBeGreaterThan(1000)
    expect(SNOW_EDGE).toBeGreaterThan(0)
  })
})

describe("the snow line's node twin (WebGPU)", () => {
  function fragment(material: Material): string {
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3))
    geometry.setAttribute("normal", new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
    const canvas = { getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} }
    const renderer = new WebGPURenderer({ canvas: canvas as never })
    Object.assign(renderer.backend, {
      device: { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() },
    })
    Object.assign(renderer, { hasFeature: () => false })
    // The renderer turns a plain material into its node twin itself, copying its fields (colorNode too).
    const twin = renderer.library.fromMaterial(material) as Material
    const builder = new WGSLNodeBuilder(new Mesh(geometry, twin), renderer)
    builder.scene = new Scene()
    builder.camera = new PerspectiveCamera()
    builder.material = twin
    builder.build()
    return builder.fragmentShader
  }

  test("a clone of the land material carries the blend as its colour, with a program of its own", () => {
    const base = landMaterial()
    const copy = snowNodeMaterial(base, newSnowline()) as MeshStandardMaterial & { colorNode: unknown }
    expect(copy.colorNode).toBeTruthy()
    expect(copy.map).toBe(base.map)
    expect(copy.customProgramCacheKey()).toBe(`${base.customProgramCacheKey()}|snowline`)
  })

  test("it builds into WGSL that samples the palette twice (the land, the white) and blends", () => {
    const wgsl = fragment(snowNodeMaterial(landMaterial(), newSnowline()))
    expect(wgsl.match(/texture(Sample|Load)\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(wgsl).toContain("smoothstep")
  })
})

describe("winter", () => {
  test("is mild above 8 °C, full at -8 °C and below, and eases between", () => {
    expect(winterOf(20)).toBe(0)
    expect(winterOf(8)).toBe(0)
    expect(winterOf(0)).toBeCloseTo(0.5, 5)
    expect(winterOf(-8)).toBe(1)
    expect(winterOf(-30)).toBe(1)
  })
})
