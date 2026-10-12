import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Accessor, Document, type Material, type Primitive } from "@gltf-transform/core"
import { KHRTextureTransform } from "@gltf-transform/extensions"
import { type ColourMode, linearToSrgb, nearestSwatch, PALETTE, srgbToOklab } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { encode as encodeJpeg } from "jpeg-js"
import { packProblems } from "../src/config.ts"
import { encodePng } from "../src/png.ts"
import { gltfIO } from "../src/read.ts"
import {
  BAKE_WEIGHTS,
  bakePalette,
  decodeShade,
  encodeShade,
  MISS_THRESHOLD,
  SHADE_NEUTRAL,
} from "../src/sample.ts"
import { colour, decodeImage, PALETTE_MATERIAL, sourceMode } from "../src/stages/colour.ts"
import type { StageCtx } from "../src/stages/types.ts"
import { FIXTURES } from "./fixtures/env.ts"

const ctx = (mode: ColourMode, map?: Record<string, string>): StageCtx => ({
  pack: {
    id: "test",
    source: "test",
    vendor: "other",
    license: "CC0",
    include: [],
    colour: { mode, ...(map ? { map } : {}) },
    scale: { factor: 1 },
    pivot: "keep",
    rules: [],
  },
  source: { pack: "test", file: "/x.glb", source: "x.glb", name: "x", slug: "x", category: "prop", tags: [] },
  palette: PALETTE,
  raw: "/raw",
  library: "/library",
  log: log("test"),
  out: { slug: "x", kind: "static", flags: new Set(), swatches: new Set(), compose: {} as never },
})

/** The swatch the bake should choose for an 8-bit sRGB source colour. */
const expected = (rgb: [number, number, number]): number =>
  nearestSwatch(srgbToOklab([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]), PALETTE, BAKE_WEIGHTS).swatch.id

/** Linear RGB → 8-bit sRGB. */
const fromLinear = (lin: number[]): [number, number, number] =>
  lin.map((x) => Math.round(linearToSrgb(x) * 255)) as [number, number, number]

const prims = (doc: Document): Primitive[] =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
const array = (prim: Primitive, name: string) => Array.from(prim.getAttribute(name)?.getArray() ?? [])
/** The distinct _SWATCH ids of each face (two triangles per quad, in index order). */
function faceSwatches(prim: Primitive): number[][] {
  const swatch = array(prim, "_SWATCH")
  const idx = Array.from(prim.getIndices()?.getArray() ?? [])
  const faces: number[][] = []
  for (let f = 0; f < idx.length / 6; f++)
    faces.push([...new Set(idx.slice(f * 6, f * 6 + 6).map((v) => swatch[v] as number))])
  return faces
}

async function fixture(file: string, mode: ColourMode): Promise<{ doc: Document; c: StageCtx }> {
  const doc = await (await gltfIO()).read(join(FIXTURES, file))
  const c = ctx(mode)
  await colour(doc, c)
  return { doc, c }
}

/** A textured quad: 4 vertices, 2 triangles sharing the 1–3 edge, on a 1×n texture of `cells`. */
function quad(cells: [number, number, number][], uvs: number[], vertical = false): Document {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const n = cells.length
  const data = new Uint8Array(n * 4)
  for (const [i, c] of cells.entries()) data.set([...c, 255], i * 4)
  const image = encodePng({ width: vertical ? 1 : n, height: vertical ? n : 1, data })
  const tex = doc.createTexture("t").setMimeType("image/png").setImage(image)
  const mat = doc.createMaterial("m").setBaseColorTexture(tex)
  const acc = (
    type: Accessor["getType"] extends () => infer T ? T : never,
    array: Float32Array | Uint16Array,
  ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setMaterial(mat)
    .setIndices(acc("SCALAR", new Uint16Array([0, 1, 3, 1, 2, 3])))
    .setAttribute("POSITION", acc("VEC3", new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])))
    .setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(uvs)))
  doc.createScene().addChild(doc.createNode("q").setMesh(doc.createMesh("q").addPrimitive(prim)))
  return doc
}

