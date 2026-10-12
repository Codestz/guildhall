#!/usr/bin/env bun
/**
 * Raw CC0 packs (assets/src) → the asset library (library/).
 *   bun import [all|<pack…>] [--force] [--jobs n] [--dry]
 *   bun import check
 *   bun import scan <folder|pack|all> [--out dir]
 * Logging follows $GUILDHALL_LOG (e.g. "import:*=debug").
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { join } from "node:path"
import { PALETTE } from "@guildhall/assets"
import { configureLog } from "@guildhall/core"
import { checkLibrary } from "./check.ts"
import { loadPacks, paths, REPO, selectPacks } from "./config.ts"
import { runImport } from "./pipeline.ts"
import { type PackScan, rawFolders, scanMarkdown, scanPack } from "./scan.ts"
import { thumbsCommand } from "./thumbs.ts"

const USAGE = `usage:
  bun import [all|<pack…>] [--force] [--jobs n] [--dry]   import packs into the library
  bun import check                                         validate the library
  bun import scan <folder|pack|all> [--out dir]            raw report (default out: .probe/import)
  bun import thumbs [pack…] [--force]                      thumbnails into library/thumbs`

interface Args {
  command: "import" | "check" | "scan" | "help"
  names: string[]
  force: boolean
  dry: boolean
  jobs: number
  out: string
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "import",
    names: [],
    force: false,
    dry: false,
    jobs: Math.max(1, availableParallelism() - 2),
    out: join(REPO, ".probe/import"),
  }
  const rest = [...argv]
  if (rest[0] === "check" || rest[0] === "scan") args.command = rest.shift() as Args["command"]
  while (rest.length > 0) {
    const a = rest.shift() as string
    if (a === "--force") args.force = true
    else if (a === "--dry") args.dry = true
    else if (a === "--jobs") {
      const n = Number(rest.shift())
      if (!Number.isInteger(n) || n < 1) throw new Error("--jobs expects a whole number >= 1")
      args.jobs = n
    } else if (a === "--out") args.out = rest.shift() ?? args.out
    else if (a === "-h" || a === "--help") args.command = "help"
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`)
    else args.names.push(a)
  }
  if (args.command === "import" && args.names.length === 0) args.command = "help"
  return args
}

async function scan(names: string[], out: string): Promise<void> {
  const p = paths()
  const packs = await loadPacks(p.packs)
  const folders = names.includes("all") ? rawFolders(p.raw) : names
  if (folders.length === 0) throw new Error(`scan: name a folder under ${p.raw}, a pack id, or "all"`)
  const scans: PackScan[] = []
  for (const name of folders) {
    const pack = packs.find((c) => c.id === name)
    const scanned = await scanPack(p.raw, pack?.source ?? name, join(p.library, ".cache"), pack)
    console.log(
      `${scanned.folder}: ${scanned.rows.length} files, ${scanned.rows.filter((r) => r.error).length} failed`,
    )
    scans.push(scanned)
  }
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "scan.json"), `${JSON.stringify({ raw: p.raw, packs: scans }, null, 1)}\n`)
  writeFileSync(join(out, "scan.md"), scanMarkdown(scans))
  console.log(`wrote ${join(out, "scan.json")} and scan.md`)
}

async function main(argv: string[]): Promise<number> {
  configureLog(process.env.GUILDHALL_LOG ?? "")
  if (argv[0] === "thumbs") return thumbsCommand(argv.slice(1))
  const args = parseArgs(argv)
  if (args.command === "help") {
    console.log(USAGE)
    return 0
  }
  if (args.command === "scan") {
    await scan(args.names, args.out)
    return 0
  }
  const p = paths()
  if (args.command === "check") {
    const result = await checkLibrary(p.library, PALETTE)
    for (const problem of result.problems) console.log(problem)
    console.log(
      result.shards === 0
        ? `check: ${p.library} has no catalog yet; nothing to check`
        : `check: ${result.entries} entries in ${result.shards} shards, ${result.problems.length} problems`,
    )
    return result.problems.length === 0 ? 0 : 1
  }
  const packs = selectPacks(await loadPacks(p.packs), args.names)
  const summaries = await runImport({ paths: p, packs, force: args.force, dry: args.dry, jobs: args.jobs })
  for (const s of summaries) {
    if (args.dry) {
      console.log(`${s.id}: ${s.pieces.length} pieces (${s.pieces.filter((x) => x.cached).length} cached)`)
      for (const x of s.pieces)
        console.log(
          `  ${x.slug.padEnd(40)} ${x.category.padEnd(10)} ${x.cached ? "cached " : "       "}${x.source}`,
        )
    } else {
      console.log(
        `${s.id}: ${s.imported} imported, ${s.cached} cached, ${s.failed.length} failed, ${s.removed} removed`,
      )
      for (const f of s.failed) console.log(`  failed ${f}`)
    }
  }
  return summaries.some((s) => s.failed.length > 0) ? 1 : 0
}

if (import.meta.main)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(2)
    },
  )
