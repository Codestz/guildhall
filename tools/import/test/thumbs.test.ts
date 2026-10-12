import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CatalogEntry } from "@guildhall/assets"
import { readShard, shardFile, writeShard } from "../src/catalog.ts"
import {
  batches,
  loadManifest,
  manifestFile,
  parseThumbArgs,
  type RenderBatch,
  runThumbs,
  type ThumbJob,
  thumbFile,
} from "../src/thumbs.ts"
import { tempDir } from "./fixtures/env.ts"

const entry = (pack: string, slug: string, hash = `h-${slug}`): CatalogEntry => ({
  id: `${pack}/${slug}`,
  pack,
  source: `${slug}.glb`,
  name: slug,
  kind: "static",
  category: "prop",
  tags: [],
  size: [1, 1, 1],
  footprint: { w: 1, d: 1 },
  tris: 12,
  verts: 8,
  bytes: 100,
  swatches: [1],
  scale: { factor: 1, rule: "factor", confidence: "pack", flags: [] },
  flags: [],
  compose: { front: "+z", streetEdge: null, attach: "ground", anchors: [], source: "rule" },
  files: { glb: `pieces/${pack}/${slug}.glb`, thumb: null },
  hash,
})

/** A library with one shard per pack, written unsorted to show the output is sorted anyway. */
function library(packs: Record<string, CatalogEntry[]>): string {
  const dir = tempDir()
  for (const [pack, entries] of Object.entries(packs)) writeShard(dir, pack, [...entries].reverse())
  return dir
}

/** A renderer that records every batch it was handed and draws each piece as its own id's bytes. */
function fakeRender(fail: string[] = []): { render: RenderBatch; calls: ThumbJob[][] } {
  const calls: ThumbJob[][] = []
  return {
    calls,
    render: async (jobs) => {
      calls.push(jobs)
      return jobs.map(({ id }) =>
        fail.includes(id) ? { id, error: "load failed" } : { id, webpBase64: btoa(`webp:${id}`) },
      )
    },
  }
}

const rendered = (calls: ThumbJob[][]): string[] => calls.flat().map((j) => j.id)