/** An untextured box-ish triangle pair with per-vertex colours (normalized ubyte VEC4, like a converter writes). */
function vertexColoured(colours: [number, number, number][], factor?: Material): Document {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const rgba = new Uint8Array(colours.length * 4)
  for (const [i, c] of colours.entries()) rgba.set([...c, 255], i * 4)
  const pos = new Float32Array(colours.length * 3).map((_, i) => i % 7)
  const prim = doc
    .createPrimitive()
    .setMaterial(factor ?? doc.createMaterial("white"))
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buffer))
    .setAttribute(
      "COLOR_0",
      doc.createAccessor().setType("VEC4").setArray(rgba).setNormalized(true).setBuffer(buffer),
    )
  doc.createScene().addChild(doc.createNode("v").setMesh(doc.createMesh("v").addPrimitive(prim)))
  return doc
}

describe("fixtures bake to the expected swatches", () => {
  test("atlas crate: each face reads its own texel of the gradient", async () => {
    const { doc, c } = await fixture("fixture-atlas/crate.glb", "atlas")
    // make.ts: face f reads texel x = 2·(f % 4), y = 2·⌊f / 4⌋ of the 8×8 gradient (120 + 8x, 70 + 6y, 40).
    const want = [0, 1, 2, 3, 4, 5].map((f) => [
      expected([120 + 16 * (f % 4), 70 + 12 * Math.floor(f / 4), 40]),
    ])
    const prim = prims(doc)[0] as Primitive
    expect(faceSwatches(prim)).toEqual(want)
    expect([...c.out.swatches].sort()).toEqual([...new Set(want.flat())].sort())
    expect(c.out.flags.has("texture-lost")).toBe(false)
  })

  test("colormap wall: faces alternate between the beige and the brown cell", async () => {
    const { doc, c } = await fixture("fixture-colormap/wall-door.glb", "colormap")
    const [beige, brown] = [expected([200, 190, 170]), expected([120, 80, 50])]
    expect(faceSwatches(prims(doc)[0] as Primitive)).toEqual([
      [beige],
      [brown],
      [beige],
      [brown],
      [beige],
      [brown],
    ])
    expect(c.out.flags.size).toBe(0)
  })

  test("material bush: the leaves and the berries bake from their base-colour factors", async () => {
    const { doc, c } = await fixture("fixture-material/bush.glb", "material")
    const [leaves, berries] = prims(doc)
    expect(new Set(array(leaves as Primitive, "_SWATCH"))).toEqual(
      new Set([expected(fromLinear([0.07, 0.12, 0.05]))]),
    )
    expect(new Set(array(berries as Primitive, "_SWATCH"))).toEqual(
      new Set([expected(fromLinear([0.37, 0.02, 0.03]))]),
    )
    expect(PALETTE.swatches[array(leaves as Primitive, "_SWATCH")[0] as number]?.group).toBe("foliage")
    expect(c.out.swatches.size).toBe(2)
  })

  test("vertex colours: COLOR_0 is the source, times the material factor", async () => {
    // COLOR_0 is linear: the bytes 128/30/30 are linear 0.5/0.12/0.12.
    const red: [number, number, number] = [128, 30, 30]
    const green: [number, number, number] = [20, 50, 10]
    const doc = vertexColoured([red, red, red, green, green, green])
    await colour(doc, ctx("material"))
    const want = [red, green].map((c) => expected(fromLinear(c.map((x) => x / 255))))
    expect(array(prims(doc)[0] as Primitive, "_SWATCH")).toEqual([
      ...Array(3).fill(want[0]),
      ...Array(3).fill(want[1]),
    ])

    const white: [number, number, number] = [255, 255, 255]
    const tinted = vertexColoured([white, white, white])
    ;(tinted.getRoot().listMaterials()[0] as Material).setBaseColorFactor([0.2, 0.05, 0.05, 1])
    await colour(tinted, ctx("material"))
    expect(new Set(array(prims(tinted)[0] as Primitive, "_SWATCH"))).toEqual(
      new Set([expected(fromLinear([0.2, 0.05, 0.05]))]),
    )
  })
})

