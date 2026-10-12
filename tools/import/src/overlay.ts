/**
 * Authored data (`data/`, ADR 010) persisted into the catalog shards. Every shard write lays the
 * overlay on through `applyOverlay`, the function Studio uses live, so authored mounts survive
 * re-imports. `bun import overlay` re-applies it to the shards on disk without re-baking anything.
 *   GUILDHALL_DATA   authored data   (default <repo>/data)
 */
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { applyOverlay, type DataOverlay, type MountsFile, PALETTE, validateMounts } from "@guildhall/assets"
import { readShard, shardIds, writeIndex, writeShard } from "./catalog.ts"
import { paths, REPO } from "./config.ts"

export const dataDir = (env: Record<string, string | undefined> = process.env): string =>
  resolve(env.GUILDHALL_DATA ?? join(REPO, "data"))

/**
 * The overlay `data` holds. No `mounts.json` means no mounts are authored, so entries carry none.
 * Throws, listing every problem, when the file is not valid JSON or not a valid mounts file.
 */
export function loadOverlay(data: string = dataDir()): DataOverlay {
  const file = join(data, "mounts.json")
  if (!existsSync(file)) return { mounts: {} }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, "utf8"))
  } catch (err) {
    throw new Error(`${file}: not JSON (${err instanceof Error ? err.message : String(err)})`)
  }
  const problems = validateMounts(json)
  if (problems.length > 0) throw new Error(`${file}: ${problems.length} problems\n  ${problems.join("\n  ")}`)
  return { mounts: (json as MountsFile).mounts }
}

/** Re-applies the overlay to every shard; rewrites only the shards (and index) that change. */
export function reapplyOverlay(library: string, overlay: DataOverlay = loadOverlay()): string[] {
  const changed: string[] = []
  for (const pack of shardIds(library)) {
    const entries = readShard(library, pack)
    const next = applyOverlay(entries, overlay)
    if (next.every((e, i) => e === entries[i])) continue
    writeShard(library, pack, next, overlay)
    changed.push(pack)
  }
  if (changed.length > 0) writeIndex(library, PALETTE, {})
  return changed
}

/** The `overlay` command. */
export function overlayCommand(): number {
  const changed = reapplyOverlay(paths().library)
  console.log(
    changed.length === 0 ? "overlay: every shard is up to date" : `overlay: rewrote ${changed.join(", ")}`,
  )
  return 0
}
