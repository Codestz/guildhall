import { describe, expect, test } from "bun:test"
import {
  BufferGeometry,
  DepthTexture,
  DirectionalLight,
  Float32BufferAttribute,
  type Material,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderTarget,
} from "three"
import { WebGPURenderer, WGSLNodeBuilder } from "three/webgpu"
import { freshDrawn, stepCascades } from "../src/scene/atmosphere/cascadeDrive.ts"
import { cascadeKey } from "../src/scene/atmosphere/cascadeLights.ts"
import { CascadeShadowNode, Caster } from "../src/scene/atmosphere/cascadeShadowNode.ts"
import { shadows } from "../src/scene/atmosphere/shadows.ts"
import { sky } from "../src/scene/atmosphere/state.ts"
import { grassUniforms } from "../src/scene/nature/Grass.tsx"
import { grassNodeMaterial, keyShadow } from "../src/scene/nature/grassNodes.ts"

/**
 * The cascaded key light on the node paths (scene/atmosphere/cascadeShadowNode.ts, cascadeDrive.ts):
 * WebGPU's one light over a cascade shadow node, and `?tsl=1`'s node materials reading a WebGL key's
 * several maps. The GLSL half is cascades.test.ts.
 */

/** `mesh`'s fragment shader as WebGPU would compile it (tslGrass.test.ts's stand-in device). */
function fragmentOf(mesh: Mesh): string {
  const canvas = { getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} }
  const renderer = new WebGPURenderer({ canvas: canvas as never })
  renderer.shadowMap.enabled = true
  const device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() }
  Object.assign(renderer.backend, { device })
  Object.assign(renderer, { hasFeature: () => false, hasCompatibility: () => false })
  const builder = new WGSLNodeBuilder(mesh, renderer)
  builder.scene = new Scene()
  builder.camera = new PerspectiveCamera()
  builder.material = mesh.material as Material
  builder.build()
  return builder.fragmentShader
}

function grassUnder(key: DirectionalLight): string {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.setAttribute("normal", new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
  const material = grassNodeMaterial(grassUniforms(null), { flowers: false, key })
  return fragmentOf(new Mesh(geometry, material))
}

/** The shadow maps a fragment shader binds (each is a depth texture). */
const maps = (wgsl: string): number => wgsl.match(/var nodeUniform\d+ : texture_depth_2d/g)?.length ?? 0

describe("a WebGPU key's cascade shadow node", () => {
  test("is what the node materials take for the key's shadow, one map per cascade", () => {
    const light = new DirectionalLight()
    light.castShadow = true
    light.shadow.shadowNode = new CascadeShadowNode(
      light,
      [0, 1, 2].map((k) => new Caster(1024, k > 0)),
    )
    expect(keyShadow(light)).toBe(light.shadow.shadowNode as never)
    expect(maps(grassUnder(light))).toBe(3)
  })

  test("blends the cascades in the shader: one lookup of the tightest map, the rest only at an edge", () => {
    const light = new DirectionalLight()
    light.castShadow = true
    light.shadow.shadowNode = new CascadeShadowNode(
      light,
      [0, 1].map((k) => new Caster(1024, k > 0)),
    )
    const wgsl = grassUnder(light)
    // Each cascade's weight is gated, so a pixel deep in the near map never samples the far one.
    expect(wgsl.match(/if \(/g)?.length).toBeGreaterThanOrEqual(4)
  })
})

describe("a WebGL key's cascades under ?tsl=1", () => {
  function lights(count: number): DirectionalLight[] {
    return Array.from({ length: count }, () => {
      const light = new DirectionalLight()
      light.castShadow = true
      light.shadow.map = new WebGLRenderTarget(4, 4)
      light.shadow.map.depthTexture = new DepthTexture(4, 4)
      return light
    })
  }

  test("the node materials read every cascade, not only the first", () => {
    const set = lights(3)
    cascadeKey.lights = set
    try {
      expect(maps(grassUnder(set[0] as DirectionalLight))).toBe(3)
    } finally {
      cascadeKey.lights = []
    }
  })

  test("a single box reads its one map", () => {
    const [light] = lights(1) as [DirectionalLight]
    cascadeKey.lights = [light]
    try {
      expect(maps(grassUnder(light))).toBe(1)
    } finally {
      cascadeKey.lights = []
    }
  })
})

describe("the cascades' cache, on both backends", () => {
  const view = (x: number) => ({
    camera: new PerspectiveCamera(),
    at: new Vector3(x, 0, 0),
    geometries: 10,
    far: 200,
    span: { floor: -2, ceiling: 40 },
    map: 2048,
  })
  const flags = (set: Caster[]) => set.map((caster) => caster.shadow.needsUpdate)
  const settle = (set: Caster[]) => {
    for (const caster of set) caster.shadow.needsUpdate = false
  }

  test("draws all at first, then only the near one when the camera's target leaves its cell", () => {
    sky.keyDirection = [0.4, 0.8, 0.45]
    const set = [0, 1, 2].map((k) => new Caster(2048, k > 0))
    const drawn = freshDrawn()
    shadows.dirty = false
    expect(stepCascades(set, drawn, view(0))).toBe(true)
    expect(flags(set)).toEqual([true, true, true])
    settle(set)
    // Nothing changed: nothing to redraw.
    expect(stepCascades(set, drawn, view(0))).toBe(false)
    expect(flags(set)).toEqual([false, false, false])
    // A walk across the island: the far map (the whole island) is never touched, the near one is.
    expect(stepCascades(set, drawn, view(60))).toBe(true)
    expect(flags(set)[2]).toBe(false)
    expect(flags(set)[0]).toBe(true)
  })

  test("redraws all when the sun turns, or when a caster changes", () => {
    sky.keyDirection = [0.4, 0.8, 0.45]
    const set = [0, 1, 2].map((k) => new Caster(2048, k > 0))
    const drawn = freshDrawn()
    stepCascades(set, drawn, view(0))
    settle(set)
    sky.keyDirection = [0.6, 0.6, 0.5]
    stepCascades(set, drawn, view(0))
    expect(flags(set)).toEqual([true, true, true])
    settle(set)
    shadows.request()
    stepCascades(set, drawn, view(0))
    expect(flags(set)).toEqual([true, true, true])
  })

  test("keeps each map as a cache: drawn on demand, never every frame", () => {
    const [caster] = [new Caster(2048, false)]
    stepCascades([caster as Caster], freshDrawn(), view(0))
    expect(caster?.shadow.autoUpdate).toBe(false)
  })
})
