import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Accessor } from "@gltf-transform/core"
import { type CatalogEntry, PALETTE, tintColours } from "@guildhall/assets"
import { runImport } from "../src/pipeline.ts"
import { gltfIO } from "../src/read.ts"
import { fixturePacks, fixturePaths } from "./fixtures/env.ts"

/** Normalized uint8 attribute → its bytes (meshopt-decoded accessors read back as byte / 255). */
function bytes(acc: Accessor): Uint8Array {
  const out = new Uint8Array(acc.getCount())
  const el: number[] = []
  for (let i = 0; i < out.length; i++) out[i] = Math.round((acc.getElement(i, el)[0] ?? 0) * 255)
  return out
}

interface Gap {
  worst: number
  occluded: number
}

/** Worst |tintColours − baked COLOR_0| over a written piece, with and without its `_AO`. */
async function compare(file: string, useAO: boolean): Promise<Gap> {
  const doc = await (await gltfIO()).read(file)
  const result: Gap = { worst: 0, occluded: 0 }
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const colour = prim.getAttribute("COLOR_0") as Accessor
      const swatch = Uint8Array.from(prim.getAttribute("_SWATCH")?.getArray() ?? [])
      const shade = bytes(prim.getAttribute("_SHADE") as Accessor)
      const occlusion = prim.getAttribute("_AO")
      const ao = occlusion ? bytes(occlusion) : undefined
      const out = tintColours(swatch, shade, PALETTE, undefined, useAO ? ao : undefined)
      const el: number[] = []
      for (let v = 0; v < swatch.length; v++) {
        const baked = colour.getElement(v, el)
        for (let k = 0; k < 3; k++)
          result.worst = Math.max(result.worst, Math.abs((out[v * 3 + k] ?? 0) - (baked[k] ?? 0)))
        if (ao && (ao[v] ?? 255) < 255) result.occluded++
      }
    }
  return result
}

describe("tintColours reproduces the baked COLOR_0 of real imported pieces", () => {
  const paths = fixturePaths()
  let entries: CatalogEntry[] = []
  let statics: CatalogEntry[] = []
  const glb = (e: CatalogEntry): string => join(paths.library, e.files.glb)
  beforeAll(async () => {
    const packs = await fixturePacks()
    await runImport({ paths, packs, jobs: 1 })
    entries = packs.flatMap(
      (p) => JSON.parse(readFileSync(join(paths.library, `catalog/${p.id}.json`), "utf8")) as CatalogEntry[],
    )
    statics = entries.filter((e) => e.kind === "static")
  })

  test("static pieces (normalize → colour → ao → optimize): within 1/255 with _AO", async () => {
    expect(statics.length).toBeGreaterThanOrEqual(3)
    for (const e of statics) {
      const gap = await compare(glb(e), true)
      expect(gap.occluded).toBeGreaterThan(0)
      expect(gap.worst).toBeLessThanOrEqual(1 / 255)
    }
  })

  test("without _AO the same pieces miss: the AO is what closes the gap", async () => {
    const worst = await Promise.all(statics.map(async (e) => (await compare(glb(e), false)).worst))
    expect(Math.max(...worst)).toBeGreaterThan(1 / 255)
  })

  test("a character (no AO bake) reproduces without _AO", async () => {
    const characters = entries.filter((e) => e.kind === "character")
    expect(characters.length).toBeGreaterThan(0)
    for (const e of characters) expect((await compare(glb(e), false)).worst).toBeLessThanOrEqual(1 / 255)
  })
})