describe("runThumbs", () => {
  test("draws every piece once, writes the webp and points files.thumb at it", async () => {
    const lib = library({ town: [entry("town", "crate"), entry("town", "wall")] })
    const { render, calls } = fakeRender()

    const [summary] = await runThumbs({ library: lib, names: [], force: false, render })

    expect(summary).toMatchObject({ pack: "town", rendered: 2, skipped: 0, failed: [] })
    expect(rendered(calls)).toEqual(["town/crate", "town/wall"])
    expect(calls[0]?.[0]?.url).toBe("/library/pieces/town/crate.glb")
    expect(readFileSync(join(lib, thumbFile("town", "crate")), "utf8")).toBe("webp:town/crate")
    expect(readShard(lib, "town").map((e) => e.files.thumb)).toEqual([
      "thumbs/town/crate.webp",
      "thumbs/town/wall.webp",
    ])
  })

  test("a second run draws nothing and rewrites the shard and manifest byte for byte", async () => {
    const lib = library({ town: [entry("town", "wall"), entry("town", "crate")] })
    await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })
    const shard = readFileSync(shardFile(lib, "town"), "utf8")
    const manifest = readFileSync(manifestFile(lib, "town"), "utf8")
    const { render, calls } = fakeRender()

    const [summary] = await runThumbs({ library: lib, names: [], force: false, render })

    expect(calls).toEqual([])
    expect(summary).toMatchObject({ rendered: 0, skipped: 2 })
    expect(readFileSync(shardFile(lib, "town"), "utf8")).toBe(shard)
    expect(readFileSync(manifestFile(lib, "town"), "utf8")).toBe(manifest)
  })

  test("redraws only the piece whose GLB hash changed", async () => {
    const lib = library({ town: [entry("town", "crate"), entry("town", "wall")] })
    await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })
    writeShard(lib, "town", [entry("town", "crate", "new-hash"), entry("town", "wall")])
    const { render, calls } = fakeRender()

    await runThumbs({ library: lib, names: [], force: false, render })

    expect(rendered(calls)).toEqual(["town/crate"])
    expect(loadManifest(lib, "town")).toEqual({ crate: "new-hash", wall: "h-wall" })
  })

  test("redraws a piece whose thumbnail file is gone even if the hash matches", async () => {
    const lib = library({ town: [entry("town", "crate"), entry("town", "wall")] })
    await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })
    rmSync(join(lib, thumbFile("town", "wall")))
    const { render, calls } = fakeRender()

    await runThumbs({ library: lib, names: [], force: false, render })

    expect(rendered(calls)).toEqual(["town/wall"])
  })

  test("--force redraws everything", async () => {
    const lib = library({ town: [entry("town", "crate"), entry("town", "wall")] })
    await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })
    const { render, calls } = fakeRender()

    await runThumbs({ library: lib, names: [], force: true, render })

    expect(rendered(calls)).toEqual(["town/crate", "town/wall"])
  })

  test("sends pieces in batches of the given size, the last one shorter", async () => {
    const slugs = Array.from({ length: 7 }, (_, i) => `p${i}`)
    const lib = library({ town: slugs.map((s) => entry("town", s)) })
    const { render, calls } = fakeRender()

    await runThumbs({ library: lib, names: [], force: false, render, batch: 3 })

    expect(calls.map((c) => c.length)).toEqual([3, 3, 1])
  })

  test("a failed piece is reported, keeps thumb null and is retried next run", async () => {
    const lib = library({ town: [entry("town", "crate"), entry("town", "wall")] })
    const first = fakeRender(["town/wall"])

    const [summary] = await runThumbs({ library: lib, names: [], force: false, render: first.render })

    expect(summary?.failed).toEqual(["town/wall: load failed"])
    expect(readShard(lib, "town").find((e) => e.id === "town/wall")?.files.thumb).toBeNull()
    expect(loadManifest(lib, "town")).toEqual({ crate: "h-crate" })
    const second = fakeRender()
    await runThumbs({ library: lib, names: [], force: false, render: second.render })
    expect(rendered(second.calls)).toEqual(["town/wall"])
  })

  test("a piece that left the catalog loses its thumbnail and manifest line", async () => {
    const lib = library({ town: [entry("town", "crate"), entry("town", "wall")] })
    await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })
    writeShard(lib, "town", [entry("town", "crate")])

    const [summary] = await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })

    expect(summary?.removed).toBe(1)
    expect(existsSync(join(lib, thumbFile("town", "wall")))).toBe(false)
    expect(loadManifest(lib, "town")).toEqual({ crate: "h-crate" })
  })

  test("named packs only; an unknown name throws; the index lists the updated shards", async () => {
    const lib = library({ town: [entry("town", "crate")], wood: [entry("wood", "tree")] })
    const { render, calls } = fakeRender()

    await runThumbs({ library: lib, names: ["wood"], force: false, render })

    expect(rendered(calls)).toEqual(["wood/tree"])
    const index = JSON.parse(readFileSync(join(lib, "catalog/index.json"), "utf8"))
    expect(index.packs.map((p: { id: string }) => p.id)).toEqual(["town", "wood"])
    await expect(runThumbs({ library: lib, names: ["nope"], force: false, render })).rejects.toThrow("nope")
  })

  test("a library without a catalog does nothing", async () => {
    const lib = tempDir()
    mkdirSync(join(lib, "catalog"))
    const { render, calls } = fakeRender()

    expect(await runThumbs({ library: lib, names: [], force: false, render })).toEqual([])
    expect(calls).toEqual([])
  })
})

describe("manifest", () => {
  test("is saved with sorted keys", async () => {
    const lib = library({ town: ["b", "a", "c"].map((s) => entry("town", s)) })
    await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })

    expect(readFileSync(manifestFile(lib, "town"), "utf8")).toBe(
      `${JSON.stringify({ a: "h-a", b: "h-b", c: "h-c" }, null, 2)}\n`,
    )
  })

  test("an unreadable manifest counts as empty, so everything is redrawn", async () => {
    const lib = library({ town: [entry("town", "crate")] })
    await runThumbs({ library: lib, names: [], force: false, render: fakeRender().render })
    writeFileSync(manifestFile(lib, "town"), "{not json")
    const { render, calls } = fakeRender()

    await runThumbs({ library: lib, names: [], force: false, render })

    expect(rendered(calls)).toEqual(["town/crate"])
  })
})

describe("helpers", () => {
  test("batches splits into runs and handles empty input", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(batches([], 2)).toEqual([])
  })

  test("parseThumbArgs reads packs and --force, rejects other options", () => {
    expect(parseThumbArgs(["town", "--force", "wood"])).toEqual({ names: ["town", "wood"], force: true })
    expect(() => parseThumbArgs(["--jobs"])).toThrow("--jobs")
  })
})
