import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type Document, Document as GltfDocument, Logger, type Primitive } from "@gltf-transform/core"
import { getBounds } from "@gltf-transform/functions"
import { PALETTE, type PackConfig } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { gltfIO } from "../src/read.ts"
import { optimize, POSITION_STEP, positionBits, simplifyRatio } from "../src/stages/optimize.ts"
import type { StageCtx } from "../src/stages/types.ts"
import { FIXTURES } from "./fixtures/env.ts"

const pack: PackConfig = {
  id: "test",
  source: "test",
  vendor: "other",
  license: "CC0",
  include: [],
  colour: { mode: "material" },
  scale: { factor: 1 },
  pivot: "keep",
  rules: [],
}

const ctx = (override?: Record<string, unknown>): StageCtx => ({
  pack,
  source: {
    pack: "test",
    file: "/x.glb",
    source: "x.glb",
    name: "x",
    slug: "x",
    category: "prop",
    tags: [],
    ...(override ? { override } : {}),
  },
  palette: PALETTE,
  raw: "/raw",
  library: "/library",
  log: log("test"),
  out: { slug: "x", kind: "static", flags: new Set(), swatches: new Set(), compose: {} as never },
})

interface Corner {
  p: [number, number, number]
  swatch: number
}

/**
 * Non-indexed triangles on a palette-baked layout: POSITION, NORMAL (+y), COLOR_0 (float),
 * _SWATCH, _SHADE and _AO (bytes), as the colour and AO stages leave them.
 */
function triangles(corners: Corner[]): Document {
  const doc = new GltfDocument().setLogger(new Logger(Logger.Verbosity.WARN))
  const buffer = doc.createBuffer()
  const n = corners.length
  const acc = (type: "VEC3" | "SCALAR", array: Float32Array | Uint8Array, normalized = false) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer).setNormalized(normalized)
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  const rgb = new Float32Array(n * 3)
  const swatch = new Uint8Array(n)
  const shade = new Uint8Array(n).fill(128)
  const occlusion = new Uint8Array(n).fill(200)
  for (const [i, c] of corners.entries()) {
    pos.set(c.p, i * 3)
    nor.set([0, 1, 0], i * 3)
    rgb.set([c.swatch / 10, 0.5, 0.25], i * 3)
    swatch[i] = c.swatch
  }
  const prim = doc
    .createPrimitive()
    .setMaterial(doc.createMaterial("palette"))
    .setAttribute("POSITION", acc("VEC3", pos))
    .setAttribute("NORMAL", acc("VEC3", nor))
    .setAttribute("COLOR_0", acc("VEC3", rgb))
    .setAttribute("_SWATCH", acc("SCALAR", swatch))
    .setAttribute("_SHADE", acc("SCALAR", shade, true))
    .setAttribute("_AO", acc("SCALAR", occlusion, true))
  doc.createScene().addChild(doc.createNode("piece").setMesh(doc.createMesh("piece").addPrimitive(prim)))
  return doc
}

/** Two triangles of a w × w quad in the xz plane, sharing the (w,0,0)–(0,0,w) edge. */
const quad = (w: number, swatches: [number, number]): Corner[] => [
  { p: [0, 0, 0], swatch: swatches[0] },
  { p: [w, 0, 0], swatch: swatches[0] },
  { p: [0, 0, w], swatch: swatches[0] },
  { p: [w, 0, 0], swatch: swatches[1] },
  { p: [w, 0, w], swatch: swatches[1] },
  { p: [0, 0, w], swatch: swatches[1] },
]

/** An n × n grid of quads, 1 m apart: a mesh simplify can collapse. */
function grid(n: number): Document {
  const corners: Corner[] = []
  for (let x = 0; x < n; x++)
    for (let z = 0; z < n; z++)
      for (const c of quad(1, [3, 3])) corners.push({ ...c, p: [c.p[0] + x, 0, c.p[2] + z] })
  return triangles(corners)
}

const prims = (doc: Document): Primitive[] =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
const verts = (doc: Document): number =>
  prims(doc).reduce((s, p) => s + (p.getAttribute("POSITION")?.getCount() ?? 0), 0)
const tris = (doc: Document): number =>
  prims(doc).reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0)

/** Writes the document as a GLB and reads it back (meshopt decoded). */
async function roundTrip(doc: Document): Promise<{ doc: Document; bytes: number }> {
  const io = await gltfIO()
  const bytes = await io.writeBinary(doc)
  return { doc: await io.readBinary(bytes), bytes: bytes.byteLength }
}

/** Every vertex's world-space position (node transform applied: quantization moves it there). */
function worldPositions(doc: Document): number[][] {
  const out: number[][] = []
  for (const node of doc.getRoot().listNodes()) {
    const m = node.getWorldMatrix()
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const pos = prim.getAttribute("POSITION")
      for (let i = 0; i < (pos?.getCount() ?? 0); i++) {
        const [x = 0, y = 0, z = 0] = pos?.getElement(i, []) ?? []
        out.push(
          [0, 1, 2].map(
            (k) => (m[k] ?? 0) * x + (m[4 + k] ?? 0) * y + (m[8 + k] ?? 0) * z + (m[12 + k] ?? 0),
          ),
        )
      }
    }
  }
  return out.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0))
}

