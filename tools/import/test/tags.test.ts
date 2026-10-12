import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { CatalogEntry, ComposeSource } from "@guildhall/assets"
import { readShard, shardFile, writeShard } from "../src/catalog.ts"
import { applyAnswers } from "../src/tags/apply.ts"
import { parseTagArgs } from "../src/tags/command.ts"
import { type BatchManifest, batchFile, emitBatches, outFile } from "../src/tags/emit.ts"
import { cacheFile, loadVocab } from "../src/tags/vocab.ts"
import { tempDir } from "./fixtures/env.ts"

const vocab = loadVocab()

const entry = (slug: string, source: ComposeSource = "placeholder"): CatalogEntry => ({
  id: `town/${slug}`,
  pack: "town",
  source: `${slug}.glb`,
  name: slug,
  kind: "static",
  category: "building",
  tags: ["rule-tag"],
  size: [4, 5, 4],
  footprint: { w: 4, d: 4 },
  tris: 12,
  verts: 8,
  bytes: 100,
  swatches: [1],
  scale: { factor: 1, rule: "factor", confidence: "pack", flags: [] },
  flags: [],
  compose: {
    front: source === "placeholder" ? null : "-x",
    streetEdge: null,
    attach: "free",
    anchors: [],
    source,
  },
  files: { glb: `pieces/town/${slug}.glb`, thumb: `thumbs/town/${slug}.webp` },
  hash: `h-${slug}`,
})

/** A library with the town shard and a thumbnail per entry (its bytes are `pixels[slug]` or the slug). */
function library(entries: CatalogEntry[], pixels: Record<string, string> = {}): string {
  const lib = tempDir()
  writeShard(lib, "town", entries)
  for (const e of entries) {
    const file = join(lib, e.files.thumb as string)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, pixels[e.name] ?? e.name)
  }
  return lib
}

const manifest = (lib: string, n: number): BatchManifest =>
  JSON.parse(readFileSync(batchFile(lib, n), "utf8")) as BatchManifest

type Answer = { id: string; tags: unknown[]; front: string; door: boolean }
const answer = (id: string, over: Partial<Answer> = {}): Answer => ({
  id,
  tags: ["house", "medium", "timber"],
  front: "+z",
  door: true,
  ...over,
})
const writeOut = (lib: string, n: number, items: Answer[]): void =>
  writeFileSync(outFile(lib, n), JSON.stringify({ batch: n, by: "test-model", items }))

describe("tag emit", () => {
  test("lists every thumbnailed piece in batches, with the thumb path, hash, name, category and size", () => {
    const lib = library([entry("a"), entry("b"), entry("c")])

    const numbers = emitBatches({ library: lib, names: [], vocab, batch: 2 })

    expect(numbers).toEqual([1, 2])
    const first = manifest(lib, 1)
    expect(first.items.map((i) => i.id)).toEqual(["town/a", "town/b"])
    expect(first.items[0]).toMatchObject({
      thumb: join(lib, "thumbs/town/a.webp"),
      name: "a",
      size: [4, 5, 4],
    })
    expect(first.items[0]?.thumbHash).toMatch(/^[0-9a-f]{16}$/)
    expect(first.vocab.groups.form).toContain("house")
    expect(manifest(lib, 2).items.map((i) => i.id)).toEqual(["town/c"])
  })

  test("skips pieces whose thumbnail already has a cached answer, and pieces without a thumbnail", () => {
    const noThumb = { ...entry("d"), files: { glb: "pieces/town/d.glb", thumb: null } }
    const lib = library([entry("a"), entry("b")])
    writeShard(lib, "town", [entry("a"), entry("b"), noThumb])
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [answer("town/a")])
    applyAnswers({ library: lib, vocab })

    emitBatches({ library: lib, names: ["town"], vocab })

    expect(manifest(lib, 1).items.map((i) => i.id)).toEqual(["town/b"])
  })

  test("lists a piece again once its thumbnail changes", () => {
    const lib = library([entry("a")])
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [answer("town/a")])
    applyAnswers({ library: lib, vocab })
    writeFileSync(join(lib, "thumbs/town/a.webp"), "redrawn")

    expect(emitBatches({ library: lib, names: [], vocab })).toEqual([1])
  })

  test("lists identical thumbnails once", () => {
    const lib = library([entry("a"), entry("b")], { a: "same", b: "same" })

    emitBatches({ library: lib, names: [], vocab })

    expect(manifest(lib, 1).items.map((i) => i.id)).toEqual(["town/a"])
  })

  test("refuses while an answer is waiting to be applied", () => {
    const lib = library([entry("a")])
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [answer("town/a")])

    expect(() => emitBatches({ library: lib, names: [], vocab })).toThrow(/not applied yet/)
  })

  test("an unknown pack throws", () => {
    const lib = library([entry("a")])
    expect(() => emitBatches({ library: lib, names: ["nope"], vocab })).toThrow(/no catalog shard for nope/)
  })
})

