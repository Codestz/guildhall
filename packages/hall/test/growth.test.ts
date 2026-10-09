import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { type Chronicle, dayOf, decodeChronicle } from "../src/world/chronicle/format.ts"
import {
  dayAt,
  EPILOGUE_S,
  filmLength,
  type GrowthPlan,
  PROLOGUE_S,
  planGrowth,
  RISE_S,
  timeOfDay,
} from "../src/world/chronicle/growth.ts"
import { growParam, growth } from "../src/world/chronicle/growthControl.ts"
import { growthAt, hexOf } from "../src/world/chronicle/growthFrame.ts"
import { type PieceState, pieceAt, roleOf } from "../src/world/chronicle/growthPieces.ts"
import {
  CAPTION_GAP_S,
  captionAt,
  contributorsAt,
  dateLabel,
  filesAt,
  isMajor,
  storyOf,
} from "../src/world/chronicle/growthStory.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { summarize } from "../src/world/gen/repo.ts"

const HERE = import.meta.dir
const chronicle = (file: string): Chronicle =>
  decodeChronicle(gunzipSync(readFileSync(join(HERE, "../public/chronicles", file))).toString())
const entries = (file: string): RepoEntry[] =>
  (JSON.parse(readFileSync(join(HERE, "fixtures/repos", file), "utf8")) as { entries: RepoEntry[] }).entries

const react = chronicle("react__react.json.gz")
const reactTree = entries("facebook__react.json")
const made = islandFromTree(reactTree)
const g: GrowthPlan = planGrowth({ chronicle: react, shape: summarize(reactTree), plan: made.plan })
const districtIndex = (name: string) => g.districts.findIndex((d) => d.name === name)
const upCount = (t: number, hexes: ArrayLike<number>) => {
  const frame = growthAt(g, t)
  let up = 0
  for (let i = 0; i < hexes.length; i++) if ((frame.up[hexes[i] as number] as number) >= 1) up++
  return up
}
const keepHexes = g.keys
  .map((id, h) => [id, h] as const)
  .filter(([id]) => /K|V/.test(made.plan.land.get(id)?.char ?? ""))

describe("the film's clock", () => {
  test("a young repo gets 45 s, a decade or more 75 s", () => {
    expect(filmLength({ start: 0, end: 2 })).toBe(45)
    expect(filmLength({ start: 0, end: 365 * 13 })).toBe(75)
    expect(g.duration).toBe(75)
  })

  test("days hold through the prologue and epilogue, and timeOfDay inverts dayAt", () => {
    expect(dayAt(g, 0)).toBe(react.start)
    expect(dayAt(g, PROLOGUE_S)).toBe(react.start)
    expect(dayAt(g, g.duration - EPILOGUE_S)).toBe(react.end)
    expect(dayAt(g, timeOfDay(g, dayOf("2017-10-11")))).toBeCloseTo(dayOf("2017-10-11"), 6)
  })
})

