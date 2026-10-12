import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, statSync, utimesSync } from "node:fs"
import { join } from "node:path"
import type { Document, Node } from "@gltf-transform/core"
import { PALETTE, type PackConfig } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { Matrix4, Quaternion, Vector3 } from "three"
import { startReport } from "../src/pipeline.ts"
import { gltfIO } from "../src/read.ts"
import { characterScale, importRigs, scaleSkeleton } from "../src/rigs.ts"
import { characters } from "../src/stages/characters.ts"
import type { StageCtx } from "../src/stages/types.ts"
import { FIXTURES, tempDir } from "./fixtures/env.ts"

const VILLAGER = join(FIXTURES, "fixture-material/villager.glb")
const quiet = log("test")

const pack = (over: Partial<PackConfig> = {}): PackConfig => ({
  id: "test",
  source: "test",
  vendor: "other",
  license: "CC0",
  include: ["*.glb"],
  colour: { mode: "material" },
  scale: { factor: 1 },
  pivot: "keep",
  rules: [],
  characters: [{ match: "*", rig: "test-rig" }],
  ...over,
})

/** The fixture villager (two joints Hip > Chest, one clip "Wave"), optionally edited. */
async function villager(edit?: (doc: Document) => void): Promise<Document> {
  const doc = await (await gltfIO()).read(VILLAGER)
  edit?.(doc)
  return doc
}

const node = (doc: Document, name: string): Node => {
  const n = doc
    .getRoot()
    .listNodes()
    .find((x) => x.getName() === name)
  if (!n) throw new Error(`no node ${name}`)
  return n
}

function ctxFor(doc: Document, p: PackConfig = pack()): StageCtx {
  const source = {
    pack: p.id,
    file: VILLAGER,
    source: "villager.glb",
    name: "villager",
    slug: "villager",
    category: "character" as const,
    tags: [],
    rig: "test-rig",
  }
  return { pack: p, source, palette: PALETTE, log: quiet, out: startReport(source, doc) }
}

/** World positions of the skinned vertices in the current pose: Σ w · (J · IBM) · v. */
function skinned(doc: Document): Vector3[] {
  const root = doc.getRoot()
  const skin = root.listSkins()[0]
  const prim = root.listMeshes()[0]?.listPrimitives()[0]
  if (!skin || !prim) throw new Error("not skinned")
  const ibm = skin.getInverseBindMatrices()
  const mats = skin
    .listJoints()
    .map((j, i) =>
      new Matrix4()
        .fromArray(j.getWorldMatrix())
        .multiply(new Matrix4().fromArray(ibm?.getElement(i, []) ?? [])),
    )
  const pos = prim.getAttribute("POSITION")
  const joints = prim.getAttribute("JOINTS_0")
  const weights = prim.getAttribute("WEIGHTS_0")
  const out: Vector3[] = []
  for (let i = 0; i < (pos?.getCount() ?? 0); i++) {
    const v = new Vector3().fromArray(pos?.getElement(i, []) ?? [])
    const j = joints?.getElement(i, []) ?? []
    const w = weights?.getElement(i, []) ?? []
    const sum = new Vector3()
    for (let k = 0; k < 4; k++)
      if ((w[k] ?? 0) > 0)
        sum.add(
          v
            .clone()
            .applyMatrix4(mats[j[k] ?? 0] as Matrix4)
            .multiplyScalar(w[k] ?? 0),
        )
    out.push(sum)
  }
  return out
}

/** Bends the chest 30° about x. */
const pose = (doc: Document): void => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6)
  node(doc, "Chest").setRotation([q.x, q.y, q.z, q.w])
}

/** A raw pack folder holding the given villager variants as GLBs. */
async function rawPack(raw: string, source: string, files: Record<string, Document>): Promise<void> {
  const io = await gltfIO()
  mkdirSync(join(raw, source), { recursive: true })
  for (const [name, doc] of Object.entries(files)) await io.write(join(raw, source, name), doc)
}

