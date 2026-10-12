import { describe, expect, test } from "bun:test"
import { type Box, declutter } from "../src/lab/islandLab.ts"

/** The island lab's labels (lab/islandLab.ts): placed clear of each other, the first-ranked first. */

const view = { w: 800, h: 600 }
const overlap = (a: Box & { left: number; top: number }, b: Box & { left: number; top: number }) =>
  a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h

describe("island lab labels", () => {
  test("a lone label sits centred above its spot", () => {
    expect(declutter([{ x: 400, y: 300, w: 100, h: 16 }], view)).toEqual([{ left: 350, top: 300 - 16 * 1.4 }])
  })

  test("labels anchored on top of each other are stacked clear, none overlapping", () => {
    const boxes: Box[] = Array.from({ length: 5 }, (_, i) => ({
      x: 400 + i * 3,
      y: 300 + i * 2,
      w: 180,
      h: 16,
    }))
    const placed = declutter(boxes, view)
    const shown = placed.flatMap((spot, i) => (spot ? [{ ...(boxes[i] as Box), ...spot }] : []))
    expect(shown.length).toBe(5)
    for (const a of shown) for (const b of shown) if (a !== b) expect(overlap(a, b)).toBe(false)
  })

  test("the first keeps its own spot; one with no room left is dropped for the legend", () => {
    const crowded: Box[] = Array.from({ length: 30 }, () => ({ x: 400, y: 300, w: 200, h: 16 }))
    const placed = declutter(crowded, view)
    expect(placed[0]).toEqual({ left: 300, top: 300 - 16 * 1.4 })
    expect(placed.some((spot) => spot === null)).toBe(true)
  })

  test("labels stay on screen: one at the top edge goes below its spot", () => {
    expect(declutter([{ x: 400, y: 4, w: 100, h: 16 }], view)[0]).toEqual({ left: 350, top: 4 + 16 * 0.4 })
  })
})
