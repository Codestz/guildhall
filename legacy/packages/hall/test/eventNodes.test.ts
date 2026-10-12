import { describe, expect, test } from "bun:test"
import {
  AdditiveBlending,
  type BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
} from "three"
import { WebGPURenderer, WGSLNodeBuilder } from "three/webgpu"
import {
  cometNodeMaterial,
  confettiNodeMaterial,
  dragonFireNodeMaterial,
  dragonNodeMaterial,
  fireworkNodeMaterial,
  flutterNodeMaterial,
  ghostHullNodeMaterial,
  meteorNodeMaterial,
  rainbowNodeMaterial,
  revealNodeMaterial,
  wispNodeMaterial,
} from "../src/scene/events/eventNodes.ts"

/**
 * What WebGPU draws for the world events (scene/events/eventNodes.ts), which runs neither their
 * GLSL ShaderMaterials nor their onBeforeCompile patches: each builds into WGSL (no GPU:
 * webgpuCast.test.ts's stand-in device) reading its show's attributes, cutting out what the GLSL
 * discards, and keeping the GLSL material's draw state.
 */
function shaders(mesh: Mesh): { vertex: string; fragment: string; inputs: string[] } {
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
  const inputs = builder.attributes.map((input: { name: string }) => input.name)
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader, inputs }
}

/** A mesh with per-vertex float attributes `names` (`size` floats each). */
function baked(names: Record<string, number>, colors = false): BufferGeometry {
  const geometry = new PlaneGeometry(1, 1)
  const count = geometry.attributes.position?.count ?? 0
  for (const [name, size] of Object.entries(names))
    geometry.setAttribute(name, new Float32BufferAttribute(new Float32Array(count * size), size))
  if (colors) geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(count * 3), 3))
  return geometry
}

/** An instanced quad with per-instance attributes `names` (`size` floats each). */
function quads(names: Record<string, number>, material: Material, count = 4): InstancedMesh {
  const geometry = new PlaneGeometry(1, 1)
  for (const [name, size] of Object.entries(names))
    geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(count * size), size))
  return new InstancedMesh(geometry, material, count)
}

const time = () => ({ uTime: { value: 0 }, uFade: { value: 1 } })

describe("the events' patched standard materials, as node copies (WebGPU)", () => {
  test("flags and sails flutter; the copy keeps the source's look", () => {
    const base = new MeshStandardMaterial({ color: "#336699", roughness: 0.85 })
    const material = flutterNodeMaterial(base, time(), 0.18)
    const { vertex } = shaders(new Mesh(baked({ aFlag: 1 }), material))
    expect(vertex).toContain("aFlag")
    expect(material.color.getHexString()).toBe("336699")
    expect(material.roughness).toBe(0.85)
  })

  test("the ghost hull flutters, glows at its rim and fades, unfogged as its source", () => {
    const base = new MeshStandardMaterial({ transparent: true })
    base.fog = false
    const material = ghostHullNodeMaterial(base, time(), 0.32)
    const { vertex } = shaders(new Mesh(baked({ aFlag: 1 }), material))
    expect(vertex).toContain("aFlag")
    expect([material.emissiveNode, material.opacityNode].every(Boolean)).toBe(true)
    expect([material.fog, material.transparent]).toEqual([false, true])
  })

  test("the dragon beats its wings, sways its tail and glows, reading all three weights", () => {
    const base = new MeshStandardMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })
    const uniforms = { uTime: { value: 0 }, uFlap: { value: 0.5 }, uEmber: { value: 0.1 } }
    const material = dragonNodeMaterial(base, uniforms, { x: 0.7, y: 0.75 })
    const { vertex } = shaders(new Mesh(baked({ aWing: 1, aTail: 1, aGlow: 1 }, true), material))
    for (const name of ["aWing", "aTail", "aGlow"]) expect(vertex).toContain(name)
    expect([material.flatShading, material.vertexColors, material.side]).toEqual([true, true, DoubleSide])
  })

  test("the festival grows out of its anchors, lit cloth and unlit lanterns alike", () => {
    const uniforms = { uTime: { value: 0 }, uReveal: { value: 0.5 } }
    const attributes = { aAnchor: 3, aOrder: 1, aSway: 1 }
    const cloth = revealNodeMaterial(new MeshStandardMaterial({ vertexColors: true }), uniforms)
    const paper = revealNodeMaterial(new MeshBasicMaterial({ vertexColors: true }), uniforms)
    expect(cloth.type).toBe("MeshStandardNodeMaterial")
    expect(paper.type).toBe("MeshBasicNodeMaterial")
    for (const material of [cloth, paper]) {
      const { vertex } = shaders(new Mesh(baked(attributes, true), material))
      expect(vertex).toContain("aAnchor")
      expect(vertex).toContain("aOrder")
    }
  })
})

