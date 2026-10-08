import { describe, expect, test } from "bun:test"
import { glslDome } from "../src/scene/atmosphere/SkyDome.tsx"
import { nodeDome } from "../src/scene/atmosphere/skyNodes.ts"

describe("the sky dome as a node material (WebGPU, ?tsl=1)", () => {
  test("takes the same uniforms as the GLSL dome, starting from the same values, so SkyDome drives either", () => {
    const glsl = glslDome().uniforms
    const nodes = nodeDome().uniforms
    expect(Object.keys(nodes).sort()).toEqual(Object.keys(glsl).sort())
    for (const key of Object.keys(glsl) as (keyof typeof glsl)[])
      expect([key, nodes[key].value]).toEqual([key, glsl[key].value])
  })

  test("is drawn like the GLSL dome: inside out, no depth, no fog", () => {
    const pick = ({ material: m }: ReturnType<typeof glslDome>) => [m.side, m.depthWrite, m.depthTest, m.fog]
    expect(pick(nodeDome())).toEqual(pick(glslDome()))
  })

  test("writes its own output (no lit-material output step to encode twice in a render target)", () => {
    const { material } = nodeDome()
    expect((material as { fragmentNode?: unknown }).fragmentNode).toBeTruthy()
  })
})
