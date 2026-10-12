import { describe, expect, test } from "bun:test"
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from "three"
import { countTris, rowSlots } from "../src/viewer.ts"

describe("rowSlots", () => {
  test("lays slots left to right from the origin, whole metres, one metre apart", () => {
    expect(rowSlots([2.4, 0.5, 3])).toEqual([
      { start: 0, width: 3, centre: 1.5 },
      { start: 4, width: 1, centre: 4.5 },
      { start: 6, width: 3, centre: 7.5 },
    ])
  })

  test("float noise over a whole metre does not cost an extra cell", () => {
    expect(rowSlots([2.0000001])[0]?.width).toBe(2)
  })

  test("a zero-width piece still takes one cell", () => {
    expect(rowSlots([0])[0]?.width).toBe(1)
  })

  test("no pieces, no slots", () => {
    expect(rowSlots([])).toEqual([])
  })
})

describe("countTris", () => {
  test("sums indexed and unindexed meshes under a root", () => {
    const root = new Group()
    // A box is 12 indexed triangles.
    root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    const soup = new BufferGeometry()
    soup.setAttribute("position", new Float32BufferAttribute(new Array(9 * 2).fill(0), 3))
    const child = new Group()
    child.add(new Mesh(soup, new MeshBasicMaterial()))
    root.add(child)
    expect(countTris(root)).toBe(14)
  })

  test("is 0 for nothing", () => {
    expect(countTris(new Group())).toBe(0)
  })
})