describe("the events' own shaders, as node materials (WebGPU)", () => {
  test("the dragon's fire places its flames and cuts out the faint ones", () => {
    const material = dragonFireNodeMaterial({ uTime: { value: 0 }, uBreath: { value: 1 } })
    const { vertex, fragment } = shaders(quads({ aSeed: 1, aSpread: 2 }, material))
    expect(vertex).toContain("aSpread")
    expect(fragment).toContain("discard")
    expect([material.blending, material.depthWrite, material.transparent]).toEqual([
      NormalBlending,
      false,
      true,
    ])
  })

  test("meteors and the comet are streaks along their flight, both faces drawn", () => {
    const streak = { aFrom: 3, aDir: 3, aBirth: 1, aLife: 1, aSize: 1, aTail: 1 }
    for (const [material, blending] of [
      [meteorNodeMaterial(time()), AdditiveBlending],
      [cometNodeMaterial(time()), NormalBlending],
    ] as const) {
      const { vertex, fragment, inputs } = shaders(quads(streak, material))
      expect(vertex).toContain("aFrom")
      // Regression: with the stock position step's normals too, a streak needed 9 vertex buffers
      // and its pipeline failed (WebGPU allows 8).
      expect(inputs).not.toContain("normal")
      expect(inputs.length).toBeLessThanOrEqual(8)
      expect(fragment).toContain("discard")
      expect([material.blending, material.side]).toEqual([blending, DoubleSide])
    }
  })

  test("the rainbow's bands are its fragment's own, on a plain arc mesh", () => {
    const uniforms = { uReveal: { value: 1 }, uFade: { value: 1 }, uNight: { value: 0 } }
    const material = rainbowNodeMaterial(uniforms, 104, 13)
    const { fragment } = shaders(new Mesh(new RingGeometry(91, 104, 16, 1, 0, Math.PI), material))
    expect(fragment).toContain("atan2")
    expect(fragment).toContain("discard")
    expect([material.side, material.depthWrite, material.fog]).toEqual([DoubleSide, false, false])
  })

  test("the ghost ship's wisps, mist banks and halo add their glow", () => {
    const material = wispNodeMaterial(time())
    const { vertex } = shaders(quads({ aSeat: 3, aSeed: 1, aBank: 1 }, material))
    expect(vertex).toContain("aBank")
    expect(material.blending).toBe(AdditiveBlending)
  })

  test("fireworks build with and without the twinkle (reduced motion)", () => {
    const attributes = { aBirth: 1, aOrigin: 3, aDir: 3, aColor: 3, aLead: 1 }
    for (const still of [false, true]) {
      const material = fireworkNodeMaterial(time(), still)
      const { vertex, fragment } = shaders(quads(attributes, material))
      expect(vertex).toContain("aLead")
      expect(fragment).toContain("discard")
    }
  })

  test("confetti is an opaque cut-out: depth written, half-faded scraps discarded", () => {
    const material = confettiNodeMaterial(time())
    const { fragment } = shaders(quads({ aBirth: 1, aOrigin: 3, aDir: 3, aColor: 3, aLead: 1 }, material))
    expect(fragment).toContain("discard")
    expect([material.transparent, material.depthWrite, material.side]).toEqual([false, true, DoubleSide])
  })
})
