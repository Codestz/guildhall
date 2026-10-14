import { describe, expect, test } from "bun:test"
import { SEASON_AT, seasonName } from "@guildhall/render"
import { mountSeason, storySeason, timelineSeason } from "../src/hexworld/season.ts"
import { chimneyOf, isLeafTree, mountSeasonFx, placedPoint } from "../src/hexworld/seasonFx.ts"

const query = (q: string) => new URLSearchParams(q)

function stage() {
  const hooks = new Set<(dt: number) => void>()
  return {
    onFrame: (fn: (dt: number) => void) => {
      hooks.add(fn)
      return () => hooks.delete(fn)
    },
    getCamera: () => ({ target: [0, 0, 0] as [number, number, number] }),
    tick(dt: number, n = 1) {
      for (let i = 0; i < n; i++) for (const h of [...hooks]) h(dt)
    },
  }
}

const JULY = Date.parse("2025-07-20T12:00:00Z")
const JANUARY = Date.parse("2025-01-18T12:00:00Z")

describe("what picks the season", () => {
  test("today by default; a source over it; a Settings pin over both; auto gives it back", () => {
    const s = stage()
    const m = mountSeason({ stage: s, query: query(""), now: () => JULY })
    expect(m.name()).toBe("summer")
    m.setSource(() => SEASON_AT.autumn, true)
    expect(m.name()).toBe("autumn")
    m.pin("winter")
    expect(m.pinned()).toBe("winter")
    s.tick(1 / 60, 200)
    expect(m.name()).toBe("winter")
    expect(m.weights().winter).toBe(1)
    m.pin("auto")
    expect(m.pinned()).toBe("auto")
    s.tick(1 / 60, 200)
    expect(m.name()).toBe("autumn")
    m.setSource(null)
    s.tick(1 / 60, 200)
    expect(m.name()).toBe("summer")
    m.dispose()
  })

  test("?season= pins from the link, over a source; a date works too", () => {
    const s = stage()
    const m = mountSeason({ stage: s, query: query("season=spring"), now: () => JULY })
    m.setSource(() => SEASON_AT.winter, true)
    expect(m.name()).toBe("spring")
    m.dispose()
    const d = mountSeason({ stage: s, query: query("season=2024-12-24"), now: () => JULY })
    expect(d.name()).toBe("winter")
    d.dispose()
  })

  test("a hall's timeline date drives it continuously: a playing history moves day by day", () => {
    const s = stage()
    let date = JANUARY
    const m = mountSeason({ stage: s, query: query(""), now: () => JULY })
    m.setSource(() => timelineSeason(date), true)
    expect(m.name()).toBe("winter")
    let prev = m.drive.at()
    for (let k = 0; k < 400; k++) {
      date += 2 * 86_400_000
      s.tick(1 / 60)
      const at = m.drive.at()
      const step = Math.abs(at - prev)
      expect(Math.min(step, 4 - step)).toBeLessThan(0.05)
      prev = at
    }
    m.dispose()
  })

  test("the stories' seasons: the saga in autumn, the world events in winter, the demo today's", () => {
    expect(storySeason("saga")).toBe("autumn")
    expect(storySeason("events")).toBe("winter")
    expect(storySeason("demo")).toBeNull()
    expect(storySeason(null)).toBeNull()
    expect(seasonName(timelineSeason(JULY) as number)).toBe("summer")
    expect(timelineSeason(null)).toBeNull()
  })
})

describe("the season's particles", () => {
  test("a chimney is the top of the highest stone, high on the piece; none without one", () => {
    // a wall of timber 0..3 m, a stone stack at (1, 3.4, -1)
    const position = [0, 0, 0, 0, 3, 0, 1.1, 3.4, -1, 0.9, 3.4, -1, 1, 2.6, -1]
    const swatch = [22, 22, 16, 16, 16]
    expect(chimneyOf([{ position, swatch }])).toEqual([1, 3.4, -1])
    expect(chimneyOf([{ position, swatch: [22, 22, 22, 22, 22] }])).toBeNull()
    // stone only low on the piece (a plinth): no chimney
    expect(chimneyOf([{ position: [0, 0.2, 0, 0, 4, 0], swatch: [16, 22] }])).toBeNull()
  })

  test("a local point placed: turned about +y and scaled", () => {
    const p = placedPoint({ x: 10, y: 1, z: 5, rot: Math.PI / 2, scale: 2 }, [1, 2, 0])
    expect(p[0]).toBeCloseTo(10)
    expect(p[1]).toBeCloseTo(5)
    expect(p[2]).toBeCloseTo(3)
  })

  test("leafy trees only (no conifers); nothing emitted in summer, leaves in autumn", () => {
    expect(isLeafTree("kaykit-forest/tree-1-a-color1")).toBe(true)
    expect(isLeafTree("kaykit-forest/tree-4-a-color1")).toBe(false)
    expect(isLeafTree("kaykit-forest/tree-bare-1-c-color1")).toBe(false)
    const s = stage()
    const emits: string[] = []
    let weights = { spring: 0, summer: 1, autumn: 0, winter: 0 }
    const fx = mountSeasonFx({
      stage: s,
      workfx: {
        emit: (kind) => {
          emits.push(kind)
          return 2
        },
      },
      pieces: Array.from({ length: 8 }, (_, k) => ({
        piece: "kaykit-forest/tree-1-a-color1",
        x: k * 3,
        y: 0,
        z: 0,
        rot: 0,
        scale: 1,
      })),
      weights: () => weights,
      heightOf: () => 4,
      vertices: async () => [],
    })
    s.tick(1 / 60, 120)
    expect(emits).toEqual([])
    weights = { spring: 0, summer: 0, autumn: 1, winter: 0 }
    s.tick(1 / 60, 120)
    expect(emits.length).toBeGreaterThan(2)
    expect(new Set(emits)).toEqual(new Set(["leaf"]))
    fx.dispose()
  })
})
