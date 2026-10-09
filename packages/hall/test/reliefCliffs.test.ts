import { describe, expect, test } from "bun:test"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { BASE_REACH } from "../src/world/gen/relief/crags.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import { reliefOf } from "../src/world/gen/relief/index.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { HEX_SCALE, PIECES } from "../src/world/lands.ts"
import { orient, tiltQuaternion } from "../src/world/tilt.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** Rocks lying along the peak's cliffs (relief/crags.ts), tipped onto the face by a placement's tilt (world/tilt.ts). */

const CITY = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const RELIEF = reliefOf({ plan: CITY.plan, level: (cell) => CITY.levels.get(key(cell)) ?? 0 })
const TILTED = dressingOf(RELIEF, CITY.plan.seed).filter((p) => p.tilt)

describe("a placement's tilt", () => {
  test("carries the piece's up onto the normal it is given", () => {
    const [nx, nz] = [0.6, -0.3]
    const up = orient([0, 1, 0], 1.2, [nx, nz])
    expect(up[0]).toBeCloseTo(nx, 6)
    expect(up[1]).toBeCloseTo(Math.sqrt(1 - nx * nx - nz * nz), 6)
    expect(up[2]).toBeCloseTo(nz, 6)
  })

  test("no tilt is only the yaw about up", () => {
    expect(tiltQuaternion([0, 0])).toEqual([0, 0, 0, 1])
    const [x, y, z] = orient([1, 2, 0], Math.PI / 2, [0, 0])
    expect([x, y, z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 2, -1])
  })
})

describe("rocks on the peak's cliffs", () => {
  test("the peaks carry a good number of them, tipped onto the face and above the stairs", () => {
    expect(TILTED.length).toBeGreaterThan(40)
    expect(TILTED.length).toBeLessThan(400)
    for (const rock of TILTED) {
      const massif = RELIEF.massifAt(cellAt([rock.x, rock.z]))
      expect(RELIEF.heightAt(rock.x, rock.z) as number).toBeGreaterThan(
        massif?.ledgeTop ?? Number.POSITIVE_INFINITY,
      )
      expect(Math.hypot(...(rock.tilt as [number, number]))).toBeGreaterThan(0.1)
      expect(Math.hypot(...(rock.tilt as [number, number]))).toBeLessThan(0.85)
    }
  })

  test("none floats: every point of a base lies at or under the ground, and its crown stands out of the face", () => {
    for (const rock of TILTED) {
      const [width, tall, depth] = PIECES[rock.piece].size as [number, number, number]
      const k = HEX_SCALE * (rock.scale ?? 1)
      const origin = [rock.x, rock.y ?? 0, rock.z] as const
      for (let a = 0; a < 8; a++) {
        const spot = [
          Math.cos(a * 0.785) * BASE_REACH * width * k,
          0,
          Math.sin(a * 0.785) * BASE_REACH * depth * k,
        ] as const
        const [dx, dy, dz] = orient(spot, rock.rot ?? 0, rock.tilt as [number, number])
        const ground = RELIEF.heightAt(origin[0] + dx, origin[2] + dz)
        expect(ground).toBeDefined()
        expect((origin[1] + dy) as number).toBeLessThanOrEqual((ground as number) + 0.05)
      }
      const crown = orient([0, tall * k, 0], rock.rot ?? 0, rock.tilt as [number, number])[1]
      expect(origin[1] + crown).toBeGreaterThan((RELIEF.heightAt(rock.x, rock.z) as number) + 0.4)
    }
  })

  test("the same plan dresses the same rocks", () => {
    expect(dressingOf(RELIEF, CITY.plan.seed).filter((p) => p.tilt)).toEqual(TILTED)
  })
})
