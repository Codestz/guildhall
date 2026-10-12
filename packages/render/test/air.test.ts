import { describe, expect, test } from "bun:test"
import { ShaderLib, type WebGLProgramParametersWithUniforms } from "three"
import { AIR } from "../src/atmosphere/air.ts"
import { cloudField } from "../src/atmosphere/field.ts"
import { airAt } from "../src/atmosphere/hour.ts"
import { patchCloudShade } from "../src/atmosphere/shade.ts"
import { lightAt } from "../src/light.ts"

/** The air (atmosphere part 2): the sky's light, the haze, the grade, the high clouds' shape. */

const HOURS = Array.from({ length: 24 * 12 }, (_, i) => i / 12)
const warmth = (c: { r: number; b: number }) => c.r - c.b

describe("lightAt's true directions", () => {
  test("by day the true sun is the shadow sun; by dusk it is below the horizon, the shadow sun is not", () => {
    const noon = lightAt(13)
    for (const [i, v] of noon.sunTrue.entries()) expect(v).toBeCloseTo(noon.sunDir[i] as number, 6)
    const dusk = lightAt(19.5)
    expect(Math.hypot(...dusk.sunTrue)).toBeCloseTo(1, 6)
    expect(dusk.sunTrue[1]).toBeLessThan(0)
    expect(dusk.sunDir[1]).toBeGreaterThan(0)
  })

  test("the true moon is up by night and down by day", () => {
    expect(lightAt(0).moonTrue[1]).toBeGreaterThan(0)
    expect(lightAt(12).moonTrue[1]).toBeLessThan(0)
    expect(Math.hypot(...lightAt(0).moonTrue)).toBeCloseTo(1, 6)
  })
})

describe("airAt", () => {
  test("the shade is lit blue from the sky; at golden hour the side toward the sun is warmer than the side away", () => {
    for (const hour of [10, 13, 17.5]) {
      const { sky } = airAt(lightAt(hour))
      expect(sky.top.b).toBeGreaterThan(sky.top.r)
      expect(sky.away.b).toBeGreaterThan(sky.away.r)
    }
    const golden = airAt(lightAt(17.5)).sky
    expect(warmth(golden.toward)).toBeGreaterThan(warmth(golden.away) + 0.1)
  })

  test("the haze is thicker at golden hour than at noon", () => {
    const noon = airAt(lightAt(13)).haze
    const golden = airAt(lightAt(17.5)).haze
    expect(golden.density).toBeGreaterThan(noon.density)
    expect(golden.max).toBeGreaterThan(noon.max)
  })

  test("the grade warms the highlights and cools the shadows at golden hour, near neutral at noon", () => {
    const golden = airAt(lightAt(17.5)).grade
    const noon = airAt(lightAt(13)).grade
    expect(warmth(golden.highlights)).toBeGreaterThan(0.1)
    expect(warmth(golden.shadows)).toBeLessThan(-0.05)
    expect(warmth(noon.highlights)).toBeLessThan(warmth(golden.highlights))
    expect(Math.abs(noon.saturation - 1)).toBeLessThan(0.05)
  })

  test("nothing pops as the clock runs: every value moves a little per five minutes", () => {
    let last = airAt(lightAt(0))
    for (const hour of HOURS.slice(1)) {
      const next = airAt(lightAt(hour))
      expect(Math.abs(next.haze.density - last.haze.density)).toBeLessThan(0.0002)
      expect(Math.abs(next.haze.max - last.haze.max)).toBeLessThan(0.03)
      expect(Math.abs(next.grade.contrast - last.grade.contrast)).toBeLessThan(0.01)
      expect(Math.abs(next.grade.highlights.b - last.grade.highlights.b)).toBeLessThan(0.02)
      expect(Math.abs(next.sky.intensity - last.sky.intensity)).toBeLessThan(0.05)
      last = next
    }
  })
})

describe("patchAir (chained by patchCloudShade)", () => {
  const standard = (): WebGLProgramParametersWithUniforms =>
    ({
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
      uniforms: {},
    }) as unknown as WebGLProgramParametersWithUniforms

  test("swaps the hemisphere fill for the sky's light, hazes before tone mapping and grades in place of fog", () => {
    const shader = standard()
    patchCloudShade(shader)
    const f = shader.fragmentShader
    expect(f).toContain("skyLight( inverseTransformDirection( geometryNormal, viewMatrix ) )")
    expect(f.indexOf("airHaze( gl_FragColor.rgb )")).toBeLessThan(
      f.indexOf("#include <tonemapping_fragment>"),
    )
    expect(f).toContain("gl_FragColor.rgb = airGrade( gl_FragColor.rgb );")
    expect(f).not.toContain("#include <fog_fragment>")
    expect(shader.uniforms.uSkyLight).toBe(AIR.uSkyLight)
  })
})

describe("cloud shapes", () => {
  test("clouds are low and wide, not cotton balls: much longer than tall", () => {
    const clouds = cloudField({ seed: 3, count: 40, span: 400, height: [60, 95] })
    for (const c of clouds) {
      const x0 = Math.min(...c.puffs.map((p) => p.x - p.r))
      const x1 = Math.max(...c.puffs.map((p) => p.x + p.r))
      const y0 = Math.min(...c.puffs.map((p) => p.y - p.r))
      const y1 = Math.max(...c.puffs.map((p) => p.y + p.r))
      // Before the mesh squashes each lump (clouds.ts SQUASH), which roughly doubles this again.
      expect((x1 - x0) / (y1 - y0)).toBeGreaterThan(1.6)
    }
  })
})