describe("output", () => {
  test("no material, texture or image survives but the one palette material", async () => {
    const io = await gltfIO()
    for (const [file, mode] of [
      ["fixture-atlas/crate.glb", "atlas"],
      ["fixture-colormap/wall-door.glb", "colormap"],
      ["fixture-material/bush.glb", "material"],
    ] as const) {
      const { doc } = await fixture(file, mode)
      const back = (await io.readBinary(await io.writeBinary(doc))).getRoot()
      expect(back.listTextures()).toHaveLength(0)
      expect(back.listMaterials().map((m) => m.getName())).toEqual([PALETTE_MATERIAL])
      for (const p of back.listMeshes().flatMap((m) => m.listPrimitives())) {
        expect(p.getMaterial()?.getName()).toBe(PALETTE_MATERIAL)
        expect(p.listSemantics().filter((s) => s.startsWith("TEXCOORD_"))).toEqual([])
      }
    }
  })

  test("COLOR_0 is linear float VEC3, _SWATCH a uint8 scalar, _SHADE a normalized uint8 scalar", async () => {
    const io = await gltfIO()
    const { doc } = await fixture("fixture-atlas/crate.glb", "atlas")
    const prim = (await io.readBinary(await io.writeBinary(doc)))
      .getRoot()
      .listMeshes()[0]
      ?.listPrimitives()[0]
    const color = prim?.getAttribute("COLOR_0")
    const swatch = prim?.getAttribute("_SWATCH")
    const shade = prim?.getAttribute("_SHADE")
    expect([color?.getType(), color?.getComponentType()]).toEqual(["VEC3", Accessor.ComponentType.FLOAT])
    expect([swatch?.getType(), swatch?.getComponentType(), swatch?.getNormalized()]).toEqual([
      "SCALAR",
      Accessor.ComponentType.UNSIGNED_BYTE,
      false,
    ])
    expect([shade?.getType(), shade?.getComponentType(), shade?.getNormalized()]).toEqual([
      "SCALAR",
      Accessor.ComponentType.UNSIGNED_BYTE,
      true,
    ])
    const count = prim?.getAttribute("POSITION")?.getCount()
    expect([color?.getCount(), swatch?.getCount(), shade?.getCount()]).toEqual([count, count, count])
    for (const id of Array.from(swatch?.getArray() ?? [])) expect(PALETTE.swatches[id]).toBeDefined()
  })
})

describe("seams and gradients", () => {
  test("a vertex shared by faces on two swatches is split; neither face bleeds (plan R2)", async () => {
    // Shared vertices 1 and 3 sit exactly on the cell boundary u = 0.5; vertex 0 is in cell 0, vertex 2 in cell 1.
    const uvs = [0.1, 0.5, 0.5, 0.1, 0.9, 0.5, 0.5, 0.9]
    const doc = quad(
      [
        [79, 122, 58],
        [191, 60, 60],
      ],
      uvs,
    )
    await colour(doc, ctx("colormap"))
    const prim = prims(doc)[0] as Primitive
    expect(prim.getAttribute("POSITION")?.getCount()).toBe(6)
    const idx = Array.from(prim.getIndices()?.getArray() ?? [])
    const swatch = array(prim, "_SWATCH")
    const tri = (t: number) => new Set(idx.slice(t * 3, t * 3 + 3).map((v) => swatch[v]))
    expect(tri(0)).toEqual(new Set([expected([79, 122, 58])]))
    expect(tri(1)).toEqual(new Set([expected([191, 60, 60])]))
  })

  test("one swatch keeps its vertices welded", async () => {
    const doc = quad([[79, 122, 58]], [0, 0, 1, 0, 1, 1, 0, 1])
    await colour(doc, ctx("atlas"))
    expect(prims(doc)[0]?.getAttribute("POSITION")?.getCount()).toBe(4)
  })

  test("a gradient within one swatch keeps its variation as _SHADE", async () => {
    // A vertical ramp of one hue: v = 0 dark, v = 1 light.
    const cells: [number, number, number][] = [
      [92, 56, 38],
      [110, 76, 51],
      [130, 96, 66],
    ]
    const doc = quad(cells, [0, 0, 1, 0, 1, 1, 0, 1], true)
    await colour(doc, ctx("atlas"))
    const prim = prims(doc)[0] as Primitive
    const shade = array(prim, "_SHADE")
    const pos = array(prim, "POSITION")
    const shadeAt = (y: number) => shade.filter((_, i) => pos[i * 3 + 1] === y)
    expect(Math.max(...shadeAt(0))).toBeLessThan(Math.min(...shadeAt(1)))
  })
})

