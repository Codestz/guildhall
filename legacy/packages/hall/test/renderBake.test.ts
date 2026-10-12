import { describe, expect, test } from "bun:test"
import { BufferGeometry, Float32BufferAttribute, Matrix4, Uint32BufferAttribute } from "three"
import { bakeStatic } from "../src/render/bake.ts"

/** One indexed triangle in a piece's own space, with what mergeGeometries needs. */
function piece(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  g.setAttribute("normal", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  g.setIndex(new Uint32BufferAttribute([0, 1, 2], 1))
  return g
}

describe("bakeStatic (a static batch as one geometry, for WebGPU)", () => {
  test("bakes every copy where its matrix puts it, in order", () => {
    const shared = piece()
    const merged = bakeStatic([
      { geometry: shared, matrix: new Matrix4().makeTranslation(10, 0, 0) },
      { geometry: shared, matrix: new Matrix4().makeScale(2, 2, 2) },
    ])
    const position = merged?.getAttribute("position")
    expect(position?.count).toBe(6)
    expect([position?.getX(1), position?.getX(4), position?.getY(5)]).toEqual([11, 2, 2])
    // The indices of the second copy point at its own vertices.
    expect(Array.from(merged?.getIndex()?.array ?? [])).toEqual([0, 1, 2, 3, 4, 5])
  })

  test("leaves the shared source untouched", () => {
    const shared = piece()
    bakeStatic([{ geometry: shared, matrix: new Matrix4().makeTranslation(5, 5, 5) }])
    expect(shared.getAttribute("position").getX(1)).toBe(1)
  })

  test("lets each baked copy carry per-vertex attributes of its own", () => {
    const merged = bakeStatic(
      [
        { geometry: piece(), matrix: new Matrix4().makeTranslation(3, 0, 0) },
        { geometry: piece(), matrix: new Matrix4().makeTranslation(7, 0, 0) },
      ],
      (copy, at) =>
        copy.setAttribute(
          "aPlace",
          new Float32BufferAttribute(new Float32Array(3).fill(at.matrix.elements[12] ?? 0), 1),
        ),
    )
    expect(Array.from(merged?.getAttribute("aPlace")?.array ?? [])).toEqual([3, 3, 3, 7, 7, 7])
  })

  test("is null for an empty batch", () => {
    expect(bakeStatic([])).toBeNull()
  })
})
