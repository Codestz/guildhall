import { describe, expect, test } from "bun:test"
import { PALETTE } from "@guildhall/assets"
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Scene,
  Vector3,
} from "three"
import { type BatchInstance, createStaticBatch, instanceMatrix } from "../src/batch.ts"
import { BATCH_ATTRIBUTES, batchGeometry } from "../src/batchGeometry.ts"

const [A, B] = [PALETTE.swatches[1]!.id, PALETTE.swatches[2]!.id]

/** A one-triangle mesh in a library format: quantized (int16 positions, int8 normals, rgb) or float (rgba, no `_ao`). */
function triangle(format: "quantized" | "float"): Mesh {
  const g = new BufferGeometry()
  const corners = [0, 0, 0, 1, 0, 0, 0, 0, -1]
  if (format === "quantized") {
    g.setAttribute("position", new BufferAttribute(Int16Array.from(corners.map((c) => c * 32767)), 3, true))
    g.setAttribute("normal", new BufferAttribute(Int8Array.from([0, 127, 0, 0, 127, 0, 0, 127, 0]), 3, true))
    g.setAttribute("color", new BufferAttribute(new Uint8Array(9).fill(200), 3, true))
    g.setAttribute("_ao", new BufferAttribute(Uint8Array.from([255, 128, 64]), 1, true))
  } else {
    g.setAttribute("position", new BufferAttribute(Float32Array.from(corners), 3))
    g.setAttribute("normal", new BufferAttribute(Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3))
    g.setAttribute("color", new BufferAttribute(new Float32Array(12).fill(0.5), 4))
  }
  g.setAttribute("_swatch", new BufferAttribute(Uint8Array.from([A, A, A]), 1))
  g.setAttribute("_shade", new BufferAttribute(Uint8Array.from([128, 128, 128]), 1, true))
  g.setIndex([0, 1, 2])
  return new Mesh(g, new MeshBasicMaterial())
}

/** A piece root: two triangles, the second moved 2 m along x by its node. */
function piece(format: "quantized" | "float" = "quantized"): Group {
  const root = new Group()
  const moved = triangle(format)
  moved.position.x = 2
  root.add(triangle(format), moved)
  return root
}

const values = (g: BufferGeometry, name: string) =>
  Array.from(g.getAttribute(name).array as ArrayLike<number>)

describe("batchGeometry", () => {
  test("merges every mesh into one indexed geometry with node transforms baked in", () => {
    const g = batchGeometry(piece())
    expect(g.getAttribute("position").count).toBe(6)
    expect(values(g, "position").map((v) => Math.round(v * 1000) / 1000)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 0, -1, 2, 0, 0, 3, 0, 0, 2, 0, -1,
    ])
    expect(Array.from(g.index!.array)).toEqual([0, 1, 2, 3, 4, 5])
  })

  test("every geometry comes out in the batch format, whatever format it came in", () => {
    for (const format of ["quantized", "float"] as const) {
      const g = batchGeometry(piece(format))
      for (const [name, f] of Object.entries(BATCH_ATTRIBUTES)) {
        const attribute = g.getAttribute(name) as BufferAttribute
        expect(attribute.array).toBeInstanceOf(f.array)
        expect([attribute.itemSize, attribute.normalized]).toEqual([f.itemSize, f.normalized])
      }
    }
  })

  test("reads normalized sources as the values they stand for and fills missing bytes neutrally", () => {
    const quantized = batchGeometry(piece("quantized"))
    expect(values(quantized, "normal").slice(0, 3)).toEqual([0, 1, 0])
    expect(values(quantized, "color").slice(0, 3)).toEqual([200, 200, 200])
    expect(values(quantized, "_ao").slice(0, 3)).toEqual([255, 128, 64])
    const float = batchGeometry(piece("float"))
    expect(values(float, "color").slice(0, 3)).toEqual([128, 128, 128])
    expect(values(float, "_ao")).toEqual([255, 255, 255, 255, 255, 255])
    expect(values(float, "_shade")).toEqual([128, 128, 128, 128, 128, 128])
  })

  test("a swatch map re-tints the colours; the identity map keeps them", () => {
    const root = piece()
    expect(values(batchGeometry(root, {}), "color")).toEqual(values(batchGeometry(root), "color"))
    expect(values(batchGeometry(root, { [A]: B }), "color")).not.toEqual(values(batchGeometry(root), "color"))
  })

  test("a mirroring node keeps faces pointing out by flipping the winding", () => {
    const root = new Group()
    const mirrored = triangle("float")
    mirrored.scale.x = -1
    root.add(mirrored)
    expect(Array.from(batchGeometry(root).index!.array)).toEqual([0, 2, 1])
  })
})

