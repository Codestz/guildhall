import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cacheFile, contentHash, loadCache, pieceKey, saveCache, stableStringify } from "../src/cache.ts"
import { runImport } from "../src/pipeline.ts"
import { fixturePacks, fixturePaths, tempDir } from "./fixtures/env.ts"

const base = {
  source: Uint8Array.of(1, 2, 3),
  pack: { id: "a", scale: { factor: 1 } },
  palette: "p1",
  importer: "i1",
}

describe("pieceKey", () => {
  test("is stable and ignores the key order of the pack config", () => {
    expect(pieceKey(base)).toBe(pieceKey({ ...base, pack: { scale: { factor: 1 }, id: "a" } }))
  })

  test("changes with the source bytes, the config, the palette and the importer", () => {
    const key = pieceKey(base)
    expect(pieceKey({ ...base, source: Uint8Array.of(1, 2, 4) })).not.toBe(key)
    expect(pieceKey({ ...base, pack: { id: "a", scale: { factor: 2 } } })).not.toBe(key)
    expect(pieceKey({ ...base, palette: "p2" })).not.toBe(key)
    expect(pieceKey({ ...base, importer: "i2" })).not.toBe(key)
  })

  test("stableStringify sorts nested keys but keeps array order", () => {
    expect(stableStringify({ b: [2, 1], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":[2,1]}')
  })
})

describe("cache file", () => {
  test("a missing or corrupt cache is empty; a saved cache loads back", () => {
    const dir = tempDir()
    expect(loadCache(dir, "town")).toEqual({})
    saveCache(dir, "town", { b: "2", a: "1" })
    expect(loadCache(dir, "town")).toEqual({ a: "1", b: "2" })
    expect(readFileSync(cacheFile(dir, "town"), "utf8").indexOf('"a"')).toBeLessThan(
      readFileSync(cacheFile(dir, "town"), "utf8").indexOf('"b"'),
    )
    writeFileSync(cacheFile(dir, "town"), "{nope")
    expect(loadCache(dir, "town")).toEqual({})
  })
})

describe("incremental import", () => {
  test("a second run reuses every piece; --force re-imports them", async () => {
    const p = fixturePaths()
    const packs = await fixturePacks()
    await runImport({ paths: p, packs })
    const glb = join(p.library, "pieces/fixture-material/bush.glb")
    const written = statSync(glb).mtimeMs
    const again = await runImport({ paths: p, packs })
    expect(again.map((s) => [s.imported, s.cached])).toEqual([
      [0, 1],
      [0, 1],
      [0, 2],
    ])
    expect(statSync(glb).mtimeMs).toBe(written)
    const forced = await runImport({ paths: p, packs, force: true })
    expect(forced.map((s) => s.imported)).toEqual([1, 1, 2])
  })

  test("only a changed source re-imports, and a removed source drops its entry and GLB", async () => {
    const p = fixturePaths(true)
    const packs = (await fixturePacks()).filter((x) => x.id === "fixture-material")
    await runImport({ paths: p, packs })
    const bush = join(p.raw, "fixture-material/bush.glb")
    writeFileSync(bush, readFileSync(bush)) // touched, same bytes: still cached
    expect((await runImport({ paths: p, packs }))[0]?.imported).toBe(0)

    const villager = readFileSync(join(p.raw, "fixture-material/villager.glb"))
    rmSync(join(p.raw, "fixture-material/villager.glb"))
    writeFileSync(join(p.raw, "fixture-material/hut.glb"), villager)
    const [run] = await runImport({ paths: p, packs })
    expect([run?.imported, run?.cached, run?.removed]).toEqual([1, 1, 1])
    expect(existsSync(join(p.library, "pieces/fixture-material/villager.glb"))).toBe(false)
    const ids = JSON.parse(readFileSync(join(p.library, "catalog/fixture-material.json"), "utf8")).map(
      (e: { id: string }) => e.id,
    )
    expect(ids).toEqual(["fixture-material/bush", "fixture-material/hut"])
  })

  test("a re-import keeps the thumbnail path and vision tags of the previous entry", async () => {
    const p = fixturePaths()
    const packs = (await fixturePacks()).filter((x) => x.id === "fixture-atlas")
    await runImport({ paths: p, packs })
    const shard = join(p.library, "catalog/fixture-atlas.json")
    const [entry] = JSON.parse(readFileSync(shard, "utf8"))
    entry.files.thumb = "thumbs/fixture-atlas/crate.webp"
    entry.autoTags = { tags: ["wooden"], by: "vision", thumb: "abc" }
    writeFileSync(shard, JSON.stringify([entry]))
    await runImport({ paths: p, packs, force: true })
    const [after] = JSON.parse(readFileSync(shard, "utf8"))
    expect([after.files.thumb, after.autoTags?.tags]).toEqual(["thumbs/fixture-atlas/crate.webp", ["wooden"]])
  })

  test("a re-import writes the cached vision answer back: autoTags, and front over placeholder only", async () => {
    const p = fixturePaths()
    const packs = (await fixturePacks()).filter(
      (x) => x.id === "fixture-atlas" || x.id === "fixture-colormap",
    )
    await runImport({ paths: p, packs })
    const answers: Record<string, unknown> = {}
    for (const [pack, slug] of [
      ["fixture-atlas", "crate"],
      ["fixture-colormap", "wall-door"],
    ] as const) {
      const thumb = `thumbs/${pack}/${slug}.webp`
      mkdirSync(join(p.library, `thumbs/${pack}`), { recursive: true })
      writeFileSync(join(p.library, thumb), `thumb of ${slug}`)
      answers[contentHash(readFileSync(join(p.library, thumb)))] = {
        tags: ["wooden"],
        front: "+x",
        door: true,
        by: "model",
      }
      const shard = join(p.library, `catalog/${pack}.json`)
      const [entry] = JSON.parse(readFileSync(shard, "utf8"))
      entry.files.thumb = thumb
      writeFileSync(shard, JSON.stringify([entry]))
    }
    mkdirSync(join(p.library, "tags"), { recursive: true })
    writeFileSync(join(p.library, "tags/cache.json"), JSON.stringify(answers))

    await runImport({ paths: p, packs, force: true })
    const read = (pack: string) =>
      JSON.parse(readFileSync(join(p.library, `catalog/${pack}.json`), "utf8"))[0]
    const crate = read("fixture-atlas")
    expect(crate.autoTags).toMatchObject({ tags: ["has-door", "wooden"], by: "model" })
    expect([crate.compose.front, crate.compose.source]).toEqual(["+x", "vision"])
    // The wall's compose meta comes from its rule: the vision front never overwrites it.
    const wall = read("fixture-colormap")
    expect(wall.autoTags?.tags).toEqual(["has-door", "wooden"])
    expect(wall.compose.source).toBe("rule")
    expect(wall.compose.front).not.toBe("+x")
  })
})