describe("per primitive, map and misses", () => {
  test("a piece mixing a textured and an untextured primitive bakes each its own way", async () => {
    const doc = quad([[200, 190, 170]], [0, 0, 1, 0, 1, 1, 0, 1])
    const mesh = doc.getRoot().listMeshes()[0]
    const plain = (prims(doc)[0] as Primitive)
      .clone()
      .setMaterial(doc.createMaterial("red").setBaseColorFactor([0.5, 0.04, 0.04, 1]))
    plain.setAttribute("TEXCOORD_0", null)
    mesh?.addPrimitive(plain)
    await colour(doc, ctx("atlas"))
    const [a, b] = prims(doc)
    expect(new Set(array(a as Primitive, "_SWATCH"))).toEqual(new Set([expected([200, 190, 170])]))
    expect(new Set(array(b as Primitive, "_SWATCH"))).toEqual(
      new Set([expected(fromLinear([0.5, 0.04, 0.04]))]),
    )
  })

  test("texture-average gives one colour a face and flags texture-lost", async () => {
    const doc = quad(
      [
        [79, 122, 58],
        [191, 60, 60],
      ],
      [0.1, 0.5, 0.5, 0.1, 0.9, 0.5, 0.5, 0.9],
    )
    const c = ctx("texture-average")
    await colour(doc, c)
    expect(c.out.flags.has("texture-lost")).toBe(true)
    expect(doc.getRoot().listTextures()).toHaveLength(0)
  })

  test("colour.map pins a source hex to a named swatch and clears the miss", async () => {
    const magenta: [number, number, number] = [255, 0, 255]
    const missed = ctx("material")
    await colour(vertexColoured([magenta, magenta, magenta]), missed)
    expect(missed.out.flags.has("colour-miss")).toBe(true)

    const pinned = ctx("material", { "#FF00FF": "purple" })
    const doc = vertexColoured([magenta, magenta, magenta])
    await colour(doc, pinned)
    expect(pinned.out.flags.has("colour-miss")).toBe(false)
    const purple = PALETTE.swatches.find((s) => s.name === "purple")?.id
    expect(new Set(array(prims(doc)[0] as Primitive, "_SWATCH"))).toEqual(new Set([purple]))
  })

  test("a map naming an unknown swatch is an error", () => {
    expect(() => bakePalette(new Float32Array(3), PALETTE, { "#000000": "nope" })).toThrow(
      'unknown swatch "nope"',
    )
  })
})

describe("bakePalette", () => {
  test("a palette colour bakes to itself: neutral shade, no miss, COLOR_0 equal to the swatch", () => {
    const s = PALETTE.swatches[22]!
    const lin = s.srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const bake = bakePalette(Float32Array.from(lin), PALETTE)
    expect(bake.swatch[0]).toBe(s.id)
    expect(bake.shade[0]).toBe(SHADE_NEUTRAL)
    expect(bake.misses).toBe(0)
    for (let k = 0; k < 3; k++) expect(bake.rgb[k]).toBeCloseTo(lin[k]!, 3)
  })

  test("shade encoding: ±0.2 spans the byte, 128 is neutral, round-trips", () => {
    expect([encodeShade(-0.2), encodeShade(0), encodeShade(0.2), encodeShade(1)]).toEqual([1, 128, 255, 255])
    expect(decodeShade(encodeShade(0.07))).toBeCloseTo(0.07, 2)
  })

  test("the miss threshold is exposed and applies to the baked (shaded) colour", () => {
    expect(MISS_THRESHOLD).toBeGreaterThan(0)
    const s = PALETTE.swatches[22]!
    const lin = s.srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const bake = bakePalette(Float32Array.from([1, 0, 1, ...lin]), PALETTE)
    expect(bake.misses).toBe(1)
    expect(bake.missed).toEqual(["#ff00ff"])
  })
})

