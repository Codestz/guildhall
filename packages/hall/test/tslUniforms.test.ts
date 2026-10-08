import { describe, expect, test } from "bun:test"
import {
  Color,
  Fog,
  type Material,
  Mesh,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type WebGLRenderer,
} from "three"
import { WebGLNodesHandler } from "three/examples/jsm/tsl/WebGLNodesHandler.js"
import { uniform, uniformArray, vec3 } from "three/tsl"
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu"
import { nodesHandler } from "../src/scene/tsl.ts"

/** ANGLE on Metal: the uniform buffer binding points one WebGL context has. */
const BINDING_POINTS = 32

/** What WebGLRenderer hands the handler, built and linked: shaders, uniforms, the program. */
interface Built {
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, unknown>
  /** The uniform blocks WebGLRenderer binds for it: one binding point each, held till disposed. */
  blocks: number
}

/**
 * `material` built and "linked" by `handler` on a stand-in renderer drawing to the canvas (no GPU:
 * the program is a stub), as WebGLRenderer does it: build, then onUpdateProgram.
 */
function build(handler: WebGLNodesHandler, material: Material, scene = new Scene()): Built {
  const renderer = {
    toneMapping: NeutralToneMapping,
    outputColorSpace: SRGBColorSpace,
    extensions: { has: () => false, get: () => null },
    getContext: () => ({ getParameter: () => 16384, getExtension: () => null }),
    getRenderTarget: () => null,
    debug: { diagnostics: { keywords: false } },
  }
  handler.setRenderer(renderer as unknown as WebGLRenderer)
  const mesh = new Mesh(new PlaneGeometry(), material)
  scene.add(mesh)
  handler.renderStart(scene, new PerspectiveCamera())
  const parameters = {} as Built
  handler.build(material, mesh, parameters as never)
  const linked = handler as unknown as {
    onUpdateProgram(material: Material, program: object, properties: { uniforms: unknown }): void
  }
  linked.onUpdateProgram(material, { getUniforms: () => ({ seq: [] }) }, { uniforms: parameters.uniforms })
  handler.renderEnd()
  const groups = (material as Material & { uniformsGroups?: unknown[] }).uniformsGroups ?? []
  return { ...parameters, blocks: groups.length }
}

/** A few kinds of node material, as the hall has (lit, unlit, with a uniform of its own). */
function materials(count: number): Material[] {
  return Array.from({ length: count }, (_, i) =>
    i % 2
      ? new MeshStandardNodeMaterial({ color: new Color(i / count, 0.5, 0.5) })
      : new MeshBasicNodeMaterial({ colorNode: vec3(uniform(i / count), 0.2, 0.3) }),
  )
}

describe("node materials hold no uniform blocks on WebGL (?tsl=1)", () => {
  test("regression: the stock handler takes two binding points a material, so 16 exhaust ANGLE's 32", () => {
    const stock = materials(16).map((material) => build(new WebGLNodesHandler(), material).blocks)
    expect(stock.every((blocks) => blocks === 2)).toBe(true)
    expect(stock.reduce((a, b) => a + b)).toBeGreaterThanOrEqual(BINDING_POINTS)
  })

  test("the island's handler: any number of node materials take none", async () => {
    const handler = await nodesHandler()
    const blocks = materials(64).map((material) => build(handler, material).blocks)
    expect(blocks.reduce((a, b) => a + b)).toBe(0)
  })

  test("their groups' uniforms are plain uniforms, each one WebGLRenderer can upload", async () => {
    const built = build(await nodesHandler(), new MeshStandardNodeMaterial())
    for (const shader of [built.vertexShader, built.fragmentShader]) {
      expect(shader).not.toContain("std140")
      for (const [, name] of shader.matchAll(/^uniform (?:highp |mediump |lowp )?\w+ (\w+);$/gm))
        expect(built.uniforms[name as string]).toBeDefined()
    }
    expect(built.vertexShader).toMatch(/^uniform mat4 cameraProjectionMatrix;$/m)
  })

  test("a uniform array keeps its one buffer block", async () => {
    const flames = uniformArray([new Color(1, 0, 0), new Color(0, 1, 0)], "color")
    const material = new MeshBasicNodeMaterial({ colorNode: flames.element(1) })
    expect(build(await nodesHandler(), material).blocks).toBe(1)
  })
})

describe("canvas fog on node materials matches three's built-ins (?tsl=1)", () => {
  test("regression: the fog colour is sRGB-encoded like the output it is mixed into (it went in linear)", async () => {
    const scene = new Scene()
    scene.fog = new Fog("#9db4c8", 20, 60)
    const { fragmentShader } = build(await nodesHandler(), new MeshStandardNodeMaterial(), scene)
    const result = fragmentShader.slice(fragmentShader.indexOf("// result"))
    expect(result).toMatch(/fragColor = vec4\( mix\( \w+\.xyz, vec4\( sRGBTransferOETF\(/)
  })
})
