import { describe, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Document, type Node } from "@gltf-transform/core"
import { getBounds } from "@gltf-transform/functions"
import { PALETTE, type PackConfig, type PieceOverride } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { classify, discover } from "../src/discover.ts"
import { startReport } from "../src/pipeline.ts"
import { gltfIO, readModel } from "../src/read.ts"
import { measure } from "../src/stages/measure.ts"
import { normalize, refScale } from "../src/stages/normalize.ts"
import type { StageCtx } from "../src/stages/types.ts"
import { FIXTURES, fixturePacks, tempDir } from "./fixtures/env.ts"

type V3 = [number, number, number]

const pack = (over: Partial<PackConfig> = {}): PackConfig => ({
  id: "test",
  source: "test",
  vendor: "other",
  license: "CC0",
  include: ["**/*.glb"],
  colour: { mode: "material" },
  scale: { factor: 1 },
  pivot: "bottom-centre",
  rules: [],
  ...over,
})

/** A mesh of the given points (as one triangle list, cycling indices) under a node in a scene. */
function points(doc: Document, pts: V3[]): Node {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(new Float32Array(pts.flat())).setBuffer(buffer),
    )
  return doc.createNode("piece").setMesh(doc.createMesh("piece").addPrimitive(prim))
}

/** The eight corners of a box. */
const corners = (min: V3, max: V3): V3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
    i & 1 ? max[0] : min[0],
    i & 2 ? max[1] : min[1],
    i & 4 ? max[2] : min[2],
  ])

function boxDoc(min: V3, max: V3): Document {
  const doc = new Document()
  doc.createScene().addChild(points(doc, corners(min, max)))
  return doc
}

function ctxFor(doc: Document, p: PackConfig, name = "piece", override?: Partial<PieceOverride>): StageCtx {
  const source = classify(p, `/raw/${p.source}/${name}.glb`, `${name}.glb`, name)
  if (override) source.override = override
  return {
    pack: p,
    source,
    palette: PALETTE,
    raw: FIXTURES,
    library: tempDir(),
    log: log("test"),
    out: startReport(source, doc),
  }
}

const boundsOf = (doc: Document) => {
  const b = getBounds(doc.getRoot().listScenes()[0] as never)
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0
  return { min: b.min.map(r), max: b.max.map(r) }
}