describe("tag apply", () => {
  test("writes sorted autoTags with the door tag, caches by thumb hash and removes the applied batch", () => {
    const lib = library([entry("a")])
    emitBatches({ library: lib, names: [], vocab })
    const hash = manifest(lib, 1).items[0]?.thumbHash as string
    writeOut(lib, 1, [answer("town/a", { tags: ["timber", "house", "medium", "house"] })])

    const summary = applyAnswers({ library: lib, vocab })

    expect(summary).toMatchObject({ answers: 1, updated: 1, warnings: [] })
    const [a] = readShard(lib, "town")
    expect(a?.autoTags).toEqual({
      tags: ["has-door", "house", "medium", "timber"],
      by: "test-model",
      thumb: hash,
    })
    expect(a?.tags).toEqual(["rule-tag"])
    const cache = JSON.parse(readFileSync(cacheFile(lib), "utf8"))
    expect(cache[hash]).toEqual({
      tags: ["house", "medium", "timber"],
      front: "+z",
      door: true,
      by: "test-model",
    })
    expect(existsSync(outFile(lib, 1)) || existsSync(batchFile(lib, 1))).toBe(false)
  })

  test("drops tags outside the vocabulary and a bad front with a warning, and skips ids not in the batch", () => {
    const lib = library([entry("a")])
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [
      answer("town/a", { tags: ["house", "spaceship", 7], front: "north" }),
      answer("town/stranger"),
    ])

    const summary = applyAnswers({ library: lib, vocab })

    const [a] = readShard(lib, "town")
    expect(a?.autoTags?.tags).toEqual(["has-door", "house"])
    expect(a?.compose).toMatchObject({ front: null, source: "placeholder" })
    expect(summary.warnings).toHaveLength(4)
    expect(summary.warnings.join("\n")).toContain('"spaceship"')
    expect(summary.warnings.join("\n")).toContain("town/stranger is not in batch 1")
  })

  test("an out file without its batch manifest, or without `by`, is rejected", () => {
    const lib = library([entry("a")])
    emitBatches({ library: lib, names: [], vocab })
    writeFileSync(outFile(lib, 1), JSON.stringify({ batch: 1, items: [] }))
    expect(() => applyAnswers({ library: lib, vocab })).toThrow(/"by" must name the model/)

    writeFileSync(outFile(lib, 7), JSON.stringify({ batch: 7, by: "m", items: [] }))
    expect(() => applyAnswers({ library: lib, vocab, files: [outFile(lib, 7)] })).toThrow(/no batch manifest/)
  })

  test("fills front only over placeholder compose meta, never over rule or manual", () => {
    const lib = library([entry("p"), entry("r", "rule"), entry("m", "manual")])
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [answer("town/m"), answer("town/p"), answer("town/r")])

    applyAnswers({ library: lib, vocab })

    const compose = Object.fromEntries(readShard(lib, "town").map((e) => [e.name, e.compose]))
    expect(compose.p).toMatchObject({ front: "+z", source: "vision" })
    expect(compose.r).toMatchObject({ front: "-x", source: "rule" })
    expect(compose.m).toMatchObject({ front: "-x", source: "manual" })
  })

  test("a front of none leaves placeholder compose meta alone", () => {
    const lib = library([entry("p")])
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [answer("town/p", { front: "none", door: false })])

    applyAnswers({ library: lib, vocab })

    expect(readShard(lib, "town")[0]?.compose).toMatchObject({ front: null, source: "placeholder" })
  })

  test("gives identical thumbnails the same answer and reapplying rewrites nothing", () => {
    const lib = library([entry("a"), entry("b")], { a: "same", b: "same" })
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [answer("town/a")])
    applyAnswers({ library: lib, vocab })
    const shard = readFileSync(shardFile(lib, "town"), "utf8")
    const cache = readFileSync(cacheFile(lib), "utf8")

    const again = applyAnswers({ library: lib, vocab })

    expect(readShard(lib, "town").map((e) => e.autoTags?.tags)).toEqual([
      ["has-door", "house", "medium", "timber"],
      ["has-door", "house", "medium", "timber"],
    ])
    expect(again).toMatchObject({ answers: 0, updated: 0 })
    expect(readFileSync(shardFile(lib, "town"), "utf8")).toBe(shard)
    expect(readFileSync(cacheFile(lib), "utf8")).toBe(cache)
  })

  test("restores autoTags to an entry rewritten without them, from the cache alone", () => {
    const lib = library([entry("a")])
    emitBatches({ library: lib, names: [], vocab })
    writeOut(lib, 1, [answer("town/a")])
    applyAnswers({ library: lib, vocab })
    writeShard(lib, "town", [entry("a")])

    expect(applyAnswers({ library: lib, vocab }).updated).toBe(1)
    expect(readShard(lib, "town")[0]?.autoTags?.tags).toContain("house")
  })
})

describe("parseTagArgs", () => {
  test("reads the action, packs and batch size", () => {
    expect(parseTagArgs(["emit", "town", "--batch", "10"])).toEqual({
      action: "emit",
      names: ["town"],
      batch: 10,
    })
    expect(parseTagArgs(["apply"])).toEqual({ action: "apply", names: [], batch: 40 })
  })

  test("rejects a missing action and a bad batch size", () => {
    expect(() => parseTagArgs([])).toThrow(/tag emit/)
    expect(() => parseTagArgs(["emit", "--batch", "0"])).toThrow(/--batch/)
  })
})
