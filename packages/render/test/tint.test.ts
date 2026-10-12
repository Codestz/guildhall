import { describe, expect, test } from "bun:test"
import { PALETTE, tintColours } from "@guildhall/assets"
import {
  type BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Uint8BufferAttribute,
} from "three"
import { recolour, recolourPiece, swatchMapKey } from "../src/tint.ts"

const [A, B, C] = [PALETTE.swatches[1]!.id, PALETTE.swatches[2]!.id, PALETTE.swatches[3]!.id]
const SWATCH = [A, B, A]
const SHADE = [100, 128, 160]
const AO = [255, 128, 40]

/** A three-vertex piece as GLTFLoader hands it over: byte COLOR_0 (rgba), `_swatch`, normalized `_shade`/`_ao`. */
function piece(opts: { ao?: boolean } = {}): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  g.setAttribute("color", new Uint8BufferAttribute(new Uint8Array(12).fill(200), 4, true))
  g.setAttribute("_swatch", new Uint8BufferAttribute(Uint8Array.from(SWATCH), 1))
  g.setAttribute("_shade", new Uint8BufferAttribute(Uint8Array.from(SHADE), 1, true))
  if (opts.ao) g.setAttribute("_ao", new Uint8BufferAttribute(Uint8Array.from(AO), 1, true))
  return g
}

const rgbOf = (g: BufferGeometry): number[] => {
  const c = g.getAttribute("color")
  return Array.from({ length: c.count }, (_, v) => [c.getX(v), c.getY(v), c.getZ(v)]).flat()
}

const expectClose = (actual: number[], expected: ArrayLike<number>) => {
  expect(actual.length).toBe(expected.length)
  // COLOR_0 is bytes: one byte step of rounding.
  for (const [i, c] of actual.entries())
    expect(Math.abs(c - (expected[i] as number))).toBeLessThanOrEqual(0.5 / 255 + 1e-9)
}

describe("swatchMapKey", () => {
  test("sorts pairs by source, whatever the key order", () => {
    expect(swatchMapKey({ 9: 1, 2: 5 })).toBe("2>5;9>1")
    expect(swatchMapKey({ 2: 5, 9: 1 })).toBe(swatchMapKey({ 9: 1, 2: 5 }))
  })

  test("leaves identity pairs out, so an all-identity map is the empty key", () => {
    expect(swatchMapKey({ 3: 3, 2: 5 })).toBe("2>5")
    expect(swatchMapKey({ 3: 3 })).toBe("")
    expect(swatchMapKey({})).toBe("")
  })
})

describe("recolour", () => {
  test("the identity map gives the geometry itself", () => {
    const g = piece()
    expect(recolour(g, {})).toBe(g)
    expect(recolour(g, { [A]: A })).toBe(g)
  })

  test("the same piece and an equal map hit the cache", () => {
    const g = piece()
    const first = recolour(g, { [A]: C, [B]: C })
    expect(recolour(g, { [B]: C, [A]: C, [C]: C })).toBe(first)
  })

  test("another map, or another piece with the same map, is another variant", () => {
    const g = piece()
    const toC = recolour(g, { [A]: C })
    expect(recolour(g, { [B]: C })).not.toBe(toC)
    expect(recolour(piece(), { [A]: C })).not.toBe(toC)
  })

  test("re-tints mapped swatches with each vertex's shade, keeping the rest and the alpha", () => {
    const variant = recolour(piece(), { [A]: C })
    const expected = tintColours(Uint8Array.from([C, B, C]), Uint8Array.from(SHADE), PALETTE)
    expectClose(rgbOf(variant), expected)
    const colour = variant.getAttribute("color")
    for (let v = 0; v < colour.count; v++) expect(colour.getW(v)).toBeCloseTo(200 / 255, 6)
  })

  test("applies _ao when the piece has it", () => {
    const variant = recolour(piece({ ao: true }), { [A]: C })
    const expected = tintColours(
      Uint8Array.from([C, B, C]),
      Uint8Array.from(SHADE),
      PALETTE,
      undefined,
      Uint8Array.from(AO),
    )
    expectClose(rgbOf(variant), expected)
  })

  test("leaves the source geometry untouched and keeps the colour format", () => {
    const g = piece()
    const variant = recolour(g, { [A]: C })
    expect(rgbOf(g).every((c) => c === 200 / 255)).toBe(true)
    const colour = variant.getAttribute("color") as BufferAttribute
    expect(colour.array).toBeInstanceOf(Uint8Array)
    expect(colour.itemSize).toBe(4)
    expect(colour.normalized).toBe(true)
    expect(variant.getAttribute("position")).toBeDefined()
  })

  test("a geometry without palette attributes is returned as is", () => {
    const g = piece()
    g.deleteAttribute("_swatch")
    expect(recolour(g, { [A]: C })).toBe(g)
  })
})

describe("recolourPiece", () => {
  test("swaps every mesh's geometry under the root for its variant", () => {
    const shared = piece()
    const root = new Group()
    const inner = new Group()
    inner.add(new Mesh(shared, new MeshBasicMaterial()))
    root.add(new Mesh(shared, new MeshBasicMaterial()), inner)
    recolourPiece(root, { [A]: C })
    const variant = recolour(shared, { [A]: C })
    const meshes: Mesh[] = []
    root.traverse((n) => {
      if (n instanceof Mesh) meshes.push(n)
    })
    expect(meshes).toHaveLength(2)
    for (const m of meshes) expect(m.geometry).toBe(variant)
  })
})
