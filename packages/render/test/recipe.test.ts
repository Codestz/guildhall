import { describe, expect, test } from "bun:test"
import { PALETTE, type Recipe, type RecipeInstance, rampMapToSwatchMap } from "@guildhall/assets"
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Uint8BufferAttribute,
  Vector3,
} from "three"
import { instanceSwatchMap, placeInstance, recipeObject } from "../src/recipe.ts"
import { recolour } from "../src/tint.ts"

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

/** One shared geometry per id, as `loadPiece` copies share theirs. */
function fakePieces() {
  const geometries = new Map<string, BufferGeometry>()
  const calls: string[] = []
  const load = async (id: string): Promise<Object3D> => {
    calls.push(id)
    if (id === "missing") throw new Error(`no piece "${id}"`)
    let g = geometries.get(id)
    if (!g) {
      g = new BufferGeometry()
      g.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3))
      g.setAttribute("color", new Float32BufferAttribute([1, 1, 1], 3))
      g.setAttribute("_swatch", new Uint8BufferAttribute(Uint8Array.of(rampA.tones.base), 1))
      g.setAttribute("_shade", new Uint8BufferAttribute(Uint8Array.of(128), 1, true))
      geometries.set(id, g)
    }
    const root = new Group()
    root.add(new Mesh(g, new MeshBasicMaterial()))
    return root
  }
  return { load, calls, geometries }
}

const recipe = (instances: RecipeInstance[]): Recipe => ({
  id: "houses/demo",
  seed: 1,
  instances,
  sockets: [],
})

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

describe("recipeObject", () => {
  test("one child per instance in recipe order, named and indexed, each placed", async () => {
    const { load, calls } = fakePieces()
    const instances = [at({ x: 3 }), at({ piece: "kenney-town/roof", z: -2, rot: Math.PI, scale: 0.5 })]
    const root = await recipeObject(recipe(instances), load)
    expect(root.name).toBe("houses/demo")
    expect(calls).toEqual(["kenney-town/wall", "kenney-town/roof"])
    expect(root.children.map((c) => c.name)).toEqual(["kenney-town/wall", "kenney-town/roof"])
    expect(root.children.map((c) => c.userData.instance)).toEqual([0, 1])
    const roof = root.children[1]!
    expect(roof.position.toArray()).toEqual([0, 0, -2])
    expect(roof.rotation.y).toBeCloseTo(Math.PI, 9)
    expect(roof.scale.toArray()).toEqual([0.5, 0.5, 0.5])
  })

  test("re-tints instances with a ramp map through the shared variant cache", async () => {
    const { load, geometries } = fakePieces()
    const rampMap = { [rampA.name]: rampB.name }
    const root = await recipeObject(recipe([at(), at({ rampMap }), at({ rampMap, x: 1 })]), load)
    const geometryOf = (i: number) => (root.children[i]!.children[0] as Mesh).geometry
    const source = geometries.get("kenney-town/wall")!
    expect(geometryOf(0)).toBe(source)
    expect(geometryOf(1)).toBe(recolour(source, rampMapToSwatchMap(PALETTE, rampMap)))
    expect(geometryOf(2)).toBe(geometryOf(1))
  })

  test("an empty recipe is an empty group", async () => {
    const root = await recipeObject(recipe([]), fakePieces().load)
    expect(root.children).toHaveLength(0)
  })

  test("a piece that fails to load rejects the recipe", async () => {
    await expect(recipeObject(recipe([at(), at({ piece: "missing" })]), fakePieces().load)).rejects.toThrow(
      'no piece "missing"',
    )
  })
})