describe("texture sources", () => {
  const leaf: [number, number, number] = [79, 122, 58]
  const white: [number, number, number] = [250, 250, 250]
  /** The quad's texture replaced by `image` (keeps its UVs and material). */
  const retexture = (doc: Document, image: Uint8Array, mime: string): Material => {
    const material = doc.getRoot().listMaterials()[0] as Material
    material.getBaseColorTexture()?.setImage(image).setMimeType(mime)
    return material
  }

  test("a JPEG base-colour texture is decoded and sampled, not dropped to the material colour", async () => {
    const pixels = new Uint8Array(8 * 8 * 4)
    for (let i = 0; i < 64; i++) pixels.set([...leaf, 255], i * 4)
    const jpeg = Uint8Array.from(encodeJpeg({ width: 8, height: 8, data: pixels }, 100).data)
    const decoded = decodeImage(jpeg)
    expect(decoded?.width).toBe(8)
    const doc = quad([[0, 0, 0]], [0, 0, 1, 0, 1, 1, 0, 1])
    retexture(doc, jpeg, "image/jpeg")
    const c = ctx("atlas")
    await colour(doc, c)
    const got = Array.from(decoded?.data.subarray(0, 3) ?? []) as [number, number, number]
    expect(new Set(array(prims(doc)[0] as Primitive, "_SWATCH"))).toEqual(new Set([expected(got)]))
    expect(c.out.flags.has("texture-lost")).toBe(false)
  })

  test("decodeImage: neither PNG nor JPEG is null", () => {
    expect(decodeImage(Uint8Array.of(1, 2, 3, 4))).toBeNull()
    expect(decodeImage(null)).toBeNull()
  })

  // Texel 0 is leaf, texel 1 the card's background. Face 1 sees both; face 2 sees only the background.
  const card = (alphaMode: "MASK" | "OPAQUE"): Document => {
    const doc = quad([leaf, white], [0, 0, 0.6, 0, 1, 1, 0.6, 1])
    const data = new Uint8Array([...leaf, 255, ...white, 0])
    retexture(doc, encodePng({ width: 2, height: 1, data }), "image/png").setAlphaMode(alphaMode)
    return doc
  }

  test("a MASK leaf card averages its visible texels only: every face bakes to the leaf", async () => {
    const doc = card("MASK")
    const c = ctx("texture-average")
    await colour(doc, c)
    expect(new Set(array(prims(doc)[0] as Primitive, "_SWATCH"))).toEqual(new Set([expected(leaf)]))
    expect(c.out.flags.has("texture-lost")).toBe(true)
  })

  test("without MASK the transparent background still counts (the control)", async () => {
    const doc = card("OPAQUE")
    await colour(doc, ctx("texture-average"))
    expect(faceSwatches(prims(doc)[0] as Primitive)[0]).not.toEqual([expected(leaf)])
  })

  test("KHR_texture_transform leaves extensionsUsed once no texture is left; kept while one is", async () => {
    const used = async (mode: ColourMode) => {
      const doc = quad([leaf], [0, 0, 1, 0, 1, 1, 0, 1])
      const transform = doc.createExtension(KHRTextureTransform)
      doc
        .getRoot()
        .listMaterials()[0]
        ?.getBaseColorTextureInfo()
        ?.setExtension("KHR_texture_transform", transform.createTransform().setScale([2, 2]))
      await colour(doc, ctx(mode))
      const json = await (await gltfIO()).writeJSON(doc)
      return json.json.extensionsUsed ?? []
    }
    expect(await used("atlas")).not.toContain("KHR_texture_transform")
    expect(await used("keep-texture")).toContain("KHR_texture_transform")
  })
})

describe("vertex mode", () => {
  test("reads like material: COLOR_0 times the factor, and a config may name it", async () => {
    const red: [number, number, number] = [128, 30, 30]
    const doc = vertexColoured([red, red, red])
    expect(sourceMode(prims(doc)[0] as Primitive, "vertex")).toBe("material")
    await colour(doc, ctx("vertex"))
    expect(new Set(array(prims(doc)[0] as Primitive, "_SWATCH"))).toEqual(
      new Set([expected(fromLinear(red.map((x) => x / 255)))]),
    )
    expect(packProblems({ ...ctx("vertex").pack, include: ["*.glb"] })).toEqual([])
  })
})