describe("the island grows", () => {
  test("the keep stands from the first frame; nothing else is up yet", () => {
    const frame = growthAt(g, 0)
    for (const [, h] of keepHexes) expect(frame.up[h]).toBe(1)
    const others = g.districts.slice(1).flatMap((d) => [...d.hexes])
    expect(others.every((h) => frame.up[h] === 0)).toBe(true)
  })

  test("the harbour is up by the end of the prologue", () => {
    const harbour = g.districts[0]?.hexes ?? new Int32Array()
    expect(upCount(PROLOGUE_S, harbour)).toBe(harbour.length)
    expect(upCount(PROLOGUE_S * 0.4, harbour)).toBeLessThan(harbour.length)
  })

  test("a district is under the sea before its folder is born and rises after", () => {
    const d = g.districts[districtIndex("packages/react-reconciler")]
    if (!d) throw new Error("react-reconciler is a district")
    const born = timeOfDay(g, dayOf("2017-10-11"))
    expect(d.born).toBeGreaterThan(born - 0.3)
    expect(d.born).toBeLessThan(born + 0.3)
    expect(upCount(born - 1, d.hexes)).toBe(0)
    expect(upCount(born + 2, d.hexes)).toBeGreaterThan(0)
  })

  test("hexes rise in rings from the district's square", () => {
    const di = districtIndex("compiler")
    const d = g.districts[di]
    const square = made.plan.districts[di]?.square
    if (!d || !square) throw new Error("compiler is a district")
    const first = d.hexes[0] as number
    const last = d.hexes[d.hexes.length - 1] as number
    const distance = (h: number) =>
      Math.hypot(...([0, 1] as const).map((k) => (g.cells[h]?.[k] ?? 0) - square[k]))
    expect(distance(first)).toBeLessThan(distance(last))
    // Its first hex is up a while before its last.
    const firstOn = g.own[first]?.[0] ?? 0
    const lastOn = g.own[last]?.[0] ?? 0
    expect(firstOn).toBeLessThanOrEqual(lastOn)
  })

  test("it ends exactly on today's island: every land hex up, no ghost land", () => {
    const frame = growthAt(g, g.duration)
    expect([...frame.up].every((up) => up === 1)).toBe(true)
    expect([...frame.ghost].every((ghost) => ghost === 0)).toBe(true)
    expect([...frame.rise].every((rise) => rise === 0)).toBe(true)
  })

  test("a hex pops up past its place, then settles", () => {
    const h = g.districts[districtIndex("packages/react-reconciler")]?.hexes[0] as number
    const on = g.own[h]?.[0] ?? 0
    expect(growthAt(g, on + RISE_S * 0.1).rise[h]).toBeLessThan(0)
    expect(growthAt(g, on + RISE_S * 0.8).rise[h]).toBeGreaterThan(0)
    expect(growthAt(g, on + RISE_S + 0.01).rise[h]).toBe(0)
  })

  test("a frame is a pure function of t: the same after any seek, and the same from a new plan", () => {
    const t = 31.7
    const once = growthAt(g, t)
    const again = planGrowth({ chronicle: react, shape: summarize(reactTree), plan: made.plan })
    growthAt(g, 60)
    expect(growthAt(g, t).up).toEqual(once.up)
    expect(growthAt(again, t).rise).toEqual(once.rise)
  })

  test("the framing widens as the island grows", () => {
    expect(growthAt(g, PROLOGUE_S).radius).toBeLessThan(growthAt(g, g.duration).radius)
  })
})

describe("ghosts", () => {
  test("react's src/ held land while it lived and sank after", () => {
    const src = g.ghosts.find((ghost) => ghost.name === "src")
    if (!src) throw new Error("src is a ghost")
    expect(src.hexes.length).toBeGreaterThan(5)
    const alive = timeOfDay(g, dayOf("2015-01-01"))
    const frame = growthAt(g, alive)
    expect([...src.hexes].filter((h) => frame.ghost[h] === 1).length).toBeGreaterThan(5)
    expect(Number.isFinite(src.died)).toBe(true)
    expect(src.died).toBeLessThan(timeOfDay(g, dayOf("2018-06-01")))
  })

  test("nothing of today's is built on a ghost's borrowed land (regression: 2013 showed 2024's houses)", () => {
    const frame = growthAt(g, timeOfDay(g, dayOf("2014-01-01")))
    const ghostly = [...frame.ghost].map((v, h) => (v === 1 ? h : -1)).filter((h) => h >= 0)
    expect(ghostly.length).toBeGreaterThan(0)
    for (const h of ghostly) expect(frame.built[h]).toBe(-1)
    const today = growthAt(g, g.duration)
    expect([...today.built].every((v) => v >= 0)).toBe(true)
  })

  test("early on, the island is mostly the old code's land", () => {
    const frame = growthAt(g, timeOfDay(g, dayOf("2014-01-01")))
    const up = [...frame.up].filter((v) => v === 1).length
    const ghost = [...frame.ghost].filter((v) => v === 1).length
    expect(ghost).toBeGreaterThan(10)
    expect(up).toBeGreaterThan(ghost)
  })
})

describe("a spot on the island maps to its hex", () => {
  test("a hex's own centre, and the sea off the quay goes to the nearest land", () => {
    const h = 17
    expect(hexOf(g, g.spots[h * 2] as number, g.spots[h * 2 + 1] as number)).toBe(h)
    const quay = hexOf(g, 0, 48)
    expect(quay).toBeGreaterThanOrEqual(0)
  })
})

