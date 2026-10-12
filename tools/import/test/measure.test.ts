import { describe, expect, test } from "bun:test"
import { Document, type Node } from "@gltf-transform/core"
import { type Category, PALETTE, type PackConfig, type PackRule, type PieceOverride } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { classify } from "../src/discover.ts"
import { startReport } from "../src/pipeline.ts"
import { DEFAULT_TRI_BUDGET, footprintOf, measure } from "../src/stages/measure.ts"
import type { StageCtx } from "../src/stages/types.ts"

const pack = (rules: PackRule[] = []): PackConfig => ({
  id: "test",
  source: "test",
  vendor: "other",
  license: "CC0",
  include: ["**/*.glb"],
  colour: { mode: "material" },
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules,
})

/** A box from (0, 0, 0) to `size` as `tris` triangles over 8 corners, with optional `_SWATCH` ids. */
function box(doc: Document, size: [number, number, number], tris = 12, swatches?: number[]): Node {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
  const pos = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [
    i & 1 ? size[0] : 0,
    i & 2 ? size[1] : 0,
    i & 4 ? size[2] : 0,
  ])
  const idx = Array.from({ length: tris * 3 }, (_, i) => i % 8)
  const prim = doc
    .createPrimitive()
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buffer))
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer),
    )
  if (swatches)
    prim.setAttribute(
      "_SWATCH",
      doc
        .createAccessor()
        .setType("SCALAR")
        .setArray(new Uint8Array(Array.from({ length: 8 }, (_, i) => swatches[i % swatches.length] ?? 0)))
        .setBuffer(buffer),
    )
  return doc.createNode("piece").setMesh(doc.createMesh("piece").addPrimitive(prim))
}

function ctxFor(
  doc: Document,
  opts: { category?: Category; rules?: PackRule[]; override?: Partial<PieceOverride> } = {},
): StageCtx {
  const p = pack(opts.rules)
  const source = classify(p, "/raw/test/piece.glb", "piece.glb", "piece")
  if (opts.category) source.category = opts.category
  if (opts.override) source.override = opts.override
  const out = startReport(source, doc)
  out.scale = { factor: 1, rule: "factor", confidence: "pack", flags: [] }
  return { pack: p, source, palette: PALETTE, log: log("test"), out }
}

const oneBox = (size: [number, number, number], tris?: number, swatches?: number[]): Document => {
  const doc = new Document()
  doc.createScene().addChild(box(doc, size, tris, swatches))
  return doc
}

describe("footprintOf", () => {
  test("whole cells, with up to 5 cm over a cell still fitting in it", () => {
    expect(footprintOf([1.04, 1, 2])).toEqual({ w: 1, d: 2 })
    expect(footprintOf([1.05, 1, 2.05])).toEqual({ w: 1, d: 2 })
    expect(footprintOf([1.06, 1, 2.1])).toEqual({ w: 2, d: 3 })
  })

  test("a thin or empty piece still takes one cell", () => {
    expect(footprintOf([0.02, 1, 0])).toEqual({ w: 1, d: 1 })
  })
})

describe("measure", () => {
  test("size to 1e-2, footprint, tris and verts, counting every node that uses a mesh", async () => {
    const doc = new Document()
    const a = box(doc, [2.004, 3.456, 0.3])
    const b = doc.createNode("copy").setMesh(a.getMesh())
    doc.createScene().addChild(a).addChild(b)
    const ctx = ctxFor(doc)
    await measure(doc, ctx)
    expect(ctx.out.measures).toEqual({ size: [2, 3.46, 0.3], footprint: { w: 2, d: 1 }, tris: 24, verts: 16 })
  })

  test("swatches are the palette ids found in _SWATCH; none without the attribute", async () => {
    const doc = oneBox([1, 1, 1], 12, [5, 1, 5, 22])
    const ctx = ctxFor(doc)
    await measure(doc, ctx)
    expect([...ctx.out.swatches].sort((x, y) => x - y)).toEqual([1, 5, 22])

    const bare = oneBox([1, 1, 1])
    const bareCtx = ctxFor(bare)
    await measure(bare, bareCtx)
    expect(bareCtx.out.swatches.size).toBe(0)
  })

  test("an empty document measures zero and still takes one cell", async () => {
    const doc = new Document()
    doc.createScene()
    const ctx = ctxFor(doc)
    await measure(doc, ctx)
    expect(ctx.out.measures).toEqual({ size: [0, 0, 0], footprint: { w: 1, d: 1 }, tris: 0, verts: 0 })
  })
})

