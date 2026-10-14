/**
 * The region tint (regionTint.ts) and its field (regionField.ts): the chunk lands in a lit program at
 * its three anchors and shares one set of uniforms, the ground alone turns its green, and with no
 * field it is off; the field's bytes are the four channels' weights, blurred a texel round.
 */
import { describe, expect, test } from "bun:test"
import { ShaderLib, type WebGLProgramParametersWithUniforms } from "three"
import { patchCloudShade } from "../src/atmosphere/shade.ts"
import { regionBytes } from "../src/regionField.ts"
import { patchRegionTint, REGION_TINT, setRegionField } from "../src/regionTint.ts"

const standard = (): WebGLProgramParametersWithUniforms =>
  ({
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {},
  }) as unknown as WebGLProgramParametersWithUniforms

describe("patchRegionTint", () => {
  test("reads the field after the colour, snows with the normal and lays the mist before the output", () => {
    const shader = standard()
    patchCloudShade(shader)
    patchRegionTint(shader)
    const f = shader.fragmentShader
    expect(f).toContain("vec4 regionW = regionAt( vCloudWorld );")
    expect(f.indexOf("vec4 regionW")).toBeGreaterThan(f.indexOf("#include <color_fragment>"))
    expect(f.indexOf("uRegionSnowY )")).toBeGreaterThan(f.indexOf("#include <normal_fragment_maps>"))
    expect(f.indexOf("rMist")).toBeLessThan(f.indexOf("#include <opaque_fragment>"))
    expect(f).not.toContain("#define REGION_GROUND")
    expect(shader.uniforms.uRegionMap).toBe(REGION_TINT.uRegionMap)
  })

  test("only the ground turns its green, only the water darkens", () => {
    const ground = standard()
    patchCloudShade(ground)
    patchRegionTint(ground, "ground")
    expect(ground.fragmentShader).toContain("#define REGION_GROUND")
    const water = standard()
    patchCloudShade(water)
    patchRegionTint(water, "water")
    expect(water.fragmentShader).toContain("#define REGION_WATER")
  })

  test("leaves a program without the world position as it was", () => {
    const shader = standard()
    const before = shader.fragmentShader
    patchRegionTint(shader)
    expect(shader.fragmentShader).toBe(before)
  })

  test("is off without a field, on with one, and off again once cleared", () => {
    expect(REGION_TINT.uRegionOn.value).toBe(0)
    setRegionField({
      min: [-10, -10],
      size: 20,
      res: 2,
      data: new Uint8Array(16),
      snowY: 6,
      mistY: null,
      cell: 1,
    })
    expect(REGION_TINT.uRegionOn.value).toBe(1)
    expect(REGION_TINT.uRegionSnowY.value).toBe(6)
    expect(REGION_TINT.uRegionWindow.value.toArray()).toEqual([-10, -10, 0.05, 0.05])
    setRegionField(null)
    expect(REGION_TINT.uRegionOn.value).toBe(0)
    expect(REGION_TINT.uRegionSnowY.value).toBeGreaterThan(1000)
  })
})

describe("regionBytes", () => {
  test("holds each channel's weight, its rim softened a texel round", () => {
    // the left half highlands, the right half marsh
    const data = regionBytes({
      min: [0, 0],
      size: 8,
      res: 8,
      weightAt: (x) => (x < 4 ? [1, 0, 0, 0] : [0, 0, 1, 0]),
    })
    const at = (col: number, row: number, c: number) => data[(row * 8 + col) * 4 + c]!
    expect(at(0, 4, 0)).toBe(255)
    expect(at(7, 4, 2)).toBe(255)
    expect(at(3, 4, 0)).toBe(170)
    expect(at(4, 4, 2)).toBe(170)
    expect(at(3, 4, 1)).toBe(0)
  })
})
