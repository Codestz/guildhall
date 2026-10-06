import { describe, expect, test } from "bun:test"
import { BufferGeometry, Float32BufferAttribute, ShaderMaterial } from "three"
import { meadow } from "../src/scene/nature/Grass.tsx"
import { fall } from "../src/scene/weather/Precipitation.tsx"

describe("scene resources", () => {
  test("snow's material is built without an undefined parameter (three warns about those)", () => {
    const warn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      fall("snow", 10)
      fall("rain", 10)
    } finally {
      console.warn = warn
    }
    expect(warnings).toEqual([])
  })

  test("rebuilding the meadow frees the shared flower geometry's buffers before replacing its tints", () => {
    const geometry = () => {
      const g = new BufferGeometry()
      g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
      return g
    }
    const geometries = { tuft: geometry(), flower: geometry() }
    const material = new ShaderMaterial()
    let freed = 0
    geometries.flower.addEventListener("dispose", () => freed++)
    meadow(geometries, material, 150)
    const first = geometries.flower.getAttribute("aTint")
    expect(freed).toBe(0)
    meadow(geometries, material, 240)
    expect(geometries.flower.getAttribute("aTint")).not.toBe(first)
    // The renderer drops a geometry's GPU buffers on "dispose": without it the old tints leak.
    expect(freed).toBe(1)
  })
})
