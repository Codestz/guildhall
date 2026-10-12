import { describe, expect, test } from "bun:test"
import { BufferAttribute, BufferGeometry, Color, SRGBColorSpace } from "three"
import { vertexMeshData } from "../src/vmeshData.ts"

/** A worker prepares the ground's arrays: they must be what three would have made of them here. */
describe("vertexMeshData", () => {
  const position = new Float32Array([0, 0, 0, 0, 0.3, 1, 1, 0.1, 0, 2, 2, 2, 3, 2, 2, 2, 3, 2.5])
  const srgb = new Float32Array([
    0.02, 0.5, 1, 0.3, 0.04, 0.9, 0, 0.7, 0.2, 1, 1, 1, 0.5, 0.5, 0.5, 0.1, 0.2, 0.3,
  ])
  const data = vertexMeshData(position, srgb)

  test("flat normals as computeVertexNormals gives a non-indexed mesh", () => {
    const g = new BufferGeometry()
    g.setAttribute("position", new BufferAttribute(position, 3))
    g.computeVertexNormals()
    const normal = g.getAttribute("normal").array
    expect(data.normal.length).toBe(normal.length)
    for (let i = 0; i < normal.length; i++) expect(data.normal[i]!).toBeCloseTo(normal[i] as number, 5)
  })

  test("linear colours as Color.setRGB from sRGB gives", () => {
    const c = new Color()
    for (let i = 0; i < srgb.length; i += 3) {
      c.setRGB(srgb[i]!, srgb[i + 1]!, srgb[i + 2]!, SRGBColorSpace)
      expect(data.color[i]!).toBeCloseTo(c.r, 5)
      expect(data.color[i + 1]!).toBeCloseTo(c.g, 5)
      expect(data.color[i + 2]!).toBeCloseTo(c.b, 5)
    }
  })
})
