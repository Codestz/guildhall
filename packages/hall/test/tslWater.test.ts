import { describe, expect, test } from "bun:test"
import {
  CustomToneMapping,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  NoToneMapping,
  SRGBColorSpace,
  type ToneMapping,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { vec4 } from "three/tsl"
import type { Node } from "three/webgpu"
import { waterUniforms } from "../src/scene/nature/Water.tsx"
import { waterNodeMaterial } from "../src/scene/nature/waterNodes.ts"
import { nodesHandler, outputOf } from "../src/scene/tsl.ts"

const renderer = { toneMapping: NeutralToneMapping as ToneMapping, outputColorSpace: SRGBColorSpace }

describe("the node materials' output step follows the target (?tsl=1)", () => {
  test("on the canvas: the renderer's tone mapping and colour space", () => {
    expect(outputOf(renderer, null, true)).toEqual({
      toneMapping: NeutralToneMapping,
      colorSpace: SRGBColorSpace,
    })
  })

  test("into a render target (the composer's buffer): no tone mapping, linear", () => {
    expect(outputOf(renderer, new WebGLRenderTarget(4, 4), true)).toEqual({
      toneMapping: NoToneMapping,
      colorSpace: LinearSRGBColorSpace,
    })
  })

  test("a material that isn't tone-mapped isn't, even on the canvas", () => {
    expect(outputOf(renderer, null, false).toneMapping).toBe(NoToneMapping)
  })

  /** The handler on a stand-in renderer drawing into `target`, and its output step. */
  async function outputStep(toneMapping: ToneMapping, target: WebGLRenderTarget | null) {
    const handler = await nodesHandler()
    const gl = {
      ...renderer,
      toneMapping,
      extensions: {},
      getContext: () => ({}),
      getRenderTarget: () => target,
    }
    handler.setRenderer(gl as unknown as WebGLRenderer)
    const step = (
      handler as unknown as { getOutputCallback: (node: Node<"vec4">, builder: object) => Node<"vec4"> }
    ).getOutputCallback
    return (node: Node<"vec4">) => step(node, { material: { toneMapped: true } })
  }

  test("regression: into a target the colour leaves untouched (it was tone-mapped and sRGB-encoded twice)", async () => {
    const colour = vec4(0.5, 0.5, 0.5, 1)
    expect((await outputStep(NeutralToneMapping, new WebGLRenderTarget(4, 4)))(colour)).toBe(colour)
  })

  test("on the canvas the colour is mapped and encoded, Low's custom grade included", async () => {
    const colour = vec4(0.5, 0.5, 0.5, 1)
    expect((await outputStep(NeutralToneMapping, null))(colour)).not.toBe(colour)
    expect((await outputStep(CustomToneMapping, null))(colour)).not.toBe(colour)
  })
})

describe("the water as a node material (?tsl=1)", () => {
  test("builds for every tier and look, fogged, with or without the key light's shadow", () => {
    for (const low of [false, true])
      for (const v2 of [false, true]) {
        const material = waterNodeMaterial(waterUniforms(), { low, v2, flames: 8, key: null })
        expect([material.fog, material.colorNode !== null]).toEqual([true, true])
      }
  })
})
