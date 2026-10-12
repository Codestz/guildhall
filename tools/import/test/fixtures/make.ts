#!/usr/bin/env bun
/**
 * Builds the importer's test fixtures: tiny generated GLBs, one per colour-source kind, so tests
 * and CI never need the raw packs. Run `bun tools/import/test/fixtures/make.ts` after changing it;
 * the output is committed.
 *   fixture-atlas/crate.glb        gradient texture, faces read small UV regions
 *   fixture-colormap/wall-door.glb flat-cell texture, faces read single UV points
 *   fixture-material/bush.glb      two flat materials, no texture
 *   fixture-material/villager.glb  skinned (2 joints) with one clip, "Wave"
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Document, type Material, type Node } from "@gltf-transform/core"
import { encodePng } from "../../src/png.ts"
import { gltfIO } from "../../src/read.ts"

const OUT = import.meta.dir

/** Faces of an axis-aligned box: normal, then four corners (counter-clockwise from outside). */
const FACES: [n: number[], corners: number[][]][] = [
  [
    [1, 0, 0],
    [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  ],
  [
    [-1, 0, 0],
    [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  ],
  [
    [0, 1, 0],
    [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  ],
  [
    [0, -1, 0],
    [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  ],
  [
    [0, 0, 1],
    [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  ],
  [
    [0, 0, -1],
    [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  ],
]

/**
 * A box from (x0, 0, z0) up to size, with its bottom at y = `y0`. `uv(face, corner)` gives each
 * corner's texture coordinate (omit for an untextured box).
 */
function box(
  doc: Document,
  size: [number, number, number],
  y0: number,
  material: Material,
  uv?: (face: number, corner: number) => [number, number],
) {
  const [w, h, d] = size
  const pos: number[] = []
  const nrm: number[] = []
  const tex: number[] = []
  const idx: number[] = []
  for (const [f, [n, corners]] of FACES.entries()) {
    const base = pos.length / 3
    for (const [c, [x = 0, y = 0, z = 0]] of corners.entries()) {
      pos.push((x * w) / 2, y0 + ((y + 1) * h) / 2, (z * d) / 2)
      nrm.push(...n)
      if (uv) tex.push(...uv(f, c))
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buffer))
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      doc.createAccessor().setType("VEC3").setArray(new Float32Array(nrm)).setBuffer(buffer),
    )
  if (uv)
    prim.setAttribute(
      "TEXCOORD_0",
      doc.createAccessor().setType("VEC2").setArray(new Float32Array(tex)).setBuffer(buffer),
    )
  return prim
}

function texture(doc: Document, size: number, pixel: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data.set([...pixel(x, y), 255], (y * size + x) * 4)
  return doc
    .createTexture("tex")
    .setMimeType("image/png")
    .setImage(encodePng({ width: size, height: size, data }))
}

function piece(doc: Document, name: string, ...prims: ReturnType<typeof box>[]): Node {
  const mesh = doc.createMesh(name)
  for (const p of prims) mesh.addPrimitive(p)
  const node = doc.createNode(name).setMesh(mesh)
  doc.createScene().addChild(node)
  return node
}

/** A crate on a gradient atlas: each face reads a small triangle inside one 8×8 cell. */
function crate(): Document {
  const doc = new Document()
  const tex = texture(doc, 8, (x, y) => [120 + x * 8, 70 + y * 6, 40])
  const mat = doc.createMaterial("atlas").setBaseColorTexture(tex)
  const corner = [
    [0.1, 0.1],
    [0.4, 0.1],
    [0.4, 0.4],
    [0.1, 0.4],
  ]
  piece(
    doc,
    "crate",
    box(doc, [1, 1, 1], 0, mat, (f, c) => {
      const [u = 0, v = 0] = corner[c] ?? []
      return [(f % 4) / 4 + u / 4, Math.floor(f / 4) / 4 + v / 4]
    }),
  )
  return doc
}

/** A wall panel on a flat-cell colormap: every face reads one texel centre. */
function wallDoor(): Document {
  const doc = new Document()
  const cells: [number, number, number][] = [
    [200, 190, 170],
    [120, 80, 50],
    [90, 90, 100],
    [60, 120, 60],
  ]
  const tex = texture(doc, 4, (x) => cells[x] ?? [0, 0, 0])
  const mat = doc.createMaterial("colormap").setBaseColorTexture(tex)
  piece(
    doc,
    "wall-door",
    box(doc, [1, 1, 0.1], 0, mat, (f) => [((f % 2) + 0.5) / 4, 0.5 / 4]),
  )
  return doc
}

/** A bush of two flat materials: leaves and berries. */
function bush(): Document {
  const doc = new Document()
  const leaves = doc.createMaterial("Green").setBaseColorFactor([0.07, 0.12, 0.05, 1])
  const berries = doc.createMaterial("Berry").setBaseColorFactor([0.37, 0.02, 0.03, 1])
  piece(doc, "bush", box(doc, [1.2, 0.8, 1.2], -0.05, leaves), box(doc, [0.2, 0.2, 0.2], 0.7, berries))
  return doc
}

/** A two-bone character: a 0.5 × 2 m column skinned to a hip and a chest joint, with one clip. */
function villager(): Document {
  const doc = new Document()
  const mat = doc.createMaterial("Skin").setBaseColorFactor([0.8, 0.6, 0.5, 1])
  const prim = box(doc, [0.5, 2, 0.3], 0, mat)
  const buffer = doc.getRoot().listBuffers()[0]
  const count = prim.getAttribute("POSITION")?.getCount() ?? 0
  const pos = prim.getAttribute("POSITION")?.getArray() as Float32Array
  const joints = new Uint16Array(count * 4)
  const weights = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    joints[i * 4] = (pos[i * 3 + 1] ?? 0) > 1 ? 1 : 0
    weights[i * 4] = 1
  }
  prim
    .setAttribute(
      "JOINTS_0",
      doc
        .createAccessor()
        .setType("VEC4")
        .setArray(joints)
        .setBuffer(buffer ?? null),
    )
    .setAttribute(
      "WEIGHTS_0",
      doc
        .createAccessor()
        .setType("VEC4")
        .setArray(weights)
        .setBuffer(buffer ?? null),
    )
  const hip = doc.createNode("Hip").setTranslation([0, 0, 0])
  const chest = doc.createNode("Chest").setTranslation([0, 1, 0])
  hip.addChild(chest)
  const ibm = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
  ])
  const skin = doc
    .createSkin("Villager")
    .addJoint(hip)
    .addJoint(chest)
    .setSkeleton(hip)
    .setInverseBindMatrices(
      doc
        .createAccessor()
        .setType("MAT4")
        .setArray(ibm)
        .setBuffer(buffer ?? null),
    )
  const mesh = doc.createMesh("villager").addPrimitive(prim)
  const body = doc.createNode("villager").setMesh(mesh).setSkin(skin)
  doc.createScene().addChild(hip).addChild(body)
  const times = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Float32Array([0, 0.5, 1]))
    .setBuffer(buffer ?? null)
  const s = Math.SQRT1_2 / 2
  const turns = new Float32Array([0, 0, 0, 1, 0, 0, s, Math.sqrt(1 - s * s), 0, 0, 0, 1])
  const sampler = doc
    .createAnimationSampler()
    .setInput(times)
    .setOutput(
      doc
        .createAccessor()
        .setType("VEC4")
        .setArray(turns)
        .setBuffer(buffer ?? null),
    )
  doc
    .createAnimation("Wave")
    .addSampler(sampler)
    .addChannel(
      doc.createAnimationChannel().setTargetNode(chest).setTargetPath("rotation").setSampler(sampler),
    )
  return doc
}

const FIXTURES: [file: string, make: () => Document][] = [
  ["fixture-atlas/crate.glb", crate],
  ["fixture-colormap/wall-door.glb", wallDoor],
  ["fixture-material/bush.glb", bush],
  ["fixture-material/villager.glb", villager],
]

if (import.meta.main) {
  const io = await gltfIO()
  for (const [file, make] of FIXTURES) {
    mkdirSync(join(OUT, file, ".."), { recursive: true })
    await io.write(join(OUT, file), make())
    console.log(`wrote ${file}`)
  }
}
