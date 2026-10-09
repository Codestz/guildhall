import { describe, expect, test } from "bun:test"
import {
  type BatchedMesh,
  BoxGeometry,
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
} from "three"
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { coarser, loadSimplifier } from "../src/render/simplify.ts"
import { FAR, FAR_BELOW, NEAR, NEAR_ABOVE, pixelsPerUnit, tierAt } from "../src/render/tiers.ts"
import { tieredBatch, tieredMerge } from "../src/scene/tiers.ts"

/** Detail tiers: when a region goes far (render/tiers.ts), its coarse copies (render/simplify.ts), the swap (scene/tiers.ts). */

describe("when a region goes far", () => {
  test("it goes far below FAR_BELOW and comes back only above NEAR_ABOVE", () => {
    expect(tierAt(NEAR, FAR_BELOW * 1.01)).toBe(NEAR)
    expect(tierAt(NEAR, FAR_BELOW * 0.99)).toBe(FAR)
    // Inside the gap a region keeps whichever tier it has: a zoom resting there doesn't flicker.
    const between = (FAR_BELOW + NEAR_ABOVE) / 2
    expect(tierAt(NEAR, between)).toBe(NEAR)
    expect(tierAt(FAR, between)).toBe(FAR)
    expect(tierAt(FAR, NEAR_ABOVE * 1.01)).toBe(NEAR)
  })

  test("pixels per unit: the zoom on an orthographic camera, wherever the region is", () => {
    const camera = new OrthographicCamera(-720, 720, 430, -430)
    camera.zoom = 3
    expect(pixelsPerUnit(camera, 860, 0, 0, 0, 10)).toBeCloseTo(3)
    expect(pixelsPerUnit(camera, 860, 400, 0, -300, 10)).toBeCloseTo(3)
  })

  test("pixels per unit: by distance to the region's nearest point on a perspective camera", () => {
    const camera = new PerspectiveCamera(60, 1.5)
    camera.position.set(0, 0, 100)
    const near = pixelsPerUnit(camera, 860, 0, 0, 0, 10)
    const far = pixelsPerUnit(camera, 860, 0, 0, -200, 10)
    expect(near).toBeCloseTo(860 / (2 * Math.tan(Math.PI / 6) * 90))
    expect(far).toBeLessThan(near / 2)
  })
})

describe("a piece's coarse copy", () => {
  test("draws fewer triangles of the same vertices' attributes, compacted", async () => {
    const simplifier = await loadSimplifier()
    // A finely cut box: flat faces a coarse copy can take nearly everything off.
    const box = mergeVertices(new BoxGeometry(1, 1, 1, 8, 8, 8).deleteAttribute("normal"))
    const copy = coarser(simplifier, box, 0.01)
    expect(copy).not.toBeNull()
    const index = copy?.index?.count ?? 0
    expect(index).toBeLessThan((box.index?.count ?? 0) * 0.25)
    expect(copy?.getAttribute("position").count).toBeLessThan(box.getAttribute("position").count)
    expect(Object.keys(copy?.attributes ?? {}).sort()).toEqual(Object.keys(box.attributes).sort())
    // Every index points at a vertex the copy has.
    const array = copy?.index?.array ?? []
    expect(Math.max(...array)).toBeLessThan(copy?.getAttribute("position").count ?? 0)
  })

  test("is not made when it would save too little", async () => {
    const simplifier = await loadSimplifier()
    expect(coarser(simplifier, new PlaneGeometry(1, 1), 0.01)).toBeNull()
  })
})

describe("a tiered batch", () => {
  const near = new BoxGeometry(1, 1, 1, 4, 4, 4)
  const far = new BoxGeometry(1, 1, 1)
  const instances = [0, 1, 1, 0, 2].map((chunk, i) => ({
    piece: { near, far: i === 4 ? null : far },
    matrix: new Matrix4().makeTranslation(i * 3, 0, 0),
    chunk,
  }))

  test("WebGL: a region's swap points only its own instances at the coarse copy, and back", () => {
    const { meshes, swap } = tieredBatch(new MeshBasicMaterial(), instances, 3)
    const mesh = meshes[0] as BatchedMesh
    const ids = (geometryOf: (id: number) => number) => instances.map((_, id) => geometryOf(id))
    const before = ids((id) => mesh.getGeometryIdAt(id))
    swap(1, FAR)
    const after = ids((id) => mesh.getGeometryIdAt(id))
    expect(after[0]).toBe(before[0] as number)
    expect(after[1]).not.toBe(before[1] as number)
    expect(after[2]).not.toBe(before[2] as number)
    expect(after[3]).toBe(before[3] as number)
    swap(1, NEAR)
    expect(ids((id) => mesh.getGeometryIdAt(id))).toEqual(before)
    // A region whose pieces have no coarse copy has nothing to swap.
    swap(2, FAR)
    expect(mesh.getGeometryIdAt(4)).toBe(before[4] as number)
  })

  test("WebGPU: a merged mesh per region, its coarse twin shown only when far", () => {
    const { meshes, swap } = tieredMerge(new MeshBasicMaterial(), instances, 3)
    // Regions 0 and 1 have coarse copies (two meshes each); region 2 has none (one).
    expect(meshes.length).toBe(5)
    const shown = () => meshes.filter((mesh) => mesh.visible).length
    // All shown until the tier pass settles them: their first frame uploads every one.
    expect(shown()).toBe(5)
    swap(0, NEAR)
    swap(1, NEAR)
    expect(shown()).toBe(3)
    swap(0, FAR)
    expect(shown()).toBe(3)
    const triangles = meshes.filter((mesh) => mesh.visible).map((mesh) => mesh.geometry.index?.count ?? 0)
    swap(0, NEAR)
    const full = meshes.filter((mesh) => mesh.visible).map((mesh) => mesh.geometry.index?.count ?? 0)
    expect(triangles.reduce((a, b) => a + b)).toBeLessThan(full.reduce((a, b) => a + b))
  })
})
