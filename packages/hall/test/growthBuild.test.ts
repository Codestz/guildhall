import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { decodeChronicle } from "../src/world/chronicle/format.ts"
import { PROLOGUE_S, planGrowth, RISE_S } from "../src/world/chronicle/growth.ts"
import { ageOf, planBuild, siteKey } from "../src/world/chronicle/growthBuild.ts"
import { growthAt } from "../src/world/chronicle/growthFrame.ts"
import { emptyStage, SPAN, stageAt } from "../src/world/chronicle/growthStages.ts"
import { peopleOf } from "../src/world/chronicle/growthStory.ts"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { summarize } from "../src/world/gen/repo.ts"

const HERE = import.meta.dir
const react = decodeChronicle(
  gunzipSync(readFileSync(join(HERE, "../public/chronicles/react__react.json.gz"))).toString(),
)
const tree = (
  JSON.parse(readFileSync(join(HERE, "fixtures/repos/facebook__react.json"), "utf8")) as {
    entries: RepoEntry[]
  }
).entries
const made = islandFromTree(tree, 0, 2)
const g = planGrowth({ chronicle: react, shape: summarize(tree), plan: made.plan })
const build = planBuild(react, g, made.island.decor, peopleOf(react))
const stage = emptyStage()
const siteOf = (piece: string) => made.island.decor.filter((p) => p.piece.startsWith(piece))

describe("stages", () => {
  test("a house rises from a scar to its full height, its scaffold up in between and gone at the end", () => {
    const at = (u: number) => ({ ...stageAt("house", u * SPAN.house, stage) })
    expect(at(0.05).scar).toBeGreaterThan(0.9)
    expect(at(0.05).scaleY).toBeLessThan(0.1)
    expect(at(0.5).scaffold).toBeGreaterThan(0.9)
    expect(at(0.5).scaleY).toBeGreaterThan(0.4)
    expect(at(0.5).scaleY).toBeLessThan(0.9)
    const done = at(1)
    expect(done.scaffold).toBe(0)
    expect(done.scaleY).toBe(1)
    expect(done.scar).toBe(0)
  })

  test("nothing shows before it begins, and a keep rises in thirds", () => {
    expect(stageAt("hall", -0.1, stage).visible).toBe(false)
    const third = stageAt("keep", SPAN.keep * 0.42, stage).scaleY
    expect(third).toBeGreaterThan(0.3)
    expect(third).toBeLessThan(0.4)
  })

  test("a wall is rubble before it rises", () => {
    expect(stageAt("wall", SPAN.wall * 0.1, stage).scar).toBe(1)
    expect(stageAt("wall", SPAN.wall, stage).scaleY).toBe(1)
  })
})

describe("the build schedule of react's gen 2 island", () => {
  test("every building and wall has a site, and each is done before the film ends", () => {
    const pieces = made.island.decor.filter((p) =>
      /^(building_(home|castle|market|tavern)|wall_)/.test(p.piece),
    )
    expect(pieces.length).toBeGreaterThan(50)
    for (const p of pieces) {
      const site = build.sites.get(siteKey(p.piece, p.x, p.z))
      expect(site).toBeDefined()
      if (!site) continue
      expect(site.born + RISE_S + site.delay + SPAN[site.kind]).toBeLessThan(g.duration)
    }
  })

  test("on the film's last frame everything of the island is built", () => {
    const end = growthAt(g, g.duration)
    const unfinished = made.island.decor.filter((p) => {
      const site = build.sites.get(siteKey(p.piece, p.x, p.z))
      if (!site) return false
      const h = g.index.get(key(cellAt([p.x, p.z])))
      const hexAge = h === undefined ? 99 : (end.built[h] as number)
      return hexAge >= 0 && ageOf(site, g.duration, hexAge) < SPAN[site.kind]
    })
    expect(unfinished.map((p) => p.piece)).toEqual([])
  })

  test("the castle goes up in four phases, in order, spaced and finished before the end", () => {
    expect(build.castle).toHaveLength(4)
    for (let i = 1; i < 4; i++)
      expect((build.castle[i] as number) - (build.castle[i - 1] as number)).toBeGreaterThanOrEqual(2.4)
    expect(build.castle[0]).toBeGreaterThanOrEqual(PROLOGUE_S)
    expect(build.castle[3]).toBeLessThan(g.duration - 0.5)
    const at = (piece: string) => {
      const p = made.island.decor.find(
        (q) => q.piece === piece || (piece.endsWith("castle") && q.piece.startsWith(piece)),
      )
      return p ? build.sites.get(siteKey(p.piece, p.x, p.z)) : undefined
    }
    const wall = at("wall_straight")
    const gate = at("wall_straight_gate")
    const keep = at("building_castle")
    const flag = siteOf("flag_")
      .map((p) => build.sites.get(siteKey(p.piece, p.x, p.z)))
      .find((s) => s?.kind === "flag")
    expect(wall?.born).toBe(build.castle[0])
    expect(gate?.born).toBe(build.castle[1])
    expect(keep?.born).toBe(build.castle[2])
    expect(flag?.born).toBe(build.castle[3])
  })

  test("the tape marks the castle raised, after its walls close", () => {
    const text = build.moments.map((m) => m.text)
    expect(text).toContain("The castle is raised")
    expect(text.indexOf("The castle's walls close")).toBeLessThan(text.indexOf("The castle is raised"))
    expect(build.moments.map((m) => m.t)).toEqual([...build.moments.map((m) => m.t)].sort((a, b) => a - b))
  })

  test("a denser lot fills in later: no later house of a hex begins before its first", () => {
    const byHex = new Map<string, number[]>()
    for (const p of siteOf("building_home")) {
      const site = build.sites.get(siteKey(p.piece, p.x, p.z))
      if (!site) continue
      const id = `${Math.round(p.x / 8)},${Math.round(p.z / 8)}`
      byHex.set(id, [...(byHex.get(id) ?? []), site.born + site.delay])
    }
    const later = [...byHex.values()].filter((times) => times.length > 1)
    expect(later.length).toBeGreaterThan(0)
    expect(later.some((times) => Math.max(...times) > Math.min(...times))).toBe(true)
  })

  test("a house is nothing until its land is up, then goes up over its span", () => {
    const p = siteOf("building_home")[0]
    const site = p && build.sites.get(siteKey(p.piece, p.x, p.z))
    if (!site) throw new Error("no house")
    expect(ageOf(site, 0, -1)).toBeLessThan(0)
    const done = site.born + RISE_S + site.delay + SPAN.house + 1
    expect(stageAt(site.kind, ageOf(site, done, done - site.born), stage).scaleY).toBe(1)
  })
})

describe("rivers first", () => {
  test("their hexes are up within the prologue, before any district's land", () => {
    const some = [...made.plan.land.keys()].slice(0, 6)
    const early = planGrowth({
      chronicle: react,
      shape: summarize(tree),
      plan: made.plan,
      rivers: new Set(some),
    })
    const frame = growthAt(early, PROLOGUE_S)
    const up = some.filter((id) => (frame.up[early.index.get(id) as number] as number) >= 1)
    expect(up.length).toBe(some.length)
  })
})