describe("the story", () => {
  const story = storyOf(react, g)

  test("captions are spaced out and none is told twice at once", () => {
    for (let i = 1; i < story.captions.length; i++)
      expect((story.captions[i]?.t ?? 0) - (story.captions[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(
        CAPTION_GAP_S,
      )
    expect(story.captions[0]?.kind).toBe("first-commit")
    expect(story.captions.some((c) => c.text.includes("react-reconciler"))).toBe(true)
  })

  test("a caption is up for a while after its moment, then gone", () => {
    const first = story.captions[1]
    if (!first) throw new Error("captions")
    expect(captionAt(story, first.t + 1)).toBe(first)
    expect(captionAt(story, first.t - 0.01)).not.toBe(first)
  })

  test("only real major releases throw a festival", () => {
    expect(isMajor("v16.0.0")).toBe(true)
    expect(isMajor("v0.14.0")).toBe(false)
    expect(isMajor("v18.0.0-rc.0")).toBe(false)
    expect(isMajor("v17.0.0", true)).toBe(false)
    expect(story.festivals.length).toBeGreaterThanOrEqual(3)
    expect(story.festivals[0]).toBeCloseTo(timeOfDay(g, dayOf("2016-04-08")), 1)
  })

  test("contributors and files tick up and end on today's counts", () => {
    let last = 0
    for (let day = react.start; day <= react.end; day += 90) {
      const n = contributorsAt(story, day, react.end)
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
    expect(contributorsAt(story, react.end, react.end)).toBe(react.repo.contributors)
    expect(filesAt(react, react.end)).toBe(react.repo.files)
    expect(filesAt(react, dayOf("2014-01-01"))).toBeLessThan(filesAt(react, dayOf("2020-01-01")))
  })

  test("dates read as month and year, or the day for a short history", () => {
    expect(dateLabel(dayOf("2013-05-29"), 4000)).toBe("May 2013")
    expect(dateLabel(dayOf("2026-10-06"), 2)).toBe("Oct 6, 2026")
  })
})

describe("pieces", () => {
  const out = (): PieceState => ({ visible: false, rise: 0, scale: 1, scaleY: 1, scaffold: 0 })

  test("roles", () => {
    expect(roleOf("hex_water")).toBe("sea")
    expect(roleOf("hex_coast_A")).toBe("land")
    expect(roleOf("mountain_A_grass")).toBe("land")
    expect(roleOf("trees_A_large")).toBe("nature")
    expect(roleOf("building_market_blue")).toBe("build")
    expect(roleOf("building_dirt")).toBe("prop")
    expect(roleOf("fence_wood_straight")).toBe("prop")
  })

  test("a building: scaffold first, then it rises out of it, then the scaffold is gone", () => {
    const early = pieceAt("build", 0, 1, 0.5, 0, out())
    expect(early.scaffold).toBeGreaterThan(0)
    expect(early.visible).toBe(false)
    const rising = pieceAt("build", 0, 1, 1.35, 0, out())
    expect(rising.visible).toBe(true)
    expect(rising.scaleY).toBeLessThan(1)
    const done = pieceAt("build", 0, 1, 5, 0, out())
    expect(done.scaffold).toBe(0)
    expect(done.scaleY).toBe(1)
  })

  test("trees wait for their land, and everything rides a sinking hex down", () => {
    expect(pieceAt("nature", -0.5, 0.5, -0.2, 0, out()).visible).toBe(false)
    expect(pieceAt("nature", 0, 1, 3, 0, out()).scale).toBe(1)
    expect(pieceAt("land", -0.4, 0.6, 9, 0, out()).rise).toBe(-0.4)
    expect(pieceAt("prop", 0, 0, 9, 0, out()).visible).toBe(false)
    expect(pieceAt("sea", -1, 0, -1, 0, out())).toMatchObject({ visible: true, rise: 0 })
  })
})

describe("the transport", () => {
  test("?grow, ?grow=2017 and ?grow=t:30", () => {
    expect(growParam("?repo=a/b")).toBeUndefined()
    expect(growParam("?repo=a/b&grow")).toEqual({ start: undefined })
    expect(growParam("?grow=2017")).toEqual({ start: { year: 2017 } })
    expect(growParam("?grow=t:30")).toEqual({ start: { t: 30 } })
  })

  test("it plays, pauses, seeks, and ends on its own", () => {
    growth.request("facebook/react")
    expect(growth.phase).toBe("waiting")
    const story = storyOf(react, g)
    growth.ready({
      repo: "facebook/react",
      plan: g,
      story,
      chronicle: react,
      start: react.start,
      end: react.end,
    })
    expect(growth.phase).toBe("playing")
    growth.tick(0.05)
    expect(growth.t).toBeCloseTo(0.05, 6)
    growth.pause()
    growth.tick(0.05)
    expect(growth.t).toBeCloseTo(0.05, 6)
    growth.seek(g.duration - 0.01)
    growth.play()
    expect(growth.tick(0.05)).toBe(true)
    expect(growth.phase).toBe("off")
  })
})
