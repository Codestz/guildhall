import { describe, expect, test } from "bun:test"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { treadAt } from "../src/world/gen/relief/flights.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { LEDGE_STEP } from "../src/world/gen/relief/shape.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { repoWorld } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"

/**
 * The mountain is one terrace language, from the foot to the summit: flat tops and vertical walls,
 * stone steps where a trail climbs, a river a trench of stairs that falls ledge by ledge, and one
 * long fall where it crosses the tallest wall.
 */

const worldOf = (entries: unknown) =>
  repoWorld(islandFromTree(entries as RepoEntry[], 0, 2), {
    repo: "fixture/x",
    source: "fixture",
    gen: 2,
  } as never)
const WORLDS = { city: worldOf(REACT.entries), town: worldOf(COCKPIT.entries) }

describe("no slope on the mountain", () => {
  for (const [name, world] of Object.entries(WORLDS))
    test(`${name}: every face of every massif (its foot, trails and rivers too) is a flat top or a vertical wall`, () => {
      const relief = world.relief!
      let faces = 0
      for (const massif of relief.massifs) {
        const { position, uv } = reliefMesh(relief, massif.cells, 0)
        for (let t = 0; t < position.length / 9; t++) {
          const o = t * 9
          const [ux, uy, uz] = [
            position[o + 3]! - position[o]!,
            position[o + 4]! - position[o + 1]!,
            position[o + 5]! - position[o + 2]!,
          ]
          const [vx, vy, vz] = [
            position[o + 6]! - position[o]!,
            position[o + 7]! - position[o + 1]!,
            position[o + 8]! - position[o + 2]!,
          ]
          const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
          const length = Math.hypot(n[0]!, n[1]!, n[2]!)
          if (length < 1e-9) continue
          faces++
          const flat = Math.abs(n[1]! / length)
          expect(flat < 0.001 || flat > 0.999).toBe(true)
          // One grey stone family: never the kit's warm brown.
          expect(uv[t * 6]).not.toBe(Math.fround(SWATCH.warm.u))
        }
      }
      expect(faces).toBeGreaterThan(5000)
    })
})

describe("the steps up a trail", () => {
  const relief = WORLDS.city.relief!
  const flights = relief.massifs.flatMap((m) => m.flights)

  test("a trail has a flight where it climbs a riser, each step a flat tread under a riser no taller than a stair", () => {
    expect(flights.length).toBeGreaterThan(10)
    for (const f of flights) {
      expect(f.hi - f.lo).toBeGreaterThanOrEqual(LEDGE_STEP - 0.01)
      let before = f.lo
      // Walk up the flight: the treads rise by at most one stair a step and never fall.
      for (let s = -3; s <= 0; s += 0.05) {
        const h = treadAt(f, f.x + f.dx * s, f.z + f.dz * s)
        if (h === undefined) continue
        expect(h).toBeGreaterThanOrEqual(before - 1e-9)
        expect(h - before).toBeLessThanOrEqual(1.01)
        before = h
      }
      expect(before).toBeCloseTo(f.hi, 6)
    }
  })

  test("the ground a walker stands on is the flight's tread, higher than the ledge's plane under it", () => {
    for (const f of flights) {
      const [x, z] = [f.x - f.dx * 0.8, f.z - f.dz * 0.8]
      const tread = treadAt(f, x, z)
      expect(tread).toBeDefined()
      expect(relief.heightAt(x, z) as number).toBeGreaterThanOrEqual((tread as number) - 1e-6)
    }
  })
})

describe("the rivers over the mountain", () => {
  const { falls, rivers } = WORLDS.city.water!

  test("where one crosses the tallest wall it is one long fall: at least three ledges, its sheet standing off a hex edge", () => {
    const long = falls.filter((fall) => fall.at)
    expect(long.length).toBeGreaterThan(0)
    for (const fall of long) {
      expect((fall.topY as number) - (fall.bottomY as number)).toBeGreaterThanOrEqual(3 * LEDGE_STEP - 0.01)
      expect(fall.out).toBeDefined()
    }
  })

  test("no run of three ledge steps is left in a short stretch of a reach, and gentle stretches still step ledge by ledge", () => {
    let singles = 0
    for (const reach of rivers) {
      const grade = reach.grade ?? []
      const drops = grade.flatMap((p, k) =>
        k > 0 && grade[k - 1]![1] - p[1] >= LEDGE_STEP - 0.05 ? [k] : [],
      )
      for (const at of drops) {
        const near = drops.filter(
          (j) => Math.hypot(grade[j]![0] - grade[at]![0], grade[j]![2] - grade[at]![2]) <= 10,
        )
        // A drop within a short run of two others is a long fall's own (its drop is more than a ledge).
        if (near.length >= 3) expect(grade[at - 1]![1] - grade[at]![1]).toBeGreaterThan(LEDGE_STEP + 0.05)
        else if (grade[at - 1]![1] - grade[at]![1] < LEDGE_STEP + 0.05) singles++
      }
    }
    expect(singles).toBeGreaterThan(0)
  })
})
