import { describe, expect, test } from "bun:test"
import { parseAtmosphereQuery } from "../src/atmosphere/query.ts"
import { href, resolve } from "../src/shell/router.ts"

describe("atmosphere lab link", () => {
  test("lives at /lab/atmosphere", () => {
    expect(resolve("/lab/atmosphere", "").screen).toBe("atmosphere")
    expect(href("atmosphere", "hour=10", "/")).toBe("/lab/atmosphere?hour=10")
  })

  test("defaults: golden hour, hero camera, no feature overridden, no wake", () => {
    const q = parseAtmosphereQuery(new URLSearchParams(""))
    expect(q.hour).toBe(17.5)
    expect(q.cam).toBe("hero")
    expect(q.params).toEqual({})
    expect(q.wake).toBe(false)
  })

  test("reads each feature, coverage clamped, wind and camera", () => {
    const q = parseAtmosphereQuery(
      new URLSearchParams("clouds=0&shadows=1&reflections=0&coverage=3&wind=90&speed=7&cam=coast&wake=1"),
    )
    expect(q.params).toEqual({
      clouds: false,
      shadows: true,
      reflections: false,
      coverage: 1,
      windHeading: 90,
      windSpeed: 7,
    })
    expect(q.cam).toBe("coast")
    expect(q.wake).toBe(true)
  })

  test("reads the sky's air parts, and only those the link sets", () => {
    expect(parseAtmosphereQuery(new URLSearchParams("")).look).toEqual({})
    expect(parseAtmosphereQuery(new URLSearchParams("skylight=0&haze=1&grade=0")).look).toEqual({
      skyLight: false,
      haze: true,
      grade: false,
    })
  })

  test("an unknown camera falls back to the hero view", () => {
    expect(parseAtmosphereQuery(new URLSearchParams("cam=space")).cam).toBe("hero")
  })
})