const renameClip = (from: string, to: string) => (doc: Document) => {
  for (const a of doc.getRoot().listAnimations()) if (a.getName() === from) a.setName(to)
}
/** Adds a copy of the "Wave" clip under another name. */
const addClip = (name: string) => (doc: Document) => {
  const wave = doc.getRoot().listAnimations()[0]
  const [channel] = wave?.listChannels() ?? []
  const sampler = channel?.getSampler()
  if (!channel || !sampler) throw new Error("no clip")
  const copy = doc
    .createAnimationSampler()
    .setInput(sampler.getInput())
    .setOutput(sampler.getOutput())
    .setInterpolation(sampler.getInterpolation())
  doc
    .createAnimation(name)
    .addSampler(copy)
    .addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(channel.getTargetNode())
        .setTargetPath(channel.getTargetPath())
        .setSampler(copy),
    )
}

const saved = process.env.GUILDHALL_LIBRARY
afterEach(() => {
  if (saved === undefined) delete process.env.GUILDHALL_LIBRARY
  else process.env.GUILDHALL_LIBRARY = saved
})

/** Builds `test-rig` from `rig` into a fresh library that the characters stage then reads. */
async function libraryWithRig(rig: Document): Promise<string> {
  const raw = tempDir()
  const library = tempDir()
  await rawPack(raw, "anims", { "rig.glb": rig })
  await importRigs(
    [pack({ source: "anims", rigs: [{ id: "test-rig", files: ["*.glb"] }] })],
    raw,
    library,
    quiet,
  )
  process.env.GUILDHALL_LIBRARY = library
  return library
}

describe("characters stage", () => {
  test("keeps skin and joints, bakes the palette, strips clips and records their names", async () => {
    process.env.GUILDHALL_LIBRARY = tempDir()
    const doc = await villager()
    const c = ctxFor(doc)
    await characters(doc, c)
    const root = doc.getRoot()
    expect(root.listSkins().map((s) => s.listJoints().map((j) => j.getName()))).toEqual([["Hip", "Chest"]])
    expect(root.listAnimations()).toHaveLength(0)
    expect(c.out.character).toEqual({ rig: "test-rig", clips: ["Wave"], bones: 2 })
    for (const prim of root.listMeshes().flatMap((m) => m.listPrimitives())) {
      for (const a of ["COLOR_0", "_SWATCH", "_SHADE", "JOINTS_0", "WEIGHTS_0"])
        expect(prim.getAttribute(a)).not.toBeNull()
      expect(prim.getAttribute("POSITION")?.getArray()).toBeInstanceOf(Float32Array)
    }
    expect(root.listTextures()).toHaveLength(0)
    expect(c.out.swatches.size).toBeGreaterThan(0)
    expect(c.out.measures?.size[1]).toBe(2)
    expect(c.out.scale).toMatchObject({ factor: 1, rule: "factor" })
  })

  test("the pack factor scales the skeleton: bind pose and any pose come out f times larger", async () => {
    process.env.GUILDHALL_LIBRARY = tempDir()
    const plain = await villager(pose)
    const expected = skinned(plain).map((v) => v.multiplyScalar(2.5))
    const doc = await villager()
    const c = ctxFor(doc, pack({ scale: { factor: 2.5 } }))
    await characters(doc, c)
    pose(doc)
    for (const [i, v] of skinned(doc).entries())
      expect(v.distanceTo(expected[i] as Vector3)).toBeLessThan(1e-5)
    expect(c.out.measures?.size[1]).toBe(5)
    expect(c.out.scale?.factor).toBe(2.5)
  })

  test("a skeleton that matches the built rig passes", async () => {
    await libraryWithRig(await villager())
    const doc = await villager()
    await characters(doc, ctxFor(doc))
    expect(doc.getRoot().listSkins()).toHaveLength(1)
  })

  test("a skeleton without a bone the rig animates is rejected by name", async () => {
    await libraryWithRig(await villager())
    const doc = await villager((d) => node(d, "Chest").setName("Torso"))
    await expect(characters(doc, ctxFor(doc))).rejects.toThrow(
      'skeleton does not match rig "test-rig": no Chest',
    )
  })
})

