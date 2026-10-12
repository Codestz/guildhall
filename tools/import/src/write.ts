/** A finished piece → `library/pieces/<pack>/<slug>.glb` (ADR 002: one GLB per piece). */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Document } from "@gltf-transform/core"
import { contentHash } from "./cache.ts"
import { gltfIO } from "./read.ts"

export interface Written {
  /** Relative to the library root. */
  glb: string
  bytes: number
  hash: string
}

export const pieceFile = (pack: string, slug: string): string => `pieces/${pack}/${slug}.glb`

export async function writePiece(
  doc: Document,
  library: string,
  pack: string,
  slug: string,
): Promise<Written> {
  const io = await gltfIO()
  const bytes = await io.writeBinary(doc)
  const glb = pieceFile(pack, slug)
  mkdirSync(join(library, "pieces", pack), { recursive: true })
  writeFileSync(join(library, glb), bytes)
  return { glb, bytes: bytes.byteLength, hash: contentHash(bytes) }
}

/** Deletes GLBs in the pack's folder that no catalog entry names any more; returns how many. */
export function removeOrphans(library: string, pack: string, keep: ReadonlySet<string>): number {
  const dir = join(library, "pieces", pack)
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return 0
  }
  const orphans = files.filter((f) => f.endsWith(".glb") && !keep.has(`pieces/${pack}/${f}`))
  for (const f of orphans) rmSync(join(dir, f))
  return orphans.length
}
