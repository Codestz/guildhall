import { describe, expect, test } from "bun:test"
import { lightAt } from "@guildhall/render"
import { sideLit } from "../src/hexworld/index.ts"

/** The hex island's opening camera sees the sun from the side, so its shadows read (V1's look). */

describe("sideLit", () => {
  test("the camera looks 75° off the sun's heading, whatever the hour", () => {
    for (const hour of [8, 12, 15.5, 17.5, 18.4]) {
      const sun = lightAt(hour).sunDir
      const az = (sideLit(sun) * Math.PI) / 180
      // The rig looks along (-sin az, -cos az).
      const look = [-Math.sin(az), -Math.cos(az)]
      const heading = Math.hypot(sun[0], sun[2])
      const cos = (look[0]! * sun[0] + look[1]! * sun[2]) / heading
      expect((Math.acos(cos) * 180) / Math.PI).toBeCloseTo(75, 0)
    }
  })

  test("the old fixed azimuth (30°) at 15:30 had the sun straight behind the camera", () => {
    const sun = lightAt(15.5).sunDir
    const az = (30 * Math.PI) / 180
    const cos = (-Math.sin(az) * sun[0] - Math.cos(az) * sun[2]) / Math.hypot(sun[0], sun[2])
    expect(cos).toBeLessThan(-0.95)
  })
})