describe("measure: scale check", () => {
  test("a height outside the category's band is flagged, with the target recorded", async () => {
    const doc = oneBox([1, 2, 1])
    const ctx = ctxFor(doc, { category: "tree" })
    await measure(doc, ctx)
    expect(ctx.out.scale).toEqual({
      factor: 1,
      rule: "factor",
      confidence: "pack",
      target: [4, 9],
      flags: ["undersize"],
    })
  })

  test("a height inside the band keeps the confidence and has no flags", async () => {
    const doc = oneBox([1, 6, 1])
    const ctx = ctxFor(doc, { category: "tree" })
    ctx.out.scale = { factor: 2, rule: "ref", confidence: "ref", flags: [] }
    await measure(doc, ctx)
    expect(ctx.out.scale).toEqual({ factor: 2, rule: "ref", confidence: "ref", target: [4, 9], flags: [] })
  })

  test("a category with no target gets confidence pack and no flags", async () => {
    const doc = oneBox([1, 40, 1])
    const ctx = ctxFor(doc, { category: "prop" })
    ctx.out.scale = { factor: 2, rule: "ref", confidence: "ref", flags: [] }
    await measure(doc, ctx)
    expect(ctx.out.scale).toEqual({ factor: 2, rule: "ref", confidence: "pack", flags: [] })
  })
})

describe("measure: flags and compose", () => {
  test("high-tris above the category budget only", async () => {
    const at = oneBox([1, 1, 1], DEFAULT_TRI_BUDGET)
    const atCtx = ctxFor(at, { category: "prop" })
    await measure(at, atCtx)
    expect(atCtx.out.flags.has("high-tris")).toBe(false)

    const over = oneBox([1, 1, 1], DEFAULT_TRI_BUDGET + 1)
    const overCtx = ctxFor(over, { category: "prop" })
    await measure(over, overCtx)
    expect(overCtx.out.flags.has("high-tris")).toBe(true)

    const tree = oneBox([1, 1, 1], DEFAULT_TRI_BUDGET + 1)
    const treeCtx = ctxFor(tree, { category: "tree" })
    await measure(tree, treeCtx)
    expect(treeCtx.out.flags.has("high-tris")).toBe(false)
  })

  test("without rule or override fields, compose stays a placeholder", async () => {
    const doc = oneBox([1, 1, 1])
    const ctx = ctxFor(doc, { rules: [{ match: "piece", category: "prop" }] })
    await measure(doc, ctx)
    expect(ctx.out.compose).toEqual({
      front: null,
      streetEdge: null,
      attach: "free",
      anchors: [],
      source: "placeholder",
    })
  })

  test("rule fields fill compose with source rule", async () => {
    const doc = oneBox([1, 1, 1])
    const rules: PackRule[] = [
      {
        match: "piece",
        category: "fence",
        attach: "edge-dressing",
        front: "+z",
        streetEdge: "-z",
        edgeKind: "fence",
      },
    ]
    const ctx = ctxFor(doc, { rules })
    await measure(doc, ctx)
    expect(ctx.out.compose).toEqual({
      front: "+z",
      streetEdge: "-z",
      attach: "edge-dressing",
      edgeKind: "fence",
      anchors: [],
      source: "rule",
    })
  })

  test("an override's front and anchors win and make the source manual", async () => {
    const doc = oneBox([1, 1, 1])
    const anchor = {
      id: "door",
      kind: "door" as const,
      at: [0, 2.4, 0.5] as [number, number, number],
      facing: 0,
    }
    const ctx = ctxFor(doc, {
      rules: [{ match: "piece", category: "building", attach: "free", front: "+z" }],
      override: { front: "-x", anchors: [anchor] },
    })
    ctx.out.compose.anchors = [anchor] // normalize has placed them in piece space
    await measure(doc, ctx)
    expect(ctx.out.compose).toMatchObject({ front: "-x", anchors: [anchor], source: "manual" })
  })
})
