import { describe, expect, test } from "bun:test"
import { orient, tiltQuaternion } from "../src/world/tilt.ts"

/** A placement's tilt (world/tilt.ts): the piece's up carried onto a given normal, then turned about it. */

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
