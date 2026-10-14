import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createCatalog } from "@guildhall/assets"
import { POSE, TILES, tileAt } from "../src/home/diorama.ts"
import { formatCount, studioStats, TILE_KINDS } from "../src/home/stats.ts"
import { GROUPS, HOME_ID, linkTo, openable, placeOf, search } from "../src/shell/directory.ts"
import { SITE_SCREENS } from "../src/site/routes.ts"
import { entry, index } from "./entries.ts"

const STUDIO = join(import.meta.dir, "..")

/** The ids `screens.ts` registers and its default, read from the source (importing it would load every screen). */
function registered(): { ids: string[]; fallback: string } {
  const source = readFileSync(join(STUDIO, "src/screens.ts"), "utf8")
  // `lazy("<id>", …)`: the studio's tools (and the site's four, which the directory does not list)
  const ids = [...source.matchAll(/^\s+lazy\("([a-z]+)"/gm)].map((m) => m[1] as string)
  const fallback = /DEFAULT_SCREEN = "([^"]+)"/.exec(source)?.[1] ?? ""
  return { ids, fallback }
}

describe("directory", () => {
  test("every registered screen has one place in the directory, and home is the default", () => {
    const { ids, fallback } = registered()
    expect(fallback).toBe("island")
    expect(ids).toContain(HOME_ID)
    for (const id of ids.filter((i) => !SITE_SCREENS.includes(i))) expect(placeOf(id)).not.toBeNull()
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
    expect(ids).toContain("town")
    expect(openable().every((p) => !p.tool.soon)).toBe(true)
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
    // "town" names Town; the pieces and the NPC builder only mention it in their purpose.
    expect(search("town").map((p) => p.tool.id)).toEqual(["town", "pieces", "npc"])
    // A group name finds its tools.
    expect(search("library").map((p) => p.tool.id)).toEqual(["pieces", "palette"])
    expect(search("zzz")).toEqual([])
  })

  test("deep links are paths", () => {
    expect(linkTo("pieces")).toBe("/pieces")
    expect(linkTo(HOME_ID)).toBe("/studio")
    expect(linkTo("grip")).toBe("/grips/editor")
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

  test("counts pieces, packs with pieces, clips, rigs, mounts and the tile prefabs", async () => {
    const asked: string[] = []
    const stats = await studioStats(catalog, { "a/sword": {}, "b/lantern": {} }, async (kind) => {
      asked.push(kind)
      return kind === "tiles" ? ["cottage", "townhouse", "market"] : []
    })
    expect(stats).toMatchObject({ pieces: 3, packs: 2, clips: 3, rigs: 2, mounts: 2, tiles: 3 })
    expect(asked).toEqual([...TILE_KINDS])
  })

  test("no library, no data endpoint: zeros, not a failure", async () => {
    const stats = await studioStats(null, undefined, () => Promise.reject(new Error("404")))
    expect(stats).toEqual({
      pieces: 0,
      packs: 0,
      clips: 0,
      rigs: 0,
      mounts: 0,
      tiles: 0,
      spots: 0,
      palette: null,
    })
  })

  test("formatCount groups thousands", () => {
    expect(formatCount(2914)).toBe("2,914")
  })
})

describe("hex vignette layout", () => {
  test("its tiles are distinct cells of one cluster round the canteen, and the camera stands off it", () => {
    const cells = new Set(TILES.map((t) => `${t.q},${t.r}`))
    expect(cells.size).toBe(TILES.length)
    expect(TILES[0]).toMatchObject({ q: 0, r: 0, prefab: "tavern-garden" })
    // every tile touches another (no island apart): a neighbour is one tile width away
    const width = Math.hypot(...tileAt({ q: 1, r: 0 }))
    for (const t of TILES) {
      const [x, z] = tileAt(t)
      const near = TILES.some(
        (o) => o !== t && Math.abs(Math.hypot(x - tileAt(o)[0], z - tileAt(o)[1]) - width) < 1e-6,
      )
      expect(near).toBe(true)
    }
    const reach = Math.max(...TILES.map((t) => Math.hypot(...tileAt(t))))
    expect(POSE.distance).toBeGreaterThan(reach * 2)
  })
})

describe("home links", () => {
  test("the hero opens the island at its first seed and the tile composer", async () => {
    const { ISLAND_LINK } = await import("../src/home/Home.tsx")
    expect(ISLAND_LINK).toBe("/town/1")
    expect(linkTo("composer")).toBe("/composer")
  })
})
