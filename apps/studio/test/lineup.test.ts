import { describe, expect, test } from "bun:test"
import { poseToCamera } from "@guildhall/render"
import { framePose, layoutSlots, parseFocus, stackLabels } from "../src/lineup/layout.ts"
import { LINEUP } from "../src/lineup/pieces.ts"
import { SCALES } from "../src/lineup/scales.ts"

describe("layoutSlots", () => {
  test("rounds widths up to whole metres and leaves the gap between slots", () => {
    expect(layoutSlots([0.7, 2.0000001, 3.2], 2)).toEqual([
      { start: 0, width: 1, centre: 0.5 },
      { start: 3, width: 2, centre: 4 },
      { start: 7, width: 4, centre: 9 },
    ])
  })

  test("an empty piece still takes a 1 m slot", () => {
    expect(layoutSlots([0])).toEqual([{ start: 0, width: 1, centre: 0.5 }])
  })
})

describe("parseFocus", () => {
  test("one index or an inclusive range, clamped to the slot count", () => {
    expect(parseFocus("3", 10)).toEqual([3, 3])
    expect(parseFocus("2-5", 10)).toEqual([2, 5])
    expect(parseFocus("5-2", 10)).toEqual([2, 5])
    expect(parseFocus("8-40", 10)).toEqual([8, 9])
  })

  test("absent or malformed is no focus", () => {
    expect(parseFocus(null, 10)).toBeNull()
    expect(parseFocus("x", 10)).toBeNull()
    expect(parseFocus("-1", 10)).toBeNull()
    expect(parseFocus("1", 0)).toBeNull()
  })
})

describe("framePose", () => {
  const view = { aspect: 1.6, fov: 40, azimuth: 24, elevation: 12 }

  test("every corner of the span lands inside the frustum", () => {
    const span = { minX: 0, maxX: 30, height: 10, depth: 8 }
    const pose = framePose(span, view)
    const eye = poseToCamera(pose)
    // Corners in camera space must sit within the half-angles.
    const back = [eye[0] - pose.target[0], eye[1] - pose.target[1], eye[2] - pose.target[2]]
    const len = Math.hypot(...back)
    const b = back.map((v) => v / len)
    const r = [Math.cos(24 * (Math.PI / 180)), 0, -Math.sin(24 * (Math.PI / 180))]
    const u = [b[1]! * r[2]! - b[2]! * r[1]!, b[2]! * r[0]! - b[0]! * r[2]!, b[0]! * r[1]! - b[1]! * r[0]!]
    const tanV = Math.tan(20 * (Math.PI / 180))
    for (const x of [0, 30])
      for (const y of [0, 10])
        for (const z of [-4, 4]) {
          const p = [x - eye[0], y - eye[1], z - eye[2]]
          const depth = -(p[0]! * b[0]! + p[1]! * b[1]! + p[2]! * b[2]!)
          expect(depth).toBeGreaterThan(0)
          expect(Math.abs(p[0]! * u[0]! + p[1]! * u[1]! + p[2]! * u[2]!) / depth).toBeLessThanOrEqual(tanV)
          expect(Math.abs(p[0]! * r[0]! + p[2]! * r[2]!) / depth).toBeLessThanOrEqual(tanV * 1.6)
        }
  })

  test("a wider span stands the camera further back", () => {
    const near = framePose({ minX: 0, maxX: 5, height: 3, depth: 2 }, view)
    const far = framePose({ minX: 0, maxX: 50, height: 3, depth: 2 }, view)
    expect(far.distance).toBeGreaterThan(near.distance)
    expect(far.target[0]).toBe(25)
  })
})

describe("stackLabels", () => {
  test("labels apart keep their place", () => {
    const boxes = [
      { x: 0, y: 100, w: 50, h: 20 },
      { x: 100, y: 100, w: 50, h: 20 },
    ]
    expect(stackLabels(boxes)).toEqual([100, 100])
  })

  test("an overlapping label is lifted clear above the earlier one", () => {
    const ys = stackLabels([
      { x: 0, y: 100, w: 80, h: 20 },
      { x: 30, y: 105, w: 80, h: 20 },
      { x: 10, y: 100, w: 80, h: 20 },
    ])
    expect(ys[0]).toBe(100)
    expect(ys[1]).toBeLessThanOrEqual(100 - 20)
    expect(ys[2]).toBeLessThanOrEqual((ys[1] as number) - 20)
  })
})

describe("the lineup table", () => {
  test("every slot's pack has a positive scale factor", () => {
    for (const slot of LINEUP) expect(SCALES[slot.pack].factor).toBeGreaterThan(0)
  })

  test("every loaded part is a path under /raw/, never escaping it", () => {
    for (const part of LINEUP.flatMap((slot) => slot.parts ?? [])) {
      expect(part.file.startsWith("/")).toBe(false)
      expect(part.file.split("/")).not.toContain("..")
      expect(part.file).toMatch(/\.(glb|gltf)$/)
    }
  })
})