/** A stage with no GL: the batch only adds to the scene and asks for the multi-draw extension. */
const fakeStage = () => ({
  scene: new Scene(),
  renderer: { extensions: { has: () => true } } as never,
})

const at = (piece: string, x: number, extra: Partial<BatchInstance> = {}): BatchInstance => ({
  piece,
  x,
  y: 0,
  z: 0,
  rot: 0,
  scale: 1,
  ...extra,
})

/** A loader that counts how often each piece is loaded. */
function loader(formats: Record<string, "quantized" | "float">) {
  const loads: string[] = []
  const load = async (id: string): Promise<Object3D> => {
    loads.push(id)
    const format = formats[id]
    if (!format) throw new Error(`no piece ${id}`)
    return piece(format)
  }
  return { load, loads }
}

const positionOf = (batch: { mesh: { getMatrixAt(id: number, m: Matrix4): Matrix4 } }, id: number) =>
  new Vector3().setFromMatrixPosition(batch.mesh.getMatrixAt(id, new Matrix4()))

describe("createStaticBatch", () => {
  test("one geometry per (piece, re-tint), each piece loaded once, every instance placed", async () => {
    const stage = fakeStage()
    const { load, loads } = loader({ house: "quantized", tree: "float" })
    const instances = [
      at("house", 0),
      at("house", 5),
      at("tree", 10),
      at("house", 15, { swatchMap: { [A]: B } }),
    ]
    const batch = await createStaticBatch(stage, instances, load)
    expect(batch.count).toBe(4)
    expect(batch.geometries).toBe(3)
    expect(loads.sort()).toEqual(["house", "tree"])
    expect(stage.scene.children).toContain(batch.mesh)
    expect([batch.mesh.castShadow, batch.mesh.receiveShadow, batch.mesh.perObjectFrustumCulled]).toEqual([
      true,
      true,
      true,
    ])
    expect(batch.ids.map((id) => positionOf(batch, id).x)).toEqual([0, 5, 10, 15])
  })

  test("places an instance as placeInstance poses a node: turn about +y, then uniform scale", () => {
    const m = instanceMatrix(at("house", 1, { z: 2, rot: Math.PI / 2, scale: 2 }))
    const p = new Vector3(1, 0, 0).applyMatrix4(m)
    expect([p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0])
  })

  test("adding past the sized buffers grows them and keeps what was there", async () => {
    const { load } = loader({ house: "quantized", tree: "float" })
    const batch = await createStaticBatch(fakeStage(), [at("house", 0)], load)
    const more = await batch.add([at("tree", 1), at("tree", 2), at("house", 3)])
    expect(batch.count).toBe(4)
    expect(batch.geometries).toBe(2)
    expect(more.map((id) => positionOf(batch, id).x)).toEqual([1, 2, 3])
    expect(positionOf(batch, batch.ids[0]!).x).toBe(0)
  })

  test("update moves and swaps an instance's piece; remove takes it out", async () => {
    const { load } = loader({ house: "quantized", tree: "float" })
    const batch = await createStaticBatch(fakeStage(), [at("house", 0), at("house", 1)], load)
    const [first, second] = batch.ids as [number, number]
    await batch.update(first, at("tree", 7))
    expect(positionOf(batch, first).x).toBe(7)
    expect(batch.mesh.getGeometryIdAt(first)).not.toBe(batch.mesh.getGeometryIdAt(second))
    expect(batch.count).toBe(2)
    batch.remove(second)
    expect(batch.count).toBe(1)
    expect(() => batch.mesh.getMatrixAt(second, new Matrix4())).toThrow()
  })

  test("a piece that fails to load rejects the batch", async () => {
    const { load } = loader({})
    await expect(createStaticBatch(fakeStage(), [at("missing", 0)], load)).rejects.toThrow("no piece missing")
  })
})
