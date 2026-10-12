import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createCatalog } from "@guildhall/assets"
import { ISLAND_R, islandGround, POSE } from "../src/home/diorama.ts"
import { formatCount, RECIPE_KINDS, studioStats } from "../src/home/stats.ts"
import { GROUPS, HOME_ID, linkTo, openable, placeOf, search } from "../src/shell/directory.ts"
import { entry, index } from "./entries.ts"

const STUDIO = join(import.meta.dir, "..")

/** The ids `screens.ts` registers and its default, read from the source (importing it would load every screen). */
function registered(): { ids: string[]; fallback: string } {
  const source = readFileSync(join(STUDIO, "src/screens.ts"), "utf8")
  const list = /SCREENS: readonly Screen\[\] = \[([^\]]*)\]/.exec(source)?.[1] ?? ""
  const names = list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const ids = names.map((name) => {
    const imported = new RegExp(`import \\{ (?:\\w+ as )?${name} \\} from "\\./([^"]+)"`).exec(source)?.[1]
    if (!imported) throw new Error(`no import for ${name}`)
    const file = readFileSync(join(STUDIO, "src", imported), "utf8")
    const id = /\bid: (?:"([^"]+)"|HOME_ID)/.exec(file)
    if (!id) throw new Error(`no id in ${imported}`)
    return id[1] ?? HOME_ID
  })
  const fallback = /DEFAULT_SCREEN = "([^"]+)"/.exec(source)?.[1] ?? ""
  return { ids, fallback }
}

describe("directory", () => {
  test("every registered screen has one place in the directory, and home is the default", () => {
    const { ids, fallback } = registered()
    expect(fallback).toBe(HOME_ID)
    expect(ids).toContain(HOME_ID)
    for (const id of ids) expect(placeOf(id)).not.toBeNull()
    const listed = GROUPS.flatMap((g) => g.tools.map((t) => t.id))
    expect(new Set(listed).size).toBe(listed.length)
  })

  test("every tool that is not marked soon is a registered screen; every soon tool is not", () => {
    const { ids } = registered()
    for (const group of GROUPS) for (const tool of group.tools) expect(ids.includes(tool.id)).toBe(!tool.soon)
  })

  test("a tool with a preview has its committed image", () => {
    for (const group of GROUPS)
      for (const tool of group.tools)
        if (tool.preview) expect(existsSync(join(STUDIO, "public/home", `${tool.id}.webp`))).toBe(true)
  })

  test("openable lists home first and leaves out the tools still to come", () => {
    const ids = openable().map((p) => p.tool.id)
    expect(ids[0]).toBe(HOME_ID)
    expect(ids).toContain("npc")
    expect(ids).not.toContain("town")
  })

  test("placeOf gives the group, none for home, null for an unknown id", () => {
    expect(placeOf("grip")?.group?.name).toBe("Characters")
    expect(placeOf(HOME_ID)?.group).toBeNull()
    expect(placeOf("nope")).toBeNull()
  })

  test("search: every word must match; name matches rank above purpose matches", () => {
    expect(search("").length).toBe(openable().length)
    expect(search("grip").map((p) => p.tool.id)).toEqual(["grip", "grips"])
    expect(search("grip matrix").map((p) => p.tool.id)).toEqual(["grips"])
    // "shadow" names Shadows and is only in the purpose of nothing else ranked above it.
    expect(search("shadow")[0]?.tool.id).toBe("shadows")
    // A group name finds its tools.
    expect(search("library").map((p) => p.tool.id)).toEqual(["pieces", "palette", "scale", "lineup"])
    expect(search("zzz")).toEqual([])
  })

  test("deep links are ?screen=<id>", () => {
    expect(linkTo("pieces")).toBe("?screen=pieces")
  })
})

describe("studioStats", () => {
  const catalog = createCatalog(
    {
      ...index([
        { id: "kaykit-a", vendor: "kaykit" },
        { id: "kenney-b", vendor: "kenney" },
      ]),
      packs: [
        { id: "kaykit-a", vendor: "kaykit", count: 2, hash: "0" },
        { id: "kenney-b", vendor: "kenney", count: 1, hash: "0" },
        { id: "kaykit-anims", vendor: "kaykit", count: 0, hash: "0" },
      ],
      rigs: [
        {
          id: "rig-a",
          file: "a.glb",
          bones: 3,
          clips: [
            { name: "Idle", seconds: 1 },
            { name: "Walk", seconds: 1 },
          ],
        },
        { id: "rig-b", file: "b.glb", bones: 3, clips: [{ name: "Idle", seconds: 1 }] },
      ],
    },
    [[entry("kaykit-a/one"), entry("kaykit-a/two")], [entry("kenney-b/three")]],
  )

  test("counts pieces, packs with pieces, clips, rigs, mounts and every recipe folder", async () => {
    const asked: string[] = []
    const stats = await studioStats(catalog, { "a/sword": {}, "b/lantern": {} }, async (kind) => {
      asked.push(kind)
      return kind === "recipes/houses" ? ["cottage", "townhouse"] : kind === "recipes/stalls" ? ["fish"] : []
    })
    expect(stats).toMatchObject({ pieces: 3, packs: 2, clips: 3, rigs: 2, mounts: 2, recipes: 3 })
    expect(asked).toEqual([...RECIPE_KINDS])
  })

  test("no library, no data endpoint: zeros, not a failure", async () => {
    const stats = await studioStats(null, undefined, () => Promise.reject(new Error("404")))
    expect(stats).toEqual({ pieces: 0, packs: 0, clips: 0, rigs: 0, mounts: 0, recipes: 0, palette: null })
  })

  test("formatCount groups thousands", () => {
    expect(formatCount(2914)).toBe("2,914")
  })
})

describe("diorama layout", () => {
  test("the island is an octagon of ISLAND_R and the camera stands off it", () => {
    const ground = islandGround([])
    expect(ground.land).toHaveLength(8)
    for (const [x, z] of ground.land) expect(Math.hypot(x, z)).toBeCloseTo(ISLAND_R)
    expect(POSE.distance).toBeGreaterThan(2 * ISLAND_R)
  })
})