describe("normalize: scale and pivot", () => {
  test("a factor scales, and bottom-centre puts the bbox bottom at 0 and its xz centre on the origin", async () => {
    const doc = boxDoc([1, -0.5, -1], [3, 1.5, 1])
    const ctx = ctxFor(doc, pack({ scale: { factor: 2 } }))
    await normalize(doc, ctx)
    expect(boundsOf(doc)).toEqual({ min: [-2, 0, -2], max: [2, 4, 2] })
    expect(ctx.out.scale).toEqual({ factor: 2, rule: "factor", confidence: "pack", flags: [] })
    expect([...ctx.out.flags]).toEqual([])
  })

  test("node transforms (nested, scaled, and a mesh shared by two nodes) are baked into the vertices", async () => {
    const doc = new Document()
    const a = points(doc, corners([0, 0, 0], [1, 1, 1]))
    const b = doc.createNode("b").setMesh(a.getMesh()).setTranslation([4, 0, 0])
    const parent = doc.createNode("parent").setTranslation([0, 10, 0]).setScale([2, 2, 2]).addChild(a)
    doc.createScene().addChild(parent).addChild(b)
    await normalize(doc, ctxFor(doc, pack({ pivot: "keep" })))
    for (const n of doc
      .getRoot()
      .listNodes()
      .filter((x) => x.getMesh()))
      expect(n.getWorldMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    expect(boundsOf(doc)).toEqual({ min: [0, 0, 0], max: [5, 12, 2] })
  })

  test("trunk pivots on the xz centroid of the lowest tenth of the vertices, not the bbox centre", async () => {
    const doc = new Document()
    // A trunk at x = 1, z = -1 (sunk to y = -0.3) under a canopy that leans far to +x.
    const trunk = corners([0.9, -0.3, -1.1], [1.1, 2, -0.9])
    const canopy = Array.from({ length: 72 }, (_, i): V3 => [2 + (i % 6), 2 + (i % 3), -1 + (i % 2)])
    doc.createScene().addChild(points(doc, [...trunk, ...canopy]))
    const ctx = ctxFor(doc, pack({ pivot: "trunk" }))
    await normalize(doc, ctx)
    const b = boundsOf(doc)
    expect(b.min).toEqual([-0.1, 0, -0.1])
    expect(b.max[0]).toBe(6)
    expect([...ctx.out.flags]).toEqual([])
  })

  test("sink embeds the piece after the pivot and is not flagged as sunk", async () => {
    const doc = boxDoc([0, 0.4, 0], [1, 5, 1])
    const ctx = ctxFor(doc, pack({ pivot: "trunk", sink: 0.05 }))
    await normalize(doc, ctx)
    expect(boundsOf(doc).min[1]).toBe(-0.05)
    expect([...ctx.out.flags]).toEqual([])
  })

  test("an override pivot replaces the pack's", async () => {
    const doc = boxDoc([2, 1, 2], [3, 2, 3])
    await normalize(doc, ctxFor(doc, pack({ pivot: "bottom-centre" }), "piece", { pivot: "keep" }))
    expect(boundsOf(doc).min).toEqual([2, 1, 2])
  })
})

describe("normalize: ground and flags", () => {
  test("ground moves the pack's known ground level to 0; pieces on it are not flagged", async () => {
    const doc = boxDoc([-0.5, -0.05, -0.5], [0.5, 1, 0.5])
    const ctx = ctxFor(doc, pack({ pivot: "keep", ground: -0.05 }))
    await normalize(doc, ctx)
    expect(boundsOf(doc).min[1]).toBe(0)
    expect([...ctx.out.flags]).toEqual([])
  })

  test("with ground set, a piece reaching below it is sunk and one above it is floating", async () => {
    const deep = boxDoc([-0.5, -0.3, -0.5], [0.5, 1, 0.5])
    const deepCtx = ctxFor(deep, pack({ ground: -0.05 }))
    await normalize(deep, deepCtx)
    expect(boundsOf(deep).min[1]).toBe(-0.25)
    expect([...deepCtx.out.flags]).toEqual(["sunk"])

    const high = boxDoc([-0.5, 0.2, -0.5], [0.5, 1, 0.5])
    const highCtx = ctxFor(high, pack({ ground: -0.05 }))
    await normalize(high, highCtx)
    expect([...highCtx.out.flags]).toEqual(["floating"])
  })

  test("keep flags a bbox centre more than 0.1 m off the origin, and a bottom off 0 by more than 1 cm", async () => {
    const off = boxDoc([0.2, -0.02, -0.5], [1.2, 1, 0.5])
    const offCtx = ctxFor(off, pack({ pivot: "keep" }))
    await normalize(off, offCtx)
    expect([...offCtx.out.flags].sort()).toEqual(["off-centre", "sunk"])

    const near = boxDoc([-0.45, 0.005, -0.5], [0.55, 1, 0.5])
    const nearCtx = ctxFor(near, pack({ pivot: "keep" }))
    await normalize(near, nearCtx)
    expect([...nearCtx.out.flags]).toEqual([])
  })
})

describe("normalize: which scale applies", () => {
  const mixed = pack({
    scale: { factor: 2 },
    scaleBy: [
      { match: "ship*", factor: 0.5 },
      { match: "barrel*", factor: 3 },
    ],
  })
  const heightOf = async (name: string, override?: Partial<PieceOverride>) => {
    const doc = boxDoc([0, 0, 0], [1, 1, 1])
    const ctx = ctxFor(doc, mixed, name, override)
    await normalize(doc, ctx)
    return [boundsOf(doc).max[1], ctx.out.scale?.rule]
  }

  test("the first matching scaleBy beats the pack factor; an override factor beats both", async () => {
    expect(await heightOf("crate")).toEqual([2, "factor"])
    expect(await heightOf("ship_large")).toEqual([0.5, "factor"])
    expect(await heightOf("ship_large", { factor: 4 })).toEqual([4, "override"])
  })

  test("a non-positive factor is a config error", async () => {
    const doc = boxDoc([0, 0, 0], [1, 1, 1])
    await expect(normalize(doc, ctxFor(doc, pack({ scale: { factor: 0 } })))).rejects.toThrow("expected > 0")
  })

  test("override anchors come out in piece space, through the same transform as the vertices", async () => {
    const doc = boxDoc([1, 0.5, 1], [2, 1.5, 2])
    const anchor = { id: "door", kind: "door" as const, at: [1.5, 1.25, 2] as V3, facing: 0 }
    const ctx = ctxFor(doc, pack({ scale: { factor: 2 } }), "piece", { anchors: [anchor] })
    await normalize(doc, ctx)
    expect(ctx.out.compose.anchors).toEqual([{ ...anchor, at: [0, 1.5, 1] }])
  })
})

describe("normalize: reference scale", () => {
  test("refScale solves the factor from the bbox height, or from the door anchor for doorTop", () => {
    const doc = boxDoc([0, -0.5, 0], [1, 1.5, 0.1])
    expect(refScale(doc, "height", 3)).toBe(1.5)
    expect(refScale(doc, "storey", 3)).toBe(1.5)
    const door = { id: "d", kind: "door" as const, at: [0, 0.8, 0] as V3, facing: 0 }
    expect(refScale(doc, "doorTop", 2.6, [door])).toBeCloseTo(2, 9)
    expect(() => refScale(doc, "doorTop", 2.6, [])).toThrow('needs a "door" anchor')
  })

  test("doorTop measures from the door's threshold (at.y − height), not the bottom of a plinth", () => {
    // A house on a 0.5-unit plinth: bbox bottom 0, door threshold 0.5, door top 2.5, roof 4.
    const plinthed = boxDoc([-2, 0, -2], [2, 4, 2])
    const door = { id: "d", kind: "door" as const, at: [0, 2.5, 2] as V3, facing: 0 }
    expect(refScale(plinthed, "doorTop", 2.6, [{ ...door, height: 2 }])).toBeCloseTo(1.3, 9)
    // Without a height there is no threshold to read: the bbox bottom stands in (the plinth counts).
    expect(refScale(plinthed, "doorTop", 2.6, [door])).toBeCloseTo(2.6 / 2.5, 9)
  })

  test("a doorTop ref pack reads the plinthed reference from ctx.raw and solves from its threshold", async () => {
    const raw = tempDir()
    mkdirSync(join(raw, "town"), { recursive: true })
    await (await gltfIO()).write(join(raw, "town/house.glb"), boxDoc([-2, 0, -2], [2, 4, 2]))
    const door = { id: "d", kind: "door" as const, at: [0, 2.5, 2] as V3, facing: 0, height: 2 }
    const p = pack({
      source: "town",
      scale: { ref: "house", measure: "doorTop", metres: 2.6 },
      overrides: { house: { anchors: [door] } },
    })
    const doc = boxDoc([0, 0, 0], [1, 1, 1])
    const ctx = { ...ctxFor(doc, p, "crate"), raw }
    await normalize(doc, ctx)
    expect(ctx.out.scale?.factor).toBeCloseTo(1.3, 6)
  })

  test("an override anchor's door height is not carried into the piece's anchors", async () => {
    const doc = boxDoc([0, 0, 0], [1, 1, 1])
    const anchor = { id: "door", kind: "door" as const, at: [0.5, 0.8, 1] as V3, facing: 0 }
    const ctx = ctxFor(doc, pack(), "piece", { anchors: [{ ...anchor, height: 0.8 }] })
    await normalize(doc, ctx)
    expect(ctx.out.compose.anchors).toEqual([{ ...anchor, at: [0, 0.8, 0.5] }])
  })

  test("a ref pack measures its named piece and scales to it (the committed colormap fixture)", async () => {
    const p = (await fixturePacks()).find((x) => x.id === "fixture-colormap") as PackConfig
    const [source] = discover(p, FIXTURES)
    if (!source) throw new Error("fixture missing")
    const doc = await readModel(source.file, tempDir())
    const out = startReport(source, doc)
    const ctx: StageCtx = { ...ctxFor(doc, p), source, out }
    await normalize(doc, ctx)
    await measure(doc, ctx)
    expect(ctx.out.scale).toMatchObject({ factor: 3, rule: "ref", confidence: "ref" })
    expect(ctx.out.measures?.size).toEqual([3, 3, 0.3])
  })

  test("a scaleBy ref with metres measures that piece with the pack's measure", async () => {
    const p = (await fixturePacks()).find((x) => x.id === "fixture-colormap") as PackConfig
    const mixed = { ...p, scaleBy: [{ match: "wall*", ref: "wall-door", metres: 1.5 }] }
    const [source] = discover(mixed, FIXTURES)
    if (!source) throw new Error("fixture missing")
    const doc = await readModel(source.file, tempDir())
    const ctx: StageCtx = { ...ctxFor(doc, mixed), source, out: startReport(source, doc) }
    await normalize(doc, ctx)
    expect(ctx.out.scale?.factor).toBe(1.5)
  })

  test("a ref that names no piece in the pack is an error", async () => {
    const p = (await fixturePacks()).find((x) => x.id === "fixture-colormap") as PackConfig
    const broken = { ...p, scale: { ref: "no-such-piece", measure: "height" as const, metres: 3 } }
    const [source] = discover(broken, FIXTURES)
    if (!source) throw new Error("fixture missing")
    const doc = await readModel(source.file, tempDir())
    const ctx: StageCtx = { ...ctxFor(doc, broken), source, out: startReport(source, doc) }
    await expect(normalize(doc, ctx)).rejects.toThrow('scale ref "no-such-piece" matches no piece')
  })
})
