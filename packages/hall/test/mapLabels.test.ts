import { describe, expect, test } from "bun:test"
import { type LabelIn, layoutLabels, shortName } from "../src/scene/archipelago/labels.ts"
import { mapFrame } from "../src/scene/archipelago/view.ts"
import { SLOW } from "./support/slow.ts"
import { reactSplit } from "./support/splitFixture.ts"

/** The map's plates: short names, and a layout in which none covers another. */

describe("short names", () => {
  test("a package loses the repo's name in front of it", () => {
    expect(shortName("react-dom", "react")).toBe("dom")
    expect(shortName("react-dom-bindings", "react")).toBe("dom-bindings")
    expect(shortName("react_compiler_validation", "react")).toBe("compiler_validation")
    expect(shortName("React-Native", "react")).toBe("Native")
  })

  test("the core keeps its name; a name that only starts like the repo's keeps it", () => {
    expect(shortName("react", "react")).toBe("react")
    expect(shortName("reactive-store", "react")).toBe("reactive-store")
    expect(shortName("babel-plugin-react-compiler", "react")).toBe("babel-plugin-react-compiler")
  })

  test("nothing to strip when the repo has no name, and a name is never emptied", () => {
    expect(shortName("shared", "")).toBe("shared")
    expect(shortName("react-", "react")).toBe("react-")
  })
})

describe("the plates' layout", () => {
  const view = { w: 800, h: 600 }
  const plate = (x: number, y: number, priority = 1, more: Partial<LabelIn> = {}): LabelIn => ({
    x,
    y,
    radius: 30,
    w: 120,
    h: 26,
    priority,
    ...more,
  })
  const rects = (items: readonly LabelIn[], placed: ReturnType<typeof layoutLabels>) =>
    placed.flatMap((at, i) =>
      at.shown
        ? [
            {
              x: (items[i] as LabelIn).x + at.dx - 60,
              y: (items[i] as LabelIn).y + at.dy - 13,
              w: 120,
              h: 26,
            },
          ]
        : [],
    )
  const clash = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  test("a plate with room sits just above its island, with no line back", () => {
    const [only] = layoutLabels([plate(400, 300)], view)
    expect(only?.shown).toBe(true)
    expect(only?.dx).toBe(0)
    expect(only?.dy).toBeLessThan(0)
    expect(only?.leader).toBe(false)
  })

  test("islands side by side get plates that do not cover one another", () => {
    const items = [plate(400, 300), plate(430, 310), plate(380, 295), plate(410, 330)]
    const placed = layoutLabels(items, view)
    const shown = rects(items, placed)
    expect(shown.length).toBe(4)
    for (const [i, a] of shown.entries()) for (const b of shown.slice(i + 1)) expect(clash(a, b)).toBe(false)
  })

  test("a plate set off from its island is joined to it by a line", () => {
    const placed = layoutLabels([plate(400, 300, 3), plate(400, 300, 2), plate(400, 300, 1)], view)
    expect(placed.every((at) => at.shown)).toBe(true)
    expect(placed.some((at) => at.leader)).toBe(true)
  })

  test("when room runs out the least important go to pips, the most important stay", () => {
    const crowd = Array.from({ length: 40 }, (_, i) => plate(400 + (i % 3) * 5, 300 + (i % 2) * 5, 100 - i))
    const placed = layoutLabels(crowd, view)
    expect(placed[0]?.shown).toBe(true)
    expect(placed[39]?.shown).toBe(false)
    expect(placed.filter((at) => at.shown).length).toBeLessThan(40)
    const shown = rects(crowd, placed)
    for (const [i, a] of shown.entries()) for (const b of shown.slice(i + 1)) expect(clash(a, b)).toBe(false)
  })

  test("the core is always shown, however crowded, and before the rest", () => {
    const crowd = [
      ...Array.from({ length: 40 }, (_, i) => plate(400, 300, 1000 + i)),
      plate(400, 300, 0, { pinned: true }),
    ]
    const placed = layoutLabels(crowd, view)
    expect(placed[40]?.shown).toBe(true)
  })

  test("a plate stays on the screen", () => {
    const [corner] = layoutLabels([plate(10, 8)], view)
    expect(corner?.shown).toBe(true)
    expect(10 + (corner?.dx ?? 0) - 60).toBeGreaterThanOrEqual(8)
    expect(8 + (corner?.dy ?? 0) - 13).toBeGreaterThanOrEqual(8)
  })

  test("a plate keeps off the rectangles it is told to avoid", () => {
    const hud = { x: 340, y: 270, w: 120, h: 60 }
    const [at] = layoutLabels([plate(400, 300)], view, [hud])
    const box = { x: 400 + (at?.dx ?? 0) - 60, y: 300 + (at?.dy ?? 0) - 13, w: 120, h: 26 }
    expect(at?.shown).toBe(true)
    expect(clash(box, hud)).toBe(false)
  })

  test("no more plates than the limit are shown, the core always; the rest are pips", () => {
    const items = [
      plate(100, 100, 1e9, { pinned: true }),
      ...Array.from({ length: 8 }, (_, i) => plate(100 + i * 90, 400, 10 - i)),
    ]
    const placed = layoutLabels(items, { ...view, max: 4 })
    expect(placed[0]?.shown).toBe(true)
    expect(placed.filter((at) => at.shown).length).toBe(4)
  })

  test("the same islands lay out the same way", () => {
    const items = [plate(100, 100, 5), plate(120, 110, 4), plate(500, 300, 3)]
    expect(layoutLabels(items, view)).toEqual(layoutLabels(items, view))
  })
})

