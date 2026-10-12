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
} from "three"
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { createStaticBatch } from "../src/batch.ts"
import { batchGeometry } from "../src/batchGeometry.ts"
import { LodBatchedMesh } from "../src/batchMesh.ts"
import { PIECE_PX, pickTier, SHELL, screenRadius } from "../src/lod.ts"
import {
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

describe("pickTier", () => {
  test("steps coarser as the radius shrinks past each boundary", () => {
    expect([100, 30, 5].map((px) => pickTier(px, 0, [40, 12], 0))).toEqual([0, 1, 2])
  })

  test("holds its tier inside the band on either side of a boundary", () => {
    // 38 px is under the 40 px boundary but inside its 15 % band: it stays where it was.
    expect(pickTier(38, 0, [40, 12])).toBe(0)
    expect(pickTier(42, 1, [40, 12])).toBe(1)
    // Past the band it moves.
    expect(pickTier(33, 0, [40, 12])).toBe(1)
    expect(pickTier(47, 1, [40, 12])).toBe(0)
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

/** A batch with tiers: one far-reaching camera pass, counting what it drew. */
describe("LodBatchedMesh", () => {
  const renderer = { getDrawingBufferSize: (v: { set(x: number, y: number): void }) => v.set(1600, 1000) }
  const camera = (z: number) => {
    const c = new PerspectiveCamera(40, 1.6, 0.1, 5000)
    c.position.set(0, 0, z)
    c.lookAt(0, 0, 0)
    c.updateMatrixWorld()
    return c
  }

  function mesh() {
    const full = twoToneSphere()
    const coarse = simplifyGeometry(full, { ratio: 0.3, error: 0.2 })
    const m = new LodBatchedMesh(4, 2000, 6000, new MeshBasicMaterial())
    const base = m.addGeometry(full)
    const tier = m.addGeometry(coarse)
    m.setTiers(base, [tier, tier])
    const shellGeometryId = m.addGeometry(coarse)
    const part = m.addInstance(base)
    const shell = m.addInstance(shellGeometryId)
    m.addCluster(shell, [part])
    const loose = m.addInstance(base)
    m.setMatrixAt(loose, new Matrix4().makeTranslation(1.5, 0, 0))
    return { m, part, shell, loose, full: tris(full), coarse: tris(coarse) }
  }
  const pass = (m: LodBatchedMesh, cam: PerspectiveCamera | OrthographicCamera, shadow = false) => {
    if (shadow) m.onBeforeShadow(renderer as never, m, cam, cam, m.geometry, m.material as never)
    else m.onBeforeRender(renderer as never, new Scene(), cam, m.geometry, m.material as never)
    const internal = m as unknown as { _multiDrawCount: number; _multiDrawCounts: Int32Array }
    return Array.from(internal._multiDrawCounts.slice(0, internal._multiDrawCount)).map((n) => n / 3)
  }

  test("near: the cluster's parts and every piece at full detail", () => {
    const { m, full } = mesh()
    expect(pass(m, camera(4))).toEqual([full, full])
    expect(m.lod).toEqual({ tiers: [2, 0, 0], near: 1, shells: 0 })
  })

  test("far: the cluster as its shell and pieces at their coarse tier", () => {
    const { m, coarse } = mesh()
    const far = camera(((1 * 2.747 * 1000) / 2 / PIECE_PX[1]!) * 3)
    expect(pass(m, far)).toEqual([coarse, coarse])
    expect(m.lod).toEqual({ tiers: [0, 1, 0], near: 0, shells: 1 })
  })

  test("a shadow pass draws shells and the coarse tier whatever the distance", () => {
    const { m, coarse } = mesh()
    pass(m, camera(4))
    const sun = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
    sun.position.set(0, 0, 20)
    sun.updateMatrixWorld()
    expect(pass(m, sun, true)).toEqual([coarse, coarse])
    // The main view's counts are not touched by it.
    expect(m.lod.near).toBe(1)
  })

  test("instances out of view are not drawn", () => {
    const { m } = mesh()
    const away = camera(4)
    away.lookAt(0, 0, 100)
    away.updateMatrixWorld()
    expect(pass(m, away)).toEqual([])
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
