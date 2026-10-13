/** The hall's FX follow the session clock (hall/fx.ts): the ships sail at its rate. */
import { describe, expect, test } from "bun:test"
import { FX_READ_MS, fleetRate } from "../src/hall/fx.ts"

describe("fleetRate", () => {
  test("live sails at 1; a playing replay at its rate; a paused one holds the ships", () => {
    expect(fleetRate({ mode: "live", playing: true, rate: 4 })).toBe(1)
    expect(fleetRate({ mode: "live", playing: false, rate: 1 })).toBe(1)
    for (const rate of [1, 2, 4, 8]) expect(fleetRate({ mode: "replay", playing: true, rate })).toBe(rate)
    expect(fleetRate({ mode: "replay", playing: false, rate: 4 })).toBe(0)
  })

  test("the FX still read the session twice a second", () => {
    expect(FX_READ_MS).toBe(500)
  })
})
