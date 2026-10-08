import { describe, expect, test } from "bun:test"
import type { InstancedBufferGeometry } from "three"
import { TSL } from "../src/scene/tsl.ts"
import { nodeFall } from "../src/scene/weather/fallNodes.ts"
import { fall } from "../src/scene/weather/Precipitation.tsx"

describe("the falls as node materials (?tsl=1)", () => {
  test("the GLSL path stays the default", () => {
    expect(TSL).toBe(false)
  })

  test("rain drops the same streaks as the GLSL fall, one draw range of two vertices each", () => {
    const glsl = fall("rain", 50)
    const nodes = nodeFall("rain", 50)
    expect(nodes.drops).toBe(glsl.drops)
    expect(nodes.object.geometry.getAttribute("seed").array).toEqual(
      glsl.object.geometry.getAttribute("seed").array,
    )
    nodes.draw(20)
    expect(nodes.object.geometry.drawRange.count).toBe(40)
  })

  test("snow is one instanced quad per flake, seeded as the GLSL points are; density is the instance count", () => {
    const glsl = fall("snow", 50)
    const nodes = nodeFall("snow", 50)
    const geometry = nodes.object.geometry as InstancedBufferGeometry
    expect(geometry.isInstancedBufferGeometry).toBe(true)
    expect(geometry.getAttribute("seed").array).toEqual(glsl.object.geometry.getAttribute("seed").array)
    expect(geometry.instanceCount).toBe(50)
    nodes.draw(12)
    expect(geometry.instanceCount).toBe(12)
  })

  test("both paths take the same uniforms, so Precipitation drives either", () => {
    for (const kind of ["rain", "snow"] as const) {
      expect(Object.keys(nodeFall(kind, 1).uniforms).sort()).toEqual(
        Object.keys(fall(kind, 1).uniforms).sort(),
      )
    }
  })

  test("the node falls start hidden, unculled and drawn late, like the GLSL ones", () => {
    for (const kind of ["rain", "snow"] as const) {
      const { object } = nodeFall(kind, 1)
      expect([object.visible, object.frustumCulled, object.renderOrder]).toEqual([false, false, 10])
    }
  })
})