describe("optimize: weld", () => {
  test("identical corners weld into one vertex", async () => {
    const doc = triangles(quad(1, [3, 3]))
    await optimize(doc, ctx())
    expect([verts(doc), tris(doc)]).toEqual([4, 2])
  })

  test("corners that differ in _SWATCH stay split", async () => {
    const doc = triangles(quad(1, [3, 4]))
    await optimize(doc, ctx())
    expect([verts(doc), tris(doc)]).toEqual([6, 2])
    const swatches = prims(doc).flatMap((p) => Array.from(p.getAttribute("_SWATCH")?.getArray() ?? []))
    expect(swatches.sort()).toEqual([3, 3, 3, 4, 4, 4])
  })

  test("corners that differ only in _SHADE, _AO or COLOR_0 stay split", async () => {
    for (const semantic of ["_SHADE", "_AO", "COLOR_0"]) {
      const doc = triangles(quad(1, [3, 3]))
      const acc = prims(doc)[0]?.getAttribute(semantic)
      const el = acc?.getElement(3, []) ?? []
      acc?.setElement(3, semantic === "COLOR_0" ? [0.9, el[1] ?? 0, el[2] ?? 0] : [100])
      await optimize(doc, ctx())
      expect(verts(doc)).toBe(5)
    }
  })
})

describe("optimize: meshopt", () => {
  test("writes EXT_meshopt_compression and keeps 1 cm at building scale", async () => {
    const doc = triangles(quad(20, [3, 4]))
    const before = worldPositions(doc)
    await optimize(doc, ctx())
    const back = await roundTrip(doc)
    const used = back.doc
      .getRoot()
      .listExtensionsUsed()
      .map((e) => e.extensionName)
    expect(used).toContain("EXT_meshopt_compression")
    const after = worldPositions(back.doc)
    expect(after).toHaveLength(before.length)
    let worst = 0
    for (const [i, p] of after.entries())
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs((p[k] ?? 0) - (before[i]?.[k] ?? 0)))
    expect(worst).toBeLessThanOrEqual(POSITION_STEP / 2)
  })

  test("normals stay within a degree; _SWATCH, _SHADE and _AO come back exactly", async () => {
    const doc = triangles(quad(2, [3, 4]))
    const n = prims(doc)[0]?.getAttribute("NORMAL")
    const tilted = [0.3, 0.9, 0.1]
    const len = Math.hypot(...tilted)
    for (let i = 0; i < (n?.getCount() ?? 0); i++)
      n?.setElement(
        i,
        tilted.map((v) => v / len),
      )
    await optimize(doc, ctx())
    const prim = prims((await roundTrip(doc)).doc)[0] as Primitive
    const normal = prim.getAttribute("NORMAL")
    for (let i = 0; i < (normal?.getCount() ?? 0); i++) {
      const v = normal?.getElement(i, []) ?? []
      const dot = v.reduce((s, x, k) => s + x * ((tilted[k] ?? 0) / len), 0) / Math.hypot(...v)
      expect(Math.acos(Math.min(1, dot)) * (180 / Math.PI)).toBeLessThan(1)
    }
    expect(Array.from(prim.getAttribute("_SWATCH")?.getArray() ?? []).sort()).toEqual([3, 3, 3, 4, 4, 4])
    expect(prim.getAttribute("_SWATCH")?.getNormalized()).toBe(false)
    expect(Array.from(prim.getAttribute("_SHADE")?.getArray() ?? [])).toEqual([128, 128, 128, 128, 128, 128])
    expect(prim.getAttribute("_SHADE")?.getNormalized()).toBe(true)
    expect(Array.from(prim.getAttribute("_AO")?.getArray() ?? [])).toEqual([200, 200, 200, 200, 200, 200])
    expect(prim.getAttribute("_AO")?.getNormalized()).toBe(true)
  })

  test("the written GLB is smaller than the unoptimized one", async () => {
    const plain = (await roundTrip(grid(12))).bytes
    const doc = grid(12)
    await optimize(doc, ctx())
    expect((await roundTrip(doc)).bytes).toBeLessThan(plain / 2)
  })

  test("a skinned document keeps POSITION in float", async () => {
    const doc = await (await gltfIO()).read(join(FIXTURES, "fixture-material/villager.glb"))
    const box = getBounds(doc.getRoot().listScenes()[0] as never)
    await optimize(doc, ctx())
    const back = (await roundTrip(doc)).doc
    for (const prim of prims(back))
      expect(prim.getAttribute("POSITION")?.getArray()).toBeInstanceOf(Float32Array)
    expect(
      back
        .getRoot()
        .listSkins()[0]
        ?.listJoints()
        .map((j) => j.getName()),
    ).toEqual(["Hip", "Chest"])
    expect(getBounds(back.getRoot().listScenes()[0] as never)).toEqual(box)
  })

  test("position bits: at least 14, more for large pieces, float past 16", () => {
    expect(positionBits(triangles(quad(20, [3, 3])))).toBe(14)
    expect(positionBits(triangles(quad(600, [3, 3])))).toBe(16)
    expect(positionBits(triangles(quad(2000, [3, 3])))).toBeUndefined()
  })
})

describe("optimize: simplify", () => {
  test("runs only when the override asks", async () => {
    const plain = grid(8)
    await optimize(plain, ctx())
    expect(tris(plain)).toBe(128)
    const asked = grid(8)
    await optimize(asked, ctx({ simplify: 0.25 }))
    expect(tris(asked)).toBeLessThan(128)
    expect(tris(asked)).toBeGreaterThan(0)
  })

  test("a ratio outside (0, 1) is rejected", () => {
    expect(simplifyRatio(undefined)).toBeUndefined()
    expect(simplifyRatio({ simplify: 0.5 })).toBe(0.5)
    expect(() => simplifyRatio({ simplify: 1.5 })).toThrow("expected a ratio in (0, 1)")
    expect(() => simplifyRatio({ simplify: "half" })).toThrow("expected a ratio in (0, 1)")
  })
})