describe("React's map, 23 islands", () => {
  const sea = reactSplit()

  /** The islands on a screen of `w` × `h` px as the map's framing shows them (a share of its height to the frame's radius). */
  async function screen(w: number, h: number): Promise<{ items: LabelIn[]; core: number }> {
    const { archipelago } = await sea
    const frame = mapFrame(archipelago)
    const scale = Math.min(w, h) / 2 / frame.radius
    const islands = [archipelago.home, ...archipelago.islands]
    return {
      core: 0,
      items: islands.map((island, i) => ({
        x: w / 2 + (island.at[0] - frame.x) * scale,
        y: h / 2 + (island.at[1] - frame.z) * scale,
        radius: island.reach * scale,
        w: 40 + shortName(island.name, archipelago.home.name).length * (w < 720 ? 8 : 9.5),
        h: w < 720 ? 22 : 26,
        priority: i === 0 ? 1e9 : (island.files ?? 0),
        ...(i === 0 ? { pinned: true } : {}),
      })),
    }
  }

  test(
    "on a desktop screen every island has a plate, and no two cover each other",
    async () => {
      const { items } = await screen(1440, 860)
      const placed = layoutLabels(items, { w: 1440, h: 860 })
      expect(placed.every((at) => at.shown)).toBe(true)
      const boxes = placed.map((at, i) => {
        const item = items[i] as LabelIn
        return { x: item.x + at.dx - item.w / 2, y: item.y + at.dy - item.h / 2, w: item.w, h: item.h }
      })
      for (const [i, a] of boxes.entries())
        for (const b of boxes.slice(i + 1))
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
    },
    60_000 * SLOW,
  )

  test(
    "on a phone the core keeps its plate, some islands keep theirs, the rest are pips",
    async () => {
      const { items } = await screen(390, 760)
      const placed = layoutLabels(items, { w: 390, h: 760 })
      expect(placed[0]?.shown).toBe(true)
      const shown = placed.filter((at) => at.shown).length
      expect(shown).toBeGreaterThan(4)
      expect(shown).toBeLessThan(items.length)
    },
    60_000 * SLOW,
  )

  test(
    "the map is drawn towards the core, which still leaves every island in the frame",
    async () => {
      const { archipelago } = await sea
      const frame = mapFrame(archipelago)
      const [cx, cz] = archipelago.home.at
      // Nearer the core than the middle of the sea is.
      const bounds = [archipelago.home, ...archipelago.islands].reduce(
        (box, { at, reach }) => ({
          minX: Math.min(box.minX, at[0] - reach),
          maxX: Math.max(box.maxX, at[0] + reach),
          minZ: Math.min(box.minZ, at[1] - reach),
          maxZ: Math.max(box.maxZ, at[1] + reach),
        }),
        {
          minX: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          minZ: Number.POSITIVE_INFINITY,
          maxZ: Number.NEGATIVE_INFINITY,
        },
      )
      const middle: [number, number] = [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2]
      expect(Math.hypot(frame.x - cx, frame.z - cz)).toBeLessThan(Math.hypot(middle[0] - cx, middle[1] - cz))
      for (const { at, reach } of [archipelago.home, ...archipelago.islands]) {
        expect(Math.abs(at[0] - frame.x) + reach).toBeLessThanOrEqual(frame.radius + 1e-6)
        expect(Math.abs(at[1] - frame.z) + reach).toBeLessThanOrEqual(frame.radius + 1e-6)
      }
    },
    60_000 * SLOW,
  )
})
