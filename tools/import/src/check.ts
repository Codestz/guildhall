/**
 * `bun import check`: the library is consistent. Every shard entry passes `validateEntry`, every file
 * it names exists, ids are unique, the index validates and lists every shard, and every GLB is
 * texture-free with COLOR_0 / _SWATCH / _SHADE on every primitive (ADR 003).
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type CatalogEntry,
  type CatalogIndex,
  type Palette,
  validateEntry,
  validateIndex,
} from "@guildhall/assets"
import { shardFile, shardIds } from "./catalog.ts"
import { gltfIO } from "./read.ts"

export const VERTEX_ATTRIBUTES = ["COLOR_0", "_SWATCH", "_SHADE"] as const

export interface CheckResult {
  shards: number
  entries: number
  problems: string[]
}

/** Problems with one written GLB, as "what" (the caller prefixes the entry id). */
export async function glbProblems(file: string): Promise<string[]> {
  const io = await gltfIO()
  const root = (await io.read(file)).getRoot()
  const out: string[] = []
  if (root.listTextures().length > 0)
    out.push(`${root.listTextures().length} texture(s); the palette bake removes them`)
  for (const mesh of root.listMeshes())
    for (const [i, prim] of mesh.listPrimitives().entries()) {
      const missing = VERTEX_ATTRIBUTES.filter((a) => !prim.getAttribute(a))
      if (missing.length > 0) out.push(`mesh "${mesh.getName()}" primitive ${i}: no ${missing.join(", ")}`)
    }
  return out
}

export async function checkLibrary(library: string, palette: Palette): Promise<CheckResult> {
  const ids = shardIds(library)
  const result: CheckResult = { shards: ids.length, entries: 0, problems: [] }
  if (ids.length === 0) return result
  const problems = result.problems

  const indexFile = join(library, "catalog", "index.json")
  if (!existsSync(indexFile)) problems.push("catalog/index.json: missing")
  else {
    const index = JSON.parse(readFileSync(indexFile, "utf8")) as CatalogIndex
    problems.push(...validateIndex(index).map((p) => `index.json: ${p}`))
    const listed = new Set((index.packs ?? []).map((p) => p.id))
    for (const id of ids) if (!listed.has(id)) problems.push(`index.json: shard "${id}" is not listed`)
  }

  const seen = new Set<string>()
  for (const id of ids) {
    let entries: CatalogEntry[]
    try {
      entries = JSON.parse(readFileSync(shardFile(library, id), "utf8")) as CatalogEntry[]
    } catch (err) {
      problems.push(`catalog/${id}.json: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    for (const e of entries) {
      result.entries++
      problems.push(...validateEntry(e, palette))
      if (e.pack !== id) problems.push(`${e.id}: in shard "${id}" but pack is "${e.pack}"`)
      if (seen.has(e.id)) problems.push(`${e.id}: duplicate id`)
      seen.add(e.id)
      const files = e.files ?? {}
      if (files.thumb && !existsSync(join(library, files.thumb)))
        problems.push(`${e.id}: thumb ${files.thumb} missing`)
      if (!files.glb) continue
      const glb = join(library, files.glb)
      if (!existsSync(glb)) problems.push(`${e.id}: glb ${files.glb} missing`)
      else problems.push(...(await glbProblems(glb)).map((p) => `${e.id}: ${p}`))
    }
  }
  return result
}
