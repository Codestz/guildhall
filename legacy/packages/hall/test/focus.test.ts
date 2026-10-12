import { describe, expect, test } from "bun:test"
import { tabStops, wrapOf } from "../src/hud/focus.ts"

/** The Legends book's focus trap (hud/focus.ts), over stand-ins for its elements. */

class El {
  constructor(
    readonly name: string,
    readonly tabIndex: number,
    readonly disabled = false,
  ) {}
  hasAttribute(attribute: string): boolean {
    return attribute === "disabled" && this.disabled
  }
}

/** The book open with three parties, the middle one's tab selected (a roving tablist). */
function book(copyDisabled = false) {
  return [
    new El("title", -1),
    new El("copy", 0, copyDisabled),
    new El("close", 0),
    new El("tab I", -1),
    new El("tab II", 0),
    new El("tab III", -1),
    new El("panel", 0),
  ]
}

describe("legends: focus stays inside the book", () => {
  test("the stops are what Tab really reaches: no unselected tabs, no title, the panel last", () => {
    expect(tabStops(book()).map((el) => el.name)).toEqual(["copy", "close", "tab II", "panel"])
  })

  test("Tab from the panel (the real last stop) wraps to the first, not out of the dialog", () => {
    const els = book()
    const stops = tabStops(els)
    const at = (name: string) => els.find((el) => el.name === name)
    expect(wrapOf(stops, at("panel"), false)?.name).toBe("copy")
    // In between, the browser moves on by itself.
    for (const name of ["copy", "close", "tab II"]) expect(wrapOf(stops, at(name), false)).toBeUndefined()
  })

  test("Shift+Tab from the first stop, or from the title focused on open, wraps to the panel", () => {
    const els = book()
    const stops = tabStops(els)
    const title = els[0]
    expect(wrapOf(stops, els[1], true, title)?.name).toBe("panel")
    expect(wrapOf(stops, title, true, title)?.name).toBe("panel")
    expect(wrapOf(stops, els[6], true, title)).toBeUndefined()
  })

  test("a disabled Copy (no legend yet) is not a stop: Close is first", () => {
    const stops = tabStops(book(true))
    expect(stops[0]?.name).toBe("close")
    expect(wrapOf(stops, stops.at(-1), false)?.name).toBe("close")
  })

  test("nothing focusable: Tab is left alone", () => {
    expect(wrapOf([], undefined, false)).toBeUndefined()
  })
})
