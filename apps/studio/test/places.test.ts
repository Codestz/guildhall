/** The place plates keep out of each other's way (hexworld/places.ts `layoutPlates`): biggest first, compact or hidden when crowded. */
import { describe, expect, test } from "bun:test"
import {
  kindWord,
  labelsOn,
  layoutPlates,
  MAP_TIER,
  PLATE_ZOOM,
  type PlateBox,
  plateMode,
  plateOn,
} from "../src/hexworld/places.ts"

const box: PlateBox = { full: [200, 44], sm: [120, 30] }

describe("layoutPlates", () => {
  test("a plate in the clear is drawn full size at its anchor; one off screen is not drawn", () => {
    const laid = layoutPlates([[100, 100], null, [600, 100]], [box, box, box], [0, 1, 2])
    expect(laid[0]).toEqual({ at: [100, 100], size: "full" })
    expect(laid[1]?.at).toBeNull()
    expect(laid[2]).toEqual({ at: [600, 100], size: "full" })
  })

  test("with the view's size, a plate whose heart is on screen slides in from the edge; one off screen is not drawn", () => {
    const laid = layoutPlates(
      [
        [20, 100],
        [790, 30],
        [-5, 100],
      ],
      [box, box, box],
      [0, 1, 2],
      [],
      [800, 600],
    )
    expect(laid[0]).toEqual({ at: [104, 100], size: "full" })
    expect(laid[1]).toEqual({ at: [696, 48], size: "full" })
    expect(laid[2]?.at).toBeNull()
  })

  test("a plate never lies over a kept-out rect (the crest): hidden where even compact would touch it", () => {
    const crest: [number, number, number, number] = [8, 8, 160, 60]
    const laid = layoutPlates(
      [
        [150, 70],
        [100, 40],
        [400, 70],
      ],
      [box, box, box],
      [0, 1, 2],
      [crest],
    )
    expect(laid[0]?.at).toBeNull()
    expect(laid[1]?.at).toBeNull()
    expect(laid[2]).toEqual({ at: [400, 70], size: "full" })
  })

  test("a plate over one placed before it turns compact, and hides when even that would overlap", () => {
    // the first (biggest) takes its full box; the second, 170 px right, fits only compact; the third, 40 px right, not at all
    const laid = layoutPlates(
      [
        [100, 100],
        [270, 100],
        [140, 100],
      ],
      [box, box, box],
      [0, 1, 2],
    )
    expect(laid[0]?.size).toBe("full")
    expect(laid[1]).toEqual({ at: [270, 100], size: "sm" })
    expect(laid[2]?.at).toBeNull()
  })

  test("the order decides who yields: the bigger place keeps its plate", () => {
    const anchors: [number, number][] = [
      [100, 100],
      [140, 100],
    ]
    const a = layoutPlates(anchors, [box, box], [0, 1])
    const b = layoutPlates(anchors, [box, box], [1, 0])
    expect(a[0]?.size).toBe("full")
    expect(a[1]?.at).toBeNull()
    expect(b[1]?.size).toBe("full")
    expect(b[0]?.at).toBeNull()
  })

  test("plates at different heights do not block each other", () => {
    const laid = layoutPlates(
      [
        [100, 100],
        [100, 160],
      ],
      [box, box],
      [0, 1],
    )
    expect(laid[0]?.size).toBe("full")
    expect(laid[1]?.size).toBe("full")
  })

  test("words and the switch", () => {
    expect(kindWord("harbour")).toBe("harbour")
    expect(labelsOn(new URLSearchParams(""))).toBe(true)
    expect(labelsOn(new URLSearchParams("labels=0"))).toBe(false)
  })
})

describe("plate tiers by zoom", () => {
  test("the map view shows villages and towns; close, every place", () => {
    expect(MAP_TIER).toBe(2)
    expect(plateOn(1, "map")).toBe(false)
    expect(plateOn(2, "map")).toBe(true)
    expect(plateOn(3, "map")).toBe(true)
    expect(plateOn(1, "close")).toBe(true)
  })

  test("between the two distances the mode stays what it was (no flicker on a resting zoom)", () => {
    const { in: near, out: far } = PLATE_ZOOM
    expect(near).toBeLessThan(far)
    expect(plateMode("map", near - 1)).toBe("close")
    expect(plateMode("close", far + 1)).toBe("map")
    const mid = (near + far) / 2
    expect(plateMode("map", mid)).toBe("map")
    expect(plateMode("close", mid)).toBe("close")
    // a zoom in and back out across the gap: close only once under `in`, map only once over `out`
    let mode = plateMode("map", far + 50)
    const path = [far + 10, mid, near + 1, near - 1, mid, far - 1, far + 1]
    const seen = path.map((d) => (mode = plateMode(mode, d)))
    expect(seen).toEqual(["map", "map", "map", "close", "close", "close", "map"])
  })
})
