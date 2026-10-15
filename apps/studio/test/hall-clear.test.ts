/** The captions and the bar are centred on the screen and step aside only by what a panel would cover (user 10-14). */
import { describe, expect, test } from "bun:test"
import { CLEAR_GAP, clearShift } from "../src/hall/hud/clear.ts"

const box = { viewW: 1440, width: 640, top: 800 }

describe("clearShift", () => {
  test("no panel moves nothing", () => {
    expect(clearShift({ ...box, panel: null })).toBe(0)
  })
  test("a panel that ends above the strip moves nothing, however far left it reaches", () => {
    expect(clearShift({ ...box, panel: { left: 300, bottom: 225 } })).toBe(0)
  })
  test("a tall panel that leaves the strip its room moves nothing", () => {
    // the strip spans 400..1040; the panel starts at 1044 + the gap
    expect(clearShift({ ...box, panel: { left: 1040 + CLEAR_GAP, bottom: 900 } })).toBe(0)
  })
  test("a tall panel over the strip's edge moves it by exactly the overlap and the gap", () => {
    expect(clearShift({ ...box, panel: { left: 1000, bottom: 900 } })).toBe(40 + CLEAR_GAP)
  })
  test("a narrower strip is covered later", () => {
    expect(clearShift({ ...box, width: 180, panel: { left: 1000, bottom: 900 } })).toBe(0)
  })
})
