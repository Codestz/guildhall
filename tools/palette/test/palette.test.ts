import { describe, expect, test } from "bun:test"
import { Document } from "@gltf-transform/core"
import {
  hexToSrgb,
  type Lab,
  loadPalette,
  type PackConfig,
  srgbToLinear,
  srgbToOklab,
} from "@guildhall/assets"
import { kmeans, labHex, type Point, RAMP_WEIGHTS, rampTones } from "../src/cluster.ts"
import { type Colours, documentColours, hexOf } from "../src/extract.ts"
import { missReport } from "../src/miss.ts"

const pack = (factor: number): PackConfig => ({
  id: "test",
  source: "test",
  vendor: "other",
  license: "CC0",
  include: [],
  colour: { mode: "material" },
  scale: { factor },
  pivot: "keep",
  rules: [],
})

/** Two flat-coloured right triangles: legs 1×1 (area ½) in `a`, legs 2×1 (area 1) in `b`. */
function twoMaterials(a: string, b: string, translate = 0): Document {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const tri = (legX: number, colour: string) =>
    doc
      .createPrimitive()
      .setMaterial(doc.createMaterial(colour).setBaseColorFactor([...hexToSrgb(colour).map(srgbToLinear), 1]))
      .setAttribute(
        "POSITION",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array([0, 0, 0, legX, 0, 0, 0, 1, 0]))
          .setBuffer(buffer),
      )
  const mesh = doc.createMesh("m").addPrimitive(tri(1, a)).addPrimitive(tri(2, b))
  doc.createScene().addChild(doc.createNode("n").setMesh(mesh).setTranslation([translate, 0, 0]))
  return doc
}

const PALETTE_JSON = {
  version: 1,
  status: "test",
  groups: ["g"],
  swatches: [
    { id: 0, name: "red-dark", hex: "#801010", group: "g", ramp: "red", tone: "dark" },
    { id: 1, name: "red", hex: "#c02020", group: "g", ramp: "red", tone: "base" },
    { id: 2, name: "red-light", hex: "#f04040", group: "g", ramp: "red", tone: "light" },
  ],
  biomes: {},
}

describe("extract", () => {
  test("hexOf rounds linear RGB to the sRGB hex the bake keys on", () => {
    expect(hexOf(...(hexToSrgb("#73eddd").map(srgbToLinear) as [number, number, number]))).toBe("#73eddd")
    expect(hexOf(-1, 2, 0)).toBe("#00ff00")
  })

  test("each colour is weighted by the area that wears it, after the pack factor", () => {
    const colours = documentColours(twoMaterials("#ff0000", "#0000ff"), pack(2))
    // factor 2 scales areas by 4: ½ → 2 and 1 → 4.
    expect(colours.get("#ff0000")).toBeCloseTo(2, 6)
    expect(colours.get("#0000ff")).toBeCloseTo(4, 6)
    expect(colours.size).toBe(2)
  })

  test("a node translation moves the piece but does not change its areas", () => {
    const colours = documentColours(twoMaterials("#ff0000", "#0000ff", 10), pack(1))
    expect(colours.get("#ff0000")).toBeCloseTo(0.5, 6)
  })

  test("adds into an existing map, so packs sum piece by piece", () => {
    const into: Colours = new Map([["#ff0000", 1]])
    documentColours(twoMaterials("#ff0000", "#0000ff"), pack(1), into)
    expect(into.get("#ff0000")).toBeCloseTo(1.5, 6)
  })
})

describe("missReport", () => {
  const palette = loadPalette(PALETTE_JSON)

  test("a swatch's own colour bakes onto it: no miss, no drift", () => {
    const report = missReport(new Map([["#c02020", 3]]), palette)
    expect(report).toMatchObject({ area: 3, missed: 0, rate: 0, hexes: [] })
    expect(report.drift).toBeLessThan(0.005)
  })

  test("a colour far from every swatch misses with its whole area", () => {
    const report = missReport(
      new Map([
        ["#c02020", 1],
        ["#20c020", 3],
      ]),
      palette,
    )
    expect(report.rate).toBeCloseTo(0.75, 6)
    expect(report.hexes).toEqual([{ hex: "#20c020", area: 3 }])
  })

  test("no colours: rate and drift are zero", () => {
    expect(missReport(new Map(), palette)).toMatchObject({ area: 0, rate: 0, drift: 0 })
  })
})

describe("kmeans", () => {
  const lab = (hex: string): Lab => srgbToOklab(hexToSrgb(hex))
  const points: Point[] = [
    { lab: lab("#2a8439"), weight: 3 },
    { lab: lab("#61a93d"), weight: 2 },
    { lab: lab("#4a9a3a"), weight: 1 },
    { lab: lab("#2581bf"), weight: 2 },
    { lab: lab("#658ed7"), weight: 1 },
  ]

  test("separates two hue families, heaviest cluster first", () => {
    const clusters = kmeans(points, 2, { seed: 1, weights: RAMP_WEIGHTS })
    expect(clusters.map((c) => [...c.members].sort())).toEqual([
      [0, 1, 2],
      [3, 4],
    ])
    expect(clusters.map((c) => c.weight)).toEqual([6, 3])
  })

  test("is deterministic for one seed", () => {
    const a = kmeans(points, 3, { seed: 7, weights: RAMP_WEIGHTS })
    const b = kmeans(points, 3, { seed: 7, weights: RAMP_WEIGHTS })
    expect(a).toEqual(b)
  })

  test("never makes more clusters than there are points", () => {
    expect(kmeans(points.slice(0, 2), 5, { seed: 1, weights: RAMP_WEIGHTS })).toHaveLength(2)
    expect(kmeans([], 3, { seed: 1, weights: RAMP_WEIGHTS })).toEqual([])
  })

  test("rampTones orders a cluster dark → base → light", () => {
    const [greens] = kmeans(points, 2, { seed: 1, weights: RAMP_WEIGHTS })
    const tones = rampTones(points, greens!)
    expect(tones.dark[0]).toBeLessThan(tones.base[0])
    expect(tones.base[0]).toBeLessThan(tones.light[0])
  })

  test("labHex round-trips an sRGB colour", () => {
    expect(labHex(lab("#f79945"))).toBe("#f79945")
  })
})
