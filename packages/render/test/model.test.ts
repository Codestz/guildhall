import { expect, test } from "bun:test"
import {
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three"
import { group, measure } from "../src/model.ts"
import { fitShadowCamera } from "../src/shadow.ts"

const close = (actual: readonly number[], expected: readonly number[]) => {
  for (const [i, v] of actual.entries()) expect(v).toBeCloseTo(expected[i] as number, 6)
}

/** A 1 x 2 x 1 box standing on the origin, skinned to one bone. */
function skinnedBox() {
  const geometry = new BoxGeometry(1, 2, 1).translate(0, 1, 0)
  const n = geometry.getAttribute("position").count
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Array(n * 4).fill(0), 4))
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(new Array(n).fill([1, 0, 0, 0]).flat(), 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  const bone = new Bone()
  mesh.add(bone)
  mesh.bind(new Skeleton([bone]))
  return mesh
}

test("measure gives size, floor and centre of a moved group", () => {
  const box = group("one", skinnedBox())
  box.position.set(3, 0.5, -1)
  const m = measure(box)
  close(m.size, [1, 2, 1])
  expect(m.minY).toBeCloseTo(0.5, 6)
  close(m.centre, [3, 1.5, -1])
})

test("measure scales a skinned mesh once, not twice (regression: 0.65 measured as 0.65²)", () => {
  const piece = group("scaled", skinnedBox())
  piece.scale.setScalar(3)
  close(measure(piece).size, [3, 6, 3])
})

test("measure of an empty node is zero", () => {
  expect(measure(group("empty"))).toEqual({ size: [0, 0, 0], minY: 0, centre: [0, 0, 0] })
})

test("fitShadowCamera holds every corner of the box", () => {
  const box = { min: [-2, 0, -3] as [number, number, number], max: [40, 10, 3] as [number, number, number] }
  const fit = fitShadowCamera([60, 40, 20], [19, 5, 0], box)
  expect(fit.left).toBeLessThan(fit.right)
  expect(fit.bottom).toBeLessThan(fit.top)
  expect(fit.near).toBeGreaterThan(0)
  expect(fit.far).toBeGreaterThan(fit.near)
  // The box spans 42 m on x; the light's frustum must be at least as wide across some axis.
  expect(Math.max(fit.right - fit.left, fit.top - fit.bottom)).toBeGreaterThan(30)
})
