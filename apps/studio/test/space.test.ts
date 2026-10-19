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

  /** Two walkers on one line coming at each other at 0.9 m/s, over `frames` frames (a, b: the poses). */
  const meet = (radii: Float32Array, world = flat(), frames = 400) => {
    const space = createSpace(radii, world)
    const track: { f: number; ax: number; az: number; bx: number; bz: number; late: number }[] = []
    for (let f = 0; f < frames; f++) {
      const t = f / 60
      const a: SpacePose = { ...walker(-3 + 0.9 * (t - space.delay[0]!)), to: [10, 0, 0] }
      const b: SpacePose = {
        at: [3 - 0.9 * (t - space.delay[1]!), 0, 0],
        facing: -Math.PI / 2,
        act: "walk",
        indoors: false,
        to: [-10, 0, 0],
      }
      space.step([a, b], 1 / 60)
      track.push({
        f,
        ax: space.x[0]!,
        az: space.z[0]!,
        bx: space.x[1]!,
        bz: space.z[1]!,
        late: space.delay[0]! + space.delay[1]!,
      })
    }
    return { space, track }
  }

  test("two walkers coming at each other veer early, each to its own right, and pass without touching", () => {
    const radii = Float32Array.from([0.3, 0.3])
    const { track } = meet(radii)
    // apart all the way (rounds and a margin)
    expect(Math.min(...track.map((s) => Math.hypot(s.ax - s.bx, s.az - s.bz)))).toBeGreaterThan(0.6)
    // already aside before their rounds would have met (a metre and more apart along the way)
    const early = track.find((s) => s.bx - s.ax < 1.4)!
    expect(Math.abs(early.az - early.bz)).toBeGreaterThan(0.15)
    // each to its right: walking +x its right is −z; walking −x, +z
    const mid = track.find((s) => s.bx - s.ax < 0.2)!
    expect(mid.az).toBeLessThan(0)
    expect(mid.bz).toBeGreaterThan(0)
  })

  test("in a passage too narrow for two (walls either side), one waits for the other to come through", () => {
    const radii = Float32Array.from([0.3, 0.3])
    const walls = [boxSolid("wall", 0, 0.65, 1, 0, 3, 0.4, 0), boxSolid("wall", 0, -0.65, 1, 0, 3, 0.4, 0)]
    const { space, track } = meet(radii, flat(walls), 600)
    expect(Math.max(...track.map((s) => s.late))).toBeGreaterThan(0.3)
    void space
    // and nobody was drawn inside a wall
    for (const s of track) for (const w of walls) expect(solidDistance(w, s.ax, s.az)).toBeGreaterThan(0.15)
  })

  test("a walker brushing past someone seated: the sitter only leans aside on their seat", () => {
    const radii = Float32Array.from([0.3, 0.3])
    const space = createSpace(radii, flat())
    let most = 0
    for (let f = 0; f < 300; f++) {
      const t = f / 60
      const sitter: SpacePose = {
        at: [0, 0, 0.3],
        facing: 0,
        act: "idle",
        indoors: false,
        clip: "Sit_Chair_Idle",
      }
      space.step([{ ...walker(-2 + 0.9 * t), to: [10, 0, 0] }, sitter], 1 / 60)
      most = Math.max(most, Math.hypot(space.x[1]!, space.z[1]! - 0.3))
    }
    expect(most).toBeLessThanOrEqual(0.121)
  })
})
