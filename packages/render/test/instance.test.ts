import { describe, expect, test } from "bun:test"
import { PALETTE, rampMapToSwatchMap } from "@guildhall/assets"
import { Group, Vector3 } from "three"
import { instanceSwatchMap, placeInstance, type RecipeInstance } from "../src/batch.ts"

const at = (over: Partial<RecipeInstance> = {}): RecipeInstance => ({
  piece: "kenney-town/wall",
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
  scale: 1,
  ...over,
})

const [rampA, rampB] = [PALETTE.ramps[0]!, PALETTE.ramps[1]!]

describe("placeInstance", () => {
  test("translates, turns about +y and scales uniformly", () => {
    const node = placeInstance(new Group(), at({ x: 2, y: 0.5, z: 3, rot: Math.PI / 2, scale: 2 }))
    node.updateMatrixWorld(true)
    // +x turned a quarter about +y points to -z; scaled by 2, then moved to (2, 0.5, 3).
    const p = new Vector3(1, 0, 0).applyMatrix4(node.matrixWorld)
    expect(p.x).toBeCloseTo(2, 9)
    expect(p.y).toBeCloseTo(0.5, 9)
    expect(p.z).toBeCloseTo(1, 9)
    const up = new Vector3(0, 1, 0).applyMatrix4(node.matrixWorld)
    expect(up.y).toBeCloseTo(2.5, 9)
  })

  test("replaces a transform the piece came with", () => {
    const node = new Group()
    node.position.set(9, 9, 9)
    node.rotation.set(1, 1, 1)
    placeInstance(node, at())
    expect(node.position.toArray()).toEqual([0, 0, 0])
    expect(node.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
  })
})

describe("instanceSwatchMap", () => {
  test("is empty for an instance with no re-tint", () => {
    expect(instanceSwatchMap(at())).toEqual({})
  })

  test("expands the ramp map tone for tone", () => {
    expect(instanceSwatchMap(at({ rampMap: { [rampA.name]: rampB.name } }))).toEqual(
      rampMapToSwatchMap(PALETTE, { [rampA.name]: rampB.name }),
    )
  })

  test("a swatch map wins over the ramp map on the same swatch", () => {
    const base = rampA.tones.base
    const map = instanceSwatchMap(at({ rampMap: { [rampA.name]: rampB.name }, swatchMap: { [base]: 0 } }))
    expect(map[base]).toBe(0)
    expect(map[rampA.tones.dark]).toBe(rampB.tones.dark)
  })
})
