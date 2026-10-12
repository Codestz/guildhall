import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Document } from "@gltf-transform/core"
import {
  type CatalogEntry,
  PALETTE,
  type PackConfig,
  paletteHash,
  validateEntry,
  validateIndex,
} from "@guildhall/assets"
import { readShard, shardFile, toEntry, writeIndex, writeShard } from "../src/catalog.ts"
import { checkLibrary } from "../src/check.ts"
import type { PieceReport, PieceSource } from "../src/stages/types.ts"
import { writePiece } from "../src/write.ts"
import { tempDir } from "./fixtures/env.ts"

const PACK: PackConfig = {
  id: "town",
  source: "town",
  vendor: "other",
  license: "CC0",
  include: ["*.glb"],
  colour: { mode: "colormap" },
  scale: { factor: 2.5 },
  pivot: "bottom-centre",
  rules: [],
}

const source = (slug: string): PieceSource => ({
  pack: "town",
  file: `/raw/town/${slug}.glb`,
  source: `${slug}.glb`,
  name: slug,
  slug,
  category: "wall",
  tags: ["wall", "stone"],
})

/** The report a finished piece would carry, with values that need rounding and sorting. */
const report = (slug: string): PieceReport => ({
  slug,
  kind: "static",
  flags: new Set(["sunk", "colour-miss"]),
  swatches: new Set([22, 1, 5]),
  compose: { front: "+z", streetEdge: null, attach: "wall-segment", anchors: [], source: "rule" },
  measures: { size: [2.5049, 2.61234, 0.30001], footprint: { w: 3, d: 1 }, tris: 12, verts: 8 },
})

/** A one-triangle GLB carrying the three palette attributes (what a finished piece looks like). */
function bakedDoc(): Document {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const attr = (type: "VEC3" | "VEC4" | "SCALAR", array: Float32Array | Uint8Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", attr("VEC3", new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])))
    .setAttribute("COLOR_0", attr("VEC3", new Float32Array(9).fill(0.5)))
    .setAttribute("_SWATCH", attr("SCALAR", Uint8Array.of(1, 1, 5)))
    .setAttribute("_SHADE", attr("SCALAR", Uint8Array.of(128, 128, 128)))
  doc.createScene().addChild(doc.createNode("p").setMesh(doc.createMesh("p").addPrimitive(prim)))
  return doc
}

async function library(slugs: string[]): Promise<{ dir: string; entries: CatalogEntry[] }> {
  const dir = tempDir()
  const entries: CatalogEntry[] = []
  for (const slug of slugs)
    entries.push(toEntry(PACK, source(slug), report(slug), await writePiece(bakedDoc(), dir, "town", slug)))
  writeShard(dir, "town", entries)
  writeIndex(dir, PALETTE, { town: "other" })
  return { dir, entries }
}

describe("toEntry", () => {
  test("builds a valid entry with sizes to 1e-2 and sorted sets", async () => {
    const { entries } = await library(["wall-door"])
    const e = entries[0] as CatalogEntry
    expect(validateEntry(e, PALETTE)).toEqual([])
    expect(e).toMatchObject({
      id: "town/wall-door",
      size: [2.5, 2.61, 0.3],
      swatches: [1, 5, 22],
      flags: ["colour-miss", "sunk"],
      scale: { factor: 2.5, rule: "factor", confidence: "pack", flags: [] },
      files: { glb: "pieces/town/wall-door.glb", thumb: null },
    })
  })

  test("without a scale stage report, a ref-scaled pack is factor 1 with confidence guess", async () => {
    const dir = tempDir()
    const e = toEntry(
      { ...PACK, scale: { ref: "wall-door", measure: "doorTop", metres: 2.6 } },
      source("w"),
      { ...report("w"), measures: undefined },
      await writePiece(bakedDoc(), dir, "town", "w"),
    )
    expect(e.scale).toEqual({ factor: 1, rule: "ref", confidence: "guess", flags: [] })
    expect([e.size, e.tris]).toEqual([[0, 0, 0], 0])
  })
})

describe("shards and index", () => {
  test("a shard is sorted by id and rewrites to identical bytes", async () => {
    const { dir, entries } = await library(["wall-b", "wall-a"])
    const first = readFileSync(shardFile(dir, "town"), "utf8")
    expect(readShard(dir, "town").map((e) => e.id)).toEqual(["town/wall-a", "town/wall-b"])
    const hash = writeShard(dir, "town", [...entries].reverse())
    expect(readFileSync(shardFile(dir, "town"), "utf8")).toBe(first)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(first).not.toMatch(/"(time|date|generated)/)
  })

  test("the index validates and lists every shard on disk with its count and vendor", async () => {
    const { dir } = await library(["wall-a", "wall-b"])
    writeShard(dir, "other-pack", [])
    const index = writeIndex(dir, PALETTE, { town: "other" })
    expect(validateIndex(index)).toEqual([])
    expect(index.palette).toBe(paletteHash(PALETTE))
    expect(index.packs.map((p) => [p.id, p.count, p.vendor])).toEqual([
      ["other-pack", 0, "other"],
      ["town", 2, "other"],
    ])
  })

  test("given rigs replace the indexed rigs of their id; the other indexed rigs stay", async () => {
    const { dir } = await library(["wall-a"])
    const rig = (id: string, bones: number) => ({ id, file: `rigs/${id}.glb`, clips: [], bones })
    writeIndex(dir, PALETTE, { town: "other" }, [rig("b", 1), rig("a", 1)])
    const index = writeIndex(dir, PALETTE, { town: "other" }, [rig("b", 2)])
    expect(index.rigs).toEqual([rig("a", 1), rig("b", 2)])
    expect(writeIndex(dir, PALETTE, { town: "other" }).rigs).toEqual([rig("a", 1), rig("b", 2)])
  })
})

describe("check", () => {
  test("a baked library has no problems", async () => {
    const { dir } = await library(["wall-a", "wall-b"])
    expect(await checkLibrary(dir, PALETTE)).toEqual({ shards: 1, entries: 2, problems: [] })
  })

  test("a missing GLB, an unknown category and an unlisted shard are reported", async () => {
    const { dir, entries } = await library(["wall-a", "wall-b"])
    rmSync(join(dir, "pieces/town/wall-a.glb"))
    const bad = { ...(entries[1] as CatalogEntry), category: "spaceship" }
    writeFileSync(shardFile(dir, "town"), JSON.stringify([entries[0], bad]))
    writeFileSync(shardFile(dir, "extra"), "[]")
    const { problems } = await checkLibrary(dir, PALETTE)
    expect(problems).toContain("town/wall-a: glb pieces/town/wall-a.glb missing")
    expect(problems).toContain('town/wall-b: category: unknown "spaceship"')
    expect(problems).toContain('index.json: shard "extra" is not listed')
  })
})
