import { describe, expect, test } from "bun:test"
import { Document, type Primitive } from "@gltf-transform/core"
import { PALETTE, type PackConfig } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { AO_DEFAULTS, ao, autoDistance, bakeAO, hemisphere, NEUTRAL_SHADE } from "../src/stages/ao.ts"
import type { StageCtx } from "../src/stages/types.ts"

interface Mesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/** A flat-shaded axis-aligned box (24 vertices, 12 triangles). */
function box(min: [number, number, number], max: [number, number, number]): Mesh {
  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const faces: { n: [number, number, number]; corners: [number, number, number][] }[] = [
    {
      n: [1, 0, 0],
      corners: [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
    },
    {
      n: [-1, 0, 0],
      corners: [
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
        [0, 0, 0],
      ],
    },
    {
      n: [0, 1, 0],
      corners: [
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
      ],
    },
    {
      n: [0, -1, 0],
      corners: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
    },
    {
      n: [0, 0, 1],
      corners: [
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
    },
    {
      n: [0, 0, -1],
      corners: [
        [1, 0, 0],
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
    },
  ]
  for (const { n, corners } of faces) {
    const base = pos.length / 3
    for (const c of corners) {
      for (let k = 0; k < 3; k++) pos.push(c[k] ? max[k] : min[k])
      nor.push(...n)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nor),
    indices: Uint32Array.from(idx),
  }
}

/** A unit-radius UV sphere resting on the ground: 2 × w × (h − 1) triangles. */
function sphere(w: number, h: number): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= h; j++)
    for (let i = 0; i <= w; i++) {
      const theta = (j / h) * Math.PI
      const phi = (i / w) * 2 * Math.PI
      pos.push(Math.sin(theta) * Math.cos(phi), 1 + Math.cos(theta), Math.sin(theta) * Math.sin(phi))
    }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i
      const b = a + w + 1
      if (j > 0) idx.push(a, a + 1, b)
      if (j < h - 1) idx.push(a + 1, b + 1, b)
    }
  const positions = Float32Array.from(pos)
  const normals = Float32Array.from(pos, (v, k) => (k % 3 === 1 ? v - 1 : v))
  return { positions, normals, indices: Uint32Array.from(idx) }
}

/** A one-primitive document; `baked` adds what the colour stage leaves behind. */
function docOf(mesh: Mesh, baked: boolean): { doc: Document; prim: Primitive } {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const attr = (type: "VEC3" | "VEC4" | "SCALAR", array: Float32Array | Uint8Array | Uint32Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const count = mesh.positions.length / 3
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", attr("VEC3", mesh.positions))
    .setAttribute("NORMAL", attr("VEC3", mesh.normals))
    .setIndices(attr("SCALAR", mesh.indices))
  if (baked)
    prim
      .setAttribute("COLOR_0", attr("VEC4", new Float32Array(count * 4).fill(0.5)))
      .setAttribute("_SWATCH", attr("SCALAR", new Uint8Array(count).fill(3)))
      .setAttribute("_SHADE", attr("SCALAR", new Uint8Array(count).fill(200)).setNormalized(true))
  doc.createScene().addChild(doc.createNode("piece").setMesh(doc.createMesh("piece").addPrimitive(prim)))
  return { doc, prim }
}

const ctx = (ao?: PackConfig["ao"]): StageCtx => ({
  pack: {
    id: "test",
    source: "test",
    vendor: "other",
    license: "CC0",
    include: [],
    colour: { mode: "material" },
    scale: { factor: 1 },
    pivot: "keep",
    rules: [],
    ...(ao === undefined ? {} : { ao }),
  },
  source: { pack: "test", file: "/x.glb", source: "x.glb", name: "x", slug: "x", category: "prop", tags: [] },
  palette: PALETTE,
  raw: "/raw",
  library: "/library",
  log: log("test"),
  out: { slug: "x", kind: "static", flags: new Set(), swatches: new Set(), compose: {} as never },
})

const array = (prim: Primitive, name: string) => Array.from(prim.getAttribute(name)?.getArray() ?? [])

describe("hemisphere", () => {
  test("gives unit directions above the surface", () => {
    const d = hemisphere(48)
    for (let i = 0; i < 48; i++) {
      expect(Math.hypot(d[i * 3] as number, d[i * 3 + 1] as number, d[i * 3 + 2] as number)).toBeCloseTo(1, 9)
      expect(d[i * 3 + 2] as number).toBeGreaterThan(0)
    }
  })
})

describe("autoDistance", () => {
  test("is a quarter of the bbox diagonal, clamped to [0.3, 2]", () => {
    expect(autoDistance(box([0, 0, 0], [2, 2, 1]).positions)).toBeCloseTo(0.75, 6)
    expect(autoDistance(box([0, 0, 0], [0.1, 0.1, 0.1]).positions)).toBe(0.3)
    expect(autoDistance(box([0, 0, 0], [20, 20, 20]).positions)).toBe(2)
  })
})

describe("bakeAO", () => {
  test("a box on the ground has darker bottom edges than top edges, and a fully dark underside", () => {
    const m = box([0, 0, 0], [1, 1, 1])
    const f = bakeAO(m.positions, m.normals, m.indices)
    const at = (pick: (y: number, ny: number) => boolean) =>
      Array.from(f).filter((_, v) => pick(m.positions[v * 3 + 1] as number, m.normals[v * 3 + 1] as number))
    const sideBottom = at((y, ny) => ny === 0 && y === 0)
    const sideTop = at((y, ny) => ny === 0 && y === 1)
    expect(Math.max(...sideBottom)).toBeLessThan(Math.min(...sideTop))
    expect(at((_, ny) => ny === 1)).toEqual([1, 1, 1, 1])
    for (const x of at((_, ny) => ny === -1)) expect(x).toBeCloseTo(1 - AO_DEFAULTS.strength, 6)
  })

  test("an open plane is unoccluded", () => {
    const m: Mesh = {
      positions: Float32Array.of(0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0),
      normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0),
      indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
    }
    expect(Array.from(bakeAO(m.positions, m.normals, m.indices))).toEqual([1, 1, 1, 1])
  })

  test("a lid above a floor darkens the floor beneath it", () => {
    const floor = box([-2, 0, -2], [2, 0.1, 2])
    const lid = box([-0.5, 0.3, -0.5], [0.5, 0.4, 0.5])
    const merged: Mesh = {
      positions: Float32Array.from([...floor.positions, ...lid.positions]),
      normals: Float32Array.from([...floor.normals, ...lid.normals]),
      indices: Uint32Array.from([...floor.indices, ...Array.from(lid.indices, (i) => i + 24)]),
    }
    const f = bakeAO(merged.positions, merged.normals, merged.indices, { distance: 1 })
    // Floor top face is vertices 8..11; its corners lie outside the lid's shadow, so add a probe under it.
    const probe = bakeAO(
      Float32Array.from([...merged.positions, 0, 0.1, 0]),
      Float32Array.from([...merged.normals, 0, 1, 0]),
      merged.indices,
      { distance: 1 },
    )
    expect(probe[48] as number).toBeLessThan(0.7)
    expect(f[8] as number).toBeGreaterThan(probe[48] as number)
  })

  test("strength 0 and rays 0 leave every vertex at 1", () => {
    const m = box([0, 0, 0], [1, 1, 1])
    expect(Array.from(bakeAO(m.positions, m.normals, m.indices, { strength: 0 })).every((x) => x === 1)).toBe(
      true,
    )
    expect(Array.from(bakeAO(m.positions, m.normals, m.indices, { rays: 0 })).every((x) => x === 1)).toBe(
      true,
    )
  })
})

