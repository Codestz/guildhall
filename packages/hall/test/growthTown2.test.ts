import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { isMovingPart } from "../src/scene/life/moving.ts"
import { missingPieces, reportMissing } from "../src/scene/missing.ts"
import { decodeChronicle } from "../src/world/chronicle/format.ts"
import { planGrowth } from "../src/world/chronicle/growth.ts"
import { planBuild, siteKey } from "../src/world/chronicle/growthBuild.ts"
import { roleOf } from "../src/world/chronicle/growthPieces.ts"
import { peopleOf } from "../src/world/chronicle/growthStory.ts"
import { town2Buildings } from "../src/world/chronicle/growthTown2.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { summarize } from "../src/world/gen/repo.ts"
import type { LandPlacement } from "../src/world/lands.ts"
import { TOWN2 } from "../src/world/prefabs/town2.ts"

const HERE = import.meta.dir
const prefab = (id: string): LandPlacement[] =>
  (TOWN2.find((p) => p.id === id)?.parts ?? []).map(({ piece, x, z, y }) => ({
    piece,
    x,
    z,
    ...(y ? { y } : {}),
  }))
const only = (id: string) => {
  const found = town2Buildings(prefab(id), () => 0)
  expect(found).toHaveLength(1)
  return found[0]
}

describe("roles of the second town kit", () => {
  test("walls, roofs, chimneys and towers build; trees grow; the rest are props", () => {
    for (const piece of [
      "t2_wall_door",
      "t2_roof_gable",
      "t2_chimney",
      "t2_c_tower_square_base",
      "t2_c_wall_narrow_gate",
    ])
      expect(roleOf(piece)).toBe("build")
    expect(roleOf("t2_tree_high")).toBe("nature")
    for (const piece of [
      "t2_fountain_round",
      "t2_hedge",
      "t2_fence",
      "t2_stall",
      "t2_lantern",
      "t2_windmill",
      "t2_planks",
      "t2_c_bridge_draw",
    ])
      expect(roleOf(piece)).toBe("prop")
  })
})

describe("a second-kit building in the film", () => {
  test("each prefab is one building of the kind its pieces say", () => {
    expect(only("chapel")?.kind).toBe("hall")
    expect(only("stable")?.kind).toBe("hall")
    expect(only("warehouse")?.kind).toBe("hall")
    expect(only("bakery")?.kind).toBe("house")
    expect(only("windmill-hex")?.kind).toBe("tower")
    expect(only("bridge-draw")?.kind).toBe("gate")
  })

  test("the chapel's roof and bell tower stand above its walls, which are its ground floor", () => {
    const chapel = only("chapel")
    const level = (name: string) =>
      chapel?.parts.filter((p) => p.piece.piece === name).map((p) => p.level) ?? []
    expect(level("t2_wall_door")).toEqual([0])
    expect(Math.min(...level("t2_roof_high_gable"))).toBeGreaterThan(0)
    expect(Math.min(...level("t2_c_tower_square_top_roof_high"))).toBeGreaterThan(0)
    expect(chapel?.lead.y ?? 0).toBe(0)
  })

  test("two buildings on one hex stay two", () => {
    const moved = prefab("chapel").map((p) => ({ ...p, x: p.x + 40 }))
    expect(town2Buildings([...prefab("bakery"), ...moved], () => 0)).toHaveLength(2)
  })

  test("it is scheduled as one: walls rise together, the roof pops in after them", () => {
    const tree = (
      JSON.parse(readFileSync(join(HERE, "fixtures/repos/facebook__react.json"), "utf8")) as {
        entries: RepoEntry[]
      }
    ).entries
    const react = decodeChronicle(
      gunzipSync(readFileSync(join(HERE, "../public/chronicles/react__react.json.gz"))).toString(),
    )
    const made = islandFromTree(tree, 0, 2)
    const g = planGrowth({ chronicle: react, shape: summarize(tree), plan: made.plan })
    const decor = made.island.decor
    const build = planBuild(react, g, decor, peopleOf(react))
    const parts = decor.filter((p) => /^t2_(wall|roof)/.test(p.piece))
    expect(parts.length).toBeGreaterThan(0)
    for (const p of parts) expect(build.sites.has(siteKey(p.piece, p.x, p.z))).toBe(true)
    const wall = parts.find((p) => p.piece.startsWith("t2_wall"))
    const roof = parts.find((p) => p.piece.startsWith("t2_roof"))
    const w = build.sites.get(siteKey(wall?.piece ?? "", wall?.x ?? 0, wall?.z ?? 0))
    const r = build.sites.get(siteKey(roof?.piece ?? "", roof?.x ?? 0, roof?.z ?? 0))
    expect(w?.kind).not.toBe("prop")
    expect(r?.kind).toBe("prop")
    expect((r?.delay ?? 0) + (r?.born ?? 0)).toBeGreaterThanOrEqual((w?.born ?? 0) + (w?.delay ?? 0))
    // Far islands are gen 1: they never place the kit.
    expect(islandFromTree(tree).island.decor.some((p) => p.piece.startsWith("t2_"))).toBe(false)
  })
})

describe("the windmill's sails and unknown pieces", () => {
  test("the kit windmill's sail mesh is left to Life to turn", () => {
    expect(isMovingPart("windmill")).toBe(true)
  })

  test("pieces without a model are named once, in dev only", () => {
    const missing = missingPieces({ a: 1 }, [{ piece: "a" }, { piece: "t2_x" }, { piece: "t2_x" }])
    expect(missing).toEqual(["t2_x"])
    const said: string[] = []
    expect(reportMissing(missing, false, (t) => said.push(t))).toEqual([])
    expect(reportMissing(missing, true, (t) => said.push(t))).toEqual(["t2_x"])
    expect(reportMissing(missing, true, (t) => said.push(t))).toEqual([])
    expect(said).toHaveLength(1)
  })
})
