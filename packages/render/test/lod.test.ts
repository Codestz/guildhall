import { beforeAll, describe, expect, test } from "bun:test"
import {
  BufferAttribute,
  type BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from "three"
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { createStaticBatch } from "../src/batch.ts"
import { batchGeometry } from "../src/batchGeometry.ts"
import { LodBatchedMesh } from "../src/batchMesh.ts"
import { DETAIL_FADE_PX, DETAIL_RADIUS, fadeWeight, SHELL, SWAP_PX, screenRadius } from "../src/lod.ts"
import { FADE_STEPS, ID_BITS, inCode, keeps, outCode, packDraw, shrinkCode } from "../src/lodFade.ts"
import {
  lodError,
  shellGeometry,
  simplifierReady,
  simplifyGeometry,
  splitCards,
  surfaceArea,
} from "../src/lodGeometry.ts"

beforeAll(() => simplifierReady)

const tris = (g: BufferGeometry) => (g.index?.count ?? 0) / 3

/**
 * A batch-format sphere (~450 tris), welded as the import welds: the top half swatch 1, the bottom
 * half swatch 2, split along the equator where they meet.
 */
function twoToneSphere(): BufferGeometry {
  const sphere = new SphereGeometry(1, 16, 16).toNonIndexed()
  sphere.deleteAttribute("uv")
  const position = sphere.getAttribute("position")
  const swatch = new Uint8Array(position.count)
  const colour = new Float32Array(position.count * 3)
  for (let t = 0; t < position.count; t += 3) {
    const top = position.getY(t) + position.getY(t + 1) + position.getY(t + 2) >= 0
    for (let k = t; k < t + 3; k++) {
      swatch[k] = top ? 1 : 2
      colour.set(top ? [1, 0, 0] : [0, 0, 1], k * 3)
    }
  }
  sphere.setAttribute("color", new BufferAttribute(colour, 3))
  sphere.setAttribute("_swatch", new BufferAttribute(swatch, 1))
  return batchGeometry(new Mesh(mergeVertices(sphere)))
}

describe("fadeWeight", () => {
  test("a weight runs from 0 above the band to 1 below it, linearly between", () => {
    expect(fadeWeight(2, [0.5, 1])).toBe(0)
    expect(fadeWeight(0.75, [0.5, 1])).toBe(0.5)
    expect(fadeWeight(0.2, [0.5, 1])).toBe(1)
  })
})

describe("fade codes", () => {
  test("the two sides of a crossfade cover every pixel exactly once, in the weight's share", () => {
    for (const w of [0.1, 0.5, 0.9]) {
      let coarse = 0
      for (let k = 0; k < 1000; k++) {
        const d = (k + 0.5) / 1000
        const a = keeps(inCode(w), d)
        const b = keeps(outCode(w), d)
        expect(a !== b).toBe(true)
        if (a) coarse++
      }
      expect(coarse / 1000).toBeCloseTo(w, 1)
    }
  })

  test("no weight is drawn whole; the instance id survives the packing", () => {
    expect(outCode(0)).toBe(0)
    expect(inCode(1)).toBe(FADE_STEPS)
    expect(shrinkCode(1)).toBe(0)
    expect(packDraw(12345, outCode(0.5)) & ((1 << ID_BITS) - 1)).toBe(12345)
    expect(packDraw(12345, shrinkCode(0.5)) >>> ID_BITS).toBe(shrinkCode(0.5))
  })
})

describe("screenRadius", () => {
  test("halves with twice the distance and is infinite from inside", () => {
    const near = screenRadius(1, 10, 2, 1000)
    expect(near).toBe(100)
    expect(screenRadius(1, 20, 2, 1000)).toBe(near / 2)
    expect(screenRadius(1, 0.5, 2, 1000)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("simplifyGeometry", () => {
  test("cuts the triangles toward the ratio and keeps the batch format", () => {
    const sphere = twoToneSphere()
    const coarse = simplifyGeometry(sphere, { ratio: 0.25, error: 0.2 })
    expect(tris(coarse)).toBeLessThan(tris(sphere) * 0.5)
    for (const name of ["position", "normal", "color", "_swatch", "_shade", "_ao"])
      expect(coarse.getAttribute(name)).toBeDefined()
  })

  test("records how far the coarser copy strays, in the geometry's own metres", () => {
    const sphere = twoToneSphere()
    const coarse = simplifyGeometry(sphere, { ratio: 0.1, error: 0.2 })
    expect(lodError(coarse)).toBeGreaterThan(0)
    expect(lodError(coarse)).toBeLessThan(0.2 * 2 + 1e-6)
    expect(lodError(sphere)).toBe(0)
  })

  test("never bleeds a swatch: every triangle stays one swatch, and both swatches stay", () => {
    const coarse = simplifyGeometry(twoToneSphere(), { ratio: 0.02, error: 1 })
    const swatch = coarse.getAttribute("_swatch")
    const index = coarse.index!
    const seen = new Set<number>()
    for (let t = 0; t < index.count; t += 3) {
      const corners = [0, 1, 2].map((k) => swatch.getX(index.getX(t + k)))
      expect(new Set(corners).size).toBe(1)
      seen.add(corners[0]!)
    }
    expect([...seen].sort()).toEqual([1, 2])
  })

  test("keeps the border between two swatches where it was: no colour region grows into another", () => {
    const coarse = simplifyGeometry(twoToneSphere(), { ratio: 0.02, error: 1 })
    const position = coarse.getAttribute("position")
    const swatch = coarse.getAttribute("_swatch")
    const at = new Map<string, { y: number; swatches: Set<number> }>()
    for (let v = 0; v < position.count; v++) {
      const key = [position.getX(v), position.getY(v), position.getZ(v)].map((c) => c.toFixed(4)).join()
      const entry = at.get(key) ?? { y: position.getY(v), swatches: new Set<number>() }
      at.set(key, entry)
      entry.swatches.add(swatch.getX(v))
    }
    // Where the two swatches meet is still the equator, simplified along itself only.
    const border = [...at.values()].filter((e) => e.swatches.size === 2)
    expect(border.length).toBeGreaterThanOrEqual(3)
    expect(border.every((e) => Math.abs(e.y) < 1e-4)).toBe(true)
  })

  test("a two-sided card keeps both sides", () => {
    // A plane and its reversed twin, as a two-sided leaf is modelled.
    const plane = new PlaneGeometry(1, 1, 8, 8)
    const index = Array.from(plane.index!.array)
    const reversed: number[] = []
    for (let t = 0; t < index.length; t += 3) reversed.push(index[t + 2]!, index[t + 1]!, index[t]!)
    plane.setIndex([...index, ...reversed])
    const card = batchGeometry(new Mesh(plane))
    const coarse = simplifyGeometry(card, { ratio: 0.1, error: 0.1 })
    expect(surfaceArea(coarse)).toBeCloseTo(surfaceArea(card), 3)
    expect(tris(coarse)).toBeLessThan(tris(card))
  })
})

describe("splitCards", () => {
  test("pairs a triangle with its reversed twin and leaves one-sided ones alone", () => {
    const remap = Uint32Array.from([0, 1, 2, 3])
    const { single, cards } = splitCards(Uint32Array.from([0, 1, 2, 2, 1, 0, 0, 2, 3]), remap)
    expect(Array.from(cards)).toEqual([0, 1, 2])
    expect(Array.from(single)).toEqual([0, 2, 3])
  })

  test("the same winding twice is not a card", () => {
    const { single, cards } = splitCards(Uint32Array.from([0, 1, 2, 1, 2, 0]), Uint32Array.from([0, 1, 2]))
    expect(cards.length).toBe(0)
    expect(single.length).toBe(6)
  })
})

describe("shellGeometry", () => {
  const big = twoToneSphere()
  const small = twoToneSphere().scale(0.1, 0.1, 0.1)
  small.computeBoundingSphere()
  const at = (x: number) => new Matrix4().makeTranslation(x, 0, 0)

  test("leaves small parts out and simplifies the rest as one", () => {
    const shell = shellGeometry(
      [
        { geometry: big, matrix: at(0) },
        { geometry: small, matrix: at(3) },
      ],
      SHELL,
    )
    expect(shell.boundingBox!.max.x).toBeLessThan(1.5)
    expect(tris(shell)).toBeLessThan(tris(big))
  })

  test("its error counts the parts it leaves out at their whole size", () => {
    const shell = shellGeometry(
      [
        { geometry: big, matrix: at(0) },
        { geometry: small, matrix: at(3) },
      ],
      SHELL,
    )
    expect(lodError(shell)).toBeGreaterThanOrEqual(2 * small.boundingSphere!.radius - 1e-6)
  })

  test("keeps every part when all are small", () => {
    const shell = shellGeometry(
      [
        { geometry: small, matrix: at(0) },
        { geometry: small, matrix: at(3) },
      ],
      SHELL,
    )
    expect(shell.boundingBox!.max.x).toBeGreaterThan(2.5)
  })
})

/** A batch with tiers: one camera pass, counting what it drew. */
describe("LodBatchedMesh", () => {
  const renderer = (dpr = 1) => ({
    getDrawingBufferSize: (v: { set(x: number, y: number): void }) => v.set(1600 * dpr, 1000 * dpr),
    getPixelRatio: () => dpr,
  })
  // CSS px a metre covers at 1 m: the fov-40 lens's y scale (2.747) on a 1000 px high view, halved
  const perMetre = (2.747 * 1000) / 2
  /** The distance at which `metres` covers `px` CSS pixels. */
  const at = (metres: number, px: number) => (metres * perMetre) / px
  const camera = (z: number) => {
    const c = new PerspectiveCamera(40, 1.6, 0.1, 50000)
    c.position.set(0, 0, z)
    c.lookAt(0, 0, 0)
    c.updateMatrixWorld()
    return c
  }
  const ERROR = 0.05

  function mesh() {
    const full = twoToneSphere()
    const coarse = simplifyGeometry(full, { ratio: 0.3, error: 0.2 })
    const m = new LodBatchedMesh(8, 2000, 6000, new MeshBasicMaterial())
    const base = m.addGeometry(full)
    const tier = m.addGeometry(coarse)
    m.setTiers(base, [tier, tier])
    m.setLodError(tier, ERROR)
    const shellGeometryId = m.addGeometry(coarse)
    m.setLodError(shellGeometryId, ERROR)
    const part = m.addInstance(base)
    const shell = m.addInstance(shellGeometryId)
    m.addCluster(shell, [part])
    const loose = m.addInstance(base)
    m.setMatrixAt(loose, new Matrix4().makeTranslation(1.5, 0, 0))
    return { m, part, shell, loose, full: tris(full), coarse: tris(coarse) }
  }
  type Draws = { tris: number[]; codes: number[]; ids: number[] }
  const pass = (
    m: LodBatchedMesh,
    cam: PerspectiveCamera | OrthographicCamera,
    shadow = false,
    dpr = 1,
  ): Draws => {
    const r = renderer(dpr)
    if (shadow) m.onBeforeShadow(r as never, m, cam, cam, m.geometry, m.material as never)
    else m.onBeforeRender(r as never, new Scene(), cam, m.geometry, m.material as never)
    // what three draws between the two hooks (a shadow pass's own list stands in for the main one
    // until onAfterShadow puts it back)
    const internal = m as unknown as {
      _multiDrawCount: number
      _multiDrawCounts: Int32Array
      _indirectTexture: { image: { data: Uint32Array } }
    }
    const n = internal._multiDrawCount
    const packed = Array.from(internal._indirectTexture.image.data.slice(0, n))
    const draws = {
      tris: Array.from(internal._multiDrawCounts.slice(0, n)).map((k) => k / 3),
      codes: packed.map((v) => v >>> ID_BITS),
      ids: packed.map((v) => v & ((1 << ID_BITS) - 1)),
    }
    if (shadow) m.onAfterShadow(r as never, m, cam, cam, m.geometry, m.material as never, null as never)
    return draws
  }

  test("near: the cluster's parts and every piece at full detail, drawn whole", () => {
    const { m, full } = mesh()
    const d = pass(m, camera(4))
    expect(d.tris).toEqual([full, full])
    expect(d.codes).toEqual([0, 0])
    expect(m.lod).toEqual({ tiers: [2, 0, 0], near: 1, shells: 0 })
  })

  test("far, once the stand-ins stray less than the band: the shell and the coarse tier", () => {
    const { m, coarse } = mesh()
    const d = pass(m, camera(at(ERROR, SWAP_PX[0] / 2)))
    expect(d.tris).toEqual([coarse, coarse])
    expect(d.codes).toEqual([0, 0])
    expect(m.lod).toEqual({ tiers: [0, 1, 0], near: 0, shells: 1 })
  })

  test("between: both levels, in complementary halves of the dither, never a swap", () => {
    const { m, part, shell, loose, full, coarse } = mesh()
    const d = pass(m, camera(at(ERROR, (SWAP_PX[0] + SWAP_PX[1]) / 2)))
    const of = (id: number) =>
      d.ids.flatMap((v, k) => (v === id ? [{ tris: d.tris[k], code: d.codes[k] }] : []))
    // about halfway (the loose piece stands a little farther off than the cluster)
    const [fine, rough] = of(loose)
    const q = rough!.code
    expect(Math.abs(q - inCode(0.5))).toBeLessThanOrEqual(2)
    expect([fine!.tris, rough!.tris]).toEqual([full, coarse])
    expect(fine!.code).toBe(outCode(q / FADE_STEPS))
    const s = of(shell)[0]!
    expect(s.tris).toBe(coarse)
    expect(of(part).map((p) => p.code)).toEqual([outCode(s.code / FADE_STEPS)])
  })

  test("with a dithering material the crossfading draws leave the main list for their own", () => {
    const { m } = mesh()
    m.fadeMaterial = new MeshBasicMaterial()
    const d = pass(m, camera(at(ERROR, (SWAP_PX[0] + SWAP_PX[1]) / 2)))
    expect(d.codes.every((code) => code === 0)).toBe(true)
    const fade = (m as unknown as { fade: { count: number } }).fade
    expect(fade.count).toBe(4)
  })

  test("every switch is judged in CSS pixels: the same draws at any DPR", () => {
    const { m } = mesh()
    const z = at(ERROR, 0.7)
    expect(pass(m, camera(z), false, 2)).toEqual(pass(m, camera(z), false, 1))
  })

  test("a shadow pass draws shells and the coarse tier whatever the distance, whole", () => {
    const { m, coarse } = mesh()
    pass(m, camera(4))
    const sun = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
    sun.position.set(0, 0, 20)
    sun.updateMatrixWorld()
    const d = pass(m, sun, true)
    expect(d.tris).toEqual([coarse, coarse])
    expect(d.codes).toEqual([0, 0])
    // The main view's counts are not touched by it.
    expect(m.lod.near).toBe(1)
  })

  /** Two pieces side by side: a detail one (0.3 m) and one at the detail radius. */
  function detail() {
    const m = new LodBatchedMesh(2, 2000, 6000, new MeshBasicMaterial())
    const base = m.addGeometry(twoToneSphere())
    const small = m.addInstance(base)
    m.setMatrixAt(small, new Matrix4().makeScale(0.3, 0.3, 0.3))
    const big = m.addInstance(base)
    m.setMatrixAt(big, new Matrix4().makeTranslation(1, 0, 0).scale(new Vector3().setScalar(DETAIL_RADIUS)))
    return m
  }
  const [shrunk, whole] = DETAIL_FADE_PX

  test("detail shrinks away as it falls through DETAIL_FADE_PX, never blinking out; bigger pieces stay", () => {
    const m = detail()
    expect(pass(m, camera(at(0.3, whole * 1.01))).codes).toEqual([0, 0])
    const half = pass(m, camera(at(0.3, (shrunk + whole) / 2)))
    expect(half.codes).toEqual([shrinkCode(0.5), 0])
    expect(pass(m, camera(at(0.3, shrunk * 0.99))).ids).toEqual([1])
  })

  test("a shadow pass still draws the detail the main view dropped, full size", () => {
    const m = detail()
    pass(m, camera(at(0.3, shrunk * 0.5)))
    const sun = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
    sun.position.set(0, 0, 20)
    sun.updateMatrixWorld()
    expect(pass(m, sun, true).codes).toEqual([0, 0])
  })

  test("instances out of view are not drawn", () => {
    const { m } = mesh()
    const away = camera(4)
    away.lookAt(0, 0, 100)
    away.updateMatrixWorld()
    expect(pass(m, away).tris).toEqual([])
  })

  test("a still camera keeps the last list: no walk, no upload, until something moves or changes", () => {
    const { m, loose, full } = mesh()
    // a DataTexture's `needsUpdate` bumps its version: the uploads are counted by it
    const indirect = (m as unknown as { _indirectTexture: { version: number } })._indirectTexture
    const cam = camera(4)
    const first = pass(m, cam)
    let uploads = indirect.version
    expect(pass(m, cam)).toEqual(first)
    expect(indirect.version).toBe(uploads)
    // a shadow pass writes its own buffers: the main list stands, and the next main pass neither
    // walks nor uploads (a cascade re-rendered on a still camera used to cost the main walk again)
    const sun = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
    sun.position.set(0, 0, 20)
    sun.updateMatrixWorld()
    pass(m, sun, true)
    uploads = indirect.version
    expect(pass(m, cam)).toEqual(first)
    expect(indirect.version).toBe(uploads)
    // the camera moves: listed again
    uploads = indirect.version
    const moved = camera(4.5)
    expect(pass(m, moved).tris).toEqual(first.tris)
    expect(indirect.version).toBe(uploads + 1)
    // an instance changes: listed again, with the change
    uploads = indirect.version
    m.setVisibleAt(loose, false)
    expect(pass(m, moved).tris).toEqual([full])
    expect(indirect.version).toBe(uploads + 1)
    // the DPR changes nothing on screen (CSS px) but is part of what the list was made from
    uploads = indirect.version
    expect(pass(m, moved, false, 2).tris).toEqual([full])
    expect(indirect.version).toBe(uploads + 1)
  })
})

describe("createStaticBatch with clusters", () => {
  const fakeStage = () => ({ scene: new Scene(), renderer: { extensions: { has: () => true } } as never })
  const load = async (): Promise<Object3D> => {
    const root = new Group()
    root.add(new Mesh(twoToneSphere()))
    return root
  }
  const part = (x: number) => ({ piece: "ball", x, y: 0, z: 0, rot: 0, scale: 1 })

  test("places each cluster's parts at the cluster and counts them; equal keys share a shell", async () => {
    const cluster = { key: "pair", parts: [part(0), part(3)], x: 10, y: 0, z: 0, rot: 0, scale: 1 }
    const batch = await createStaticBatch(fakeStage(), [part(-5)], load, [cluster, { ...cluster, x: 20 }])
    expect(batch.count).toBe(5)
    expect(batch.clusters).toBe(2)
    expect(batch.geometries).toBe(1)
    // 1 loose piece + 2 × (2 parts + 1 shell).
    expect(batch.mesh.instanceCount).toBe(7)
    const xs = Array.from({ length: 7 }, (_, id) =>
      Math.round(new Matrix4().copy(batch.mesh.getMatrixAt(id, new Matrix4())).elements[12]!),
    )
    expect(xs.sort((a, b) => a - b)).toEqual([-5, 10, 10, 13, 20, 20, 23])
  })
})