describe("ao stage", () => {
  test("multiplies _SHADE and darkens COLOR_0 rgb (alpha kept) after colour has run", async () => {
    const { doc, prim } = docOf(box([0, 0, 0], [1, 1, 1]), true)
    await ao(doc, ctx())
    const shade = array(prim, "_SHADE")
    const colour = array(prim, "COLOR_0")
    // vertex 12 is on the underside (fully occluded), vertex 8 on the top (open).
    expect(shade[8]).toBe(200)
    expect(shade[12]).toBe(Math.round(200 * (1 - AO_DEFAULTS.strength)))
    expect(colour.slice(32, 36)).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(colour[48] as number).toBeCloseTo(0.5 * (1 - AO_DEFAULTS.strength), 6)
    expect(colour[51]).toBe(0.5)
    expect(array(prim, "_SWATCH").every((s) => s === 3)).toBe(true)
  })

  test("creates only _SHADE when colour has not run", async () => {
    const { doc, prim } = docOf(box([0, 0, 0], [1, 1, 1]), false)
    await ao(doc, ctx())
    const shade = prim.getAttribute("_SHADE")
    expect(shade?.getNormalized()).toBe(true)
    expect(shade?.getArray()).toBeInstanceOf(Uint8Array)
    expect(array(prim, "_SHADE")[8]).toBe(NEUTRAL_SHADE)
    expect(array(prim, "_SHADE")[12]).toBeLessThan(NEUTRAL_SHADE)
    expect(prim.getAttribute("COLOR_0")).toBeNull()
  })

  test("honours the node transform: a box lifted off the ground keeps a lit underside", async () => {
    const { doc, prim } = docOf(box([0, 0, 0], [1, 1, 1]), true)
    doc.getRoot().listNodes()[0]?.setTranslation([0, 5, 0])
    await ao(doc, ctx())
    expect(array(prim, "_SHADE")[12]).toBe(200)
  })

  test("ao: false leaves the piece untouched", async () => {
    const { doc, prim } = docOf(box([0, 0, 0], [1, 1, 1]), true)
    await ao(doc, ctx(false))
    expect(array(prim, "_SHADE").every((s) => s === 200)).toBe(true)
  })

  test("the same input bakes identical output", async () => {
    const runs = await Promise.all(
      [0, 1].map(async () => {
        const { doc, prim } = docOf(sphere(20, 16), true)
        await ao(doc, ctx({ rays: 32 }))
        return [array(prim, "_SHADE"), array(prim, "COLOR_0")]
      }),
    )
    expect(runs[0]).toEqual(runs[1] as number[][])
  })

  test("stays inside budget: a 1k-tri piece bakes in well under a second", async () => {
    const { doc } = docOf(sphere(25, 21), true)
    const t = performance.now()
    await ao(doc, ctx())
    expect(performance.now() - t).toBeLessThan(1000)
  })
})
