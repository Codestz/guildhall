import { describe, expect, test } from "bun:test"
import type { CameraPose } from "@guildhall/core"
import { cameraToPose, poseToCamera } from "../src/camera.ts"

const close = (actual: readonly number[], expected: readonly number[]) => {
  for (const [i, v] of actual.entries()) expect(v).toBeCloseTo(expected[i] as number, 9)
}

describe("poseToCamera", () => {
  test("azimuth 0, elevation 0 stands on +z of the target", () => {
    close(poseToCamera({ target: [1, 2, 3], azimuth: 0, elevation: 0, distance: 5 }), [1, 2, 8])
  })

  test("positive azimuth swings toward +x", () => {
    close(poseToCamera({ target: [0, 0, 0], azimuth: 90, elevation: 0, distance: 4 }), [4, 0, 0])
  })

  test("elevation 90 is straight above the target", () => {
    close(poseToCamera({ target: [2, 1, -2], azimuth: 35, elevation: 90, distance: 10 }), [2, 11, -2])
  })

  test("negative elevation goes below the target", () => {
    const [, y] = poseToCamera({ target: [0, 0, 0], azimuth: 0, elevation: -30, distance: 2 })
    expect(y).toBeCloseTo(-1, 9)
  })

  test("the camera stands exactly `distance` from the target", () => {
    const pose: CameraPose = { target: [3, 0.5, -7], azimuth: 35, elevation: 28, distance: 12 }
    const [x, y, z] = poseToCamera(pose)
    expect(Math.hypot(x - 3, y - 0.5, z + 7)).toBeCloseTo(12, 9)
  })
})

describe("cameraToPose", () => {
  test.each<CameraPose>([
    { target: [0, 1, 0], azimuth: 35, elevation: 28, distance: 12 },
    { target: [-4, 0, 9], azimuth: -120, elevation: 60, distance: 3.5 },
    { target: [1, 2, 3], azimuth: 180, elevation: -15, distance: 0.5 },
  ])("inverts poseToCamera (az %p)", (pose) => {
    const back = cameraToPose(poseToCamera(pose), pose.target)
    close(back.target, pose.target)
    expect(back.azimuth).toBeCloseTo(pose.azimuth, 9)
    expect(back.elevation).toBeCloseTo(pose.elevation, 9)
    expect(back.distance).toBeCloseTo(pose.distance, 9)
  })

  test("a camera on its target has elevation 0, not NaN", () => {
    const pose = cameraToPose([1, 1, 1], [1, 1, 1])
    expect(pose.distance).toBe(0)
    expect(pose.elevation).toBe(0)
  })

  test("copies the target rather than aliasing it", () => {
    const target: [number, number, number] = [0, 0, 0]
    const pose = cameraToPose([0, 0, 5], target)
    target[0] = 9
    expect(pose.target[0]).toBe(0)
  })
})