describe("characterScale", () => {
  const piece = { name: "Hero_A", source: "chars/Hero_A.glb", slug: "hero-a" }

  test("override factor, then the first scaleBy factor, then the pack factor", () => {
    expect(characterScale(pack({ scale: { factor: 0.7 } }), piece)).toEqual({ factor: 0.7, rule: "factor" })
    const by = pack({ scaleBy: [{ match: "Hero*", factor: 2 }] })
    expect(characterScale(by, piece)).toEqual({ factor: 2, rule: "factor" })
    expect(characterScale({ ...by, overrides: { "hero-a": { factor: 3 } } }, piece)).toEqual({
      factor: 3,
      rule: "override",
    })
  })

  test("a ref scale cannot size a skeleton", () => {
    const ref = pack({ scale: { ref: "house", measure: "height", metres: 6 } })
    expect(() => characterScale(ref, piece)).toThrow("a skeleton needs a factor scale")
  })

  test("scaleSkeleton by 1 changes nothing", async () => {
    const doc = await villager()
    const before = skinned(doc)
    scaleSkeleton(doc, 1)
    expect(skinned(doc)).toEqual(before)
  })
})

describe("importRigs", () => {
  test("merges clips across packs into one clip-only GLB; a repeated clip name is kept once", async () => {
    const raw = tempDir()
    const library = tempDir()
    await rawPack(raw, "a", { "a.glb": await villager(addClip("Idle")) })
    await rawPack(raw, "b", { "b.glb": await villager(addClip("Run")) })
    const rigs = [{ id: "test-rig", files: ["*.glb"] }]
    const entries = await importRigs(
      [pack({ id: "a", source: "a", rigs }), pack({ id: "b", source: "b", rigs })],
      raw,
      library,
      quiet,
    )
    expect(entries).toEqual([
      {
        id: "test-rig",
        file: "rigs/test-rig.glb",
        clips: [
          { name: "Idle", seconds: 1 },
          { name: "Run", seconds: 1 },
          { name: "Wave", seconds: 1 },
        ],
        bones: 2,
      },
    ])
    const out = (await (await gltfIO()).read(join(library, "rigs/test-rig.glb"))).getRoot()
    expect([out.listMeshes().length, out.listSkins().length, out.listScenes().length]).toEqual([0, 0, 1])
    expect(out.listAnimations().map((a) => a.getName())).toEqual(["Wave", "Idle", "Run"])
    const targets = new Set(
      out.listAnimations().flatMap((a) => a.listChannels().map((ch) => ch.getTargetNode())),
    )
    expect([...targets].map((n) => n?.getName())).toEqual(["Chest"])
    expect(out.listNodes().map((n) => n.getName())).toEqual(["Hip", "Chest"])
  })

  test("the clips filter keeps matching clips only", async () => {
    const raw = tempDir()
    await rawPack(raw, "a", { "a.glb": await villager(addClip("Idle")) })
    const [entry] = await importRigs(
      [pack({ source: "a", rigs: [{ id: "r", files: ["*.glb"], clips: ["I*"] }] })],
      raw,
      tempDir(),
      quiet,
    )
    expect(entry?.clips.map((c) => c.name)).toEqual(["Idle"])
  })

  test("an unchanged rig is not rewritten", async () => {
    const raw = tempDir()
    const library = tempDir()
    await rawPack(raw, "a", { "a.glb": await villager() })
    const packs = [pack({ source: "a", rigs: [{ id: "r", files: ["*.glb"] }] })]
    await importRigs(packs, raw, library, quiet)
    const file = join(library, "rigs/r.glb")
    utimesSync(file, new Date(1_000_000), new Date(1_000_000))
    await importRigs(packs, raw, library, quiet)
    expect(statSync(file).mtimeMs).toBe(1_000_000)
  })

  test("a file whose clips animate another skeleton is an error", async () => {
    const raw = tempDir()
    await rawPack(raw, "a", {
      "a.glb": await villager(),
      "b.glb": await villager((d) => {
        node(d, "Chest").setName("Spine")
        renameClip("Wave", "Bend")(d)
      }),
    })
    const packs = [pack({ source: "a", rigs: [{ id: "r", files: ["*.glb"] }] })]
    await expect(importRigs(packs, raw, tempDir(), quiet)).rejects.toThrow(
      'rig "r": clip "Bend" animates "Spine", not in the skeleton',
    )
  })

  test("a rig whose globs match no file is an error", async () => {
    const packs = [pack({ source: "a", rigs: [{ id: "r", files: ["*.glb"] }] })]
    await expect(importRigs(packs, tempDir(), tempDir(), quiet)).rejects.toThrow(
      'rig "r" lists no model file',
    )
  })
})
