/**
 * The crowd's personal space (hexworld/space.ts): walkers on one way queue a gap apart instead of
 * walking inside each other, people meeting pass, nobody is pushed into a wall or off the step of the
 * flight they are on.
 */
import { describe, expect, test } from "bun:test"
import { boxSolid, type Solid, SolidGrid, solidDistance } from "@guildhall/world"
import { createSpace, type SpacePose } from "../src/hexworld/space.ts"

const flat = (solids: Solid[] = [], height = (_x: number, _z: number) => 0) => {
  const grid = new SolidGrid(solids)
  return {
    heightAt: height,
    solidsNear: (x: number, z: number, r: number) => grid.near(x, z, r),
    solidDistance,
  }
}
/** Walking along +x at `x` (facing +x: heading π/2), to a far end. */
const walker = (x: number, z = 0): SpacePose => ({
  at: [x, 0, z],
  facing: Math.PI / 2,
  act: "walk",
  indoors: false,
  to: [100, 0, z],
})

describe("the crowd's personal space", () => {
  test("three walkers on one way, one right behind the other, end up queued a gap apart", () => {
    const radii = Float32Array.from([0.49, 0.33, 0.28])
    const space = createSpace(radii, flat())
    // their ways put them 0.3 m apart; their clocks run late as they queue
    const speed = 0.9
    let t = 0
    let least = Number.POSITIVE_INFINITY
    for (let f = 0; f < 600; f++) {
      t += 1 / 60
      const poses = [0, 1, 2].map((k) => walker(speed * (t - space.delay[k]!) - k * 0.3))
      space.step(poses, 1 / 60)
      if (f > 120)
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [0, 2],
        ] as const)
          least = Math.min(
            least,
            Math.hypot(space.x[a]! - space.x[b]!, space.z[a]! - space.z[b]!) - radii[a]! - radii[b]!,
          )
    }
    expect(least).toBeGreaterThan(0)
    // the ones behind waited (follow, not overlap)
    expect(space.delay[1]! + space.delay[2]!).toBeGreaterThan(0.3)
  })

  test("two walkers meeting head on pass side by side, rounds apart", () => {
    const radii = Float32Array.from([0.33, 0.33])
    const space = createSpace(radii, flat())
    let least = Number.POSITIVE_INFINITY
    for (let f = 0; f < 400; f++) {
      const t = f / 60
      const a: SpacePose = { ...walker(-3 + t), to: [10, 0, 0] }
      const b: SpacePose = {
        at: [3 - t, 0, 0.05],
        facing: -Math.PI / 2,
        act: "walk",
        indoors: false,
        to: [-10, 0, 0],
      }
      space.step([a, b], 1 / 60)
      least = Math.min(least, Math.hypot(space.x[0]! - space.x[1]!, space.z[0]! - space.z[1]!))
    }
    expect(least).toBeGreaterThan(0.6)
  })

  test("a walker pushed aside keeps out of a wall and on its flight's step", () => {
    const radii = Float32Array.from([0.3, 0.3])
    // a wall along z = 0.45 on one side, a drop (a flight's edge) at z < -0.5 on the other
    const wall = boxSolid("wall", 0, 0.7, 1, 0, 20, 0.5, 0)
    const space = createSpace(
      radii,
      flat([wall], (_x, z) => (z < -0.5 ? -0.8 : 0)),
    )
    for (let f = 0; f < 300; f++) {
      const t = f / 60
      space.step(
        [
          // (their walks end far from the wall: a walk may cross what stands by its ends, a door)
          { ...walker(-2 + t), to: [100, 0, -3] },
          { at: [2 - t, 0, 0.1], facing: -Math.PI / 2, act: "walk", indoors: false, to: [-90, 0, -3] },
        ],
        1 / 60,
      )
      for (const k of [0, 1]) {
        expect(solidDistance(wall, space.x[k]!, space.z[k]!)).toBeGreaterThan(0.19)
        expect(space.z[k]!).toBeGreaterThan(-0.5)
      }
    }
  })
})
