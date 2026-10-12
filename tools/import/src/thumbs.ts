#!/usr/bin/env bun
/**
 * `bun import thumbs [pack…] [--force]`: a transparent 3/4 WebP of every catalog piece, drawn in
 * headless Chrome by the studio's thumbnail page (apps/studio/thumbs.html) and written to
 * `library/thumbs/<pack>/<slug>.webp`; the shard's `files.thumb` points at it.
 *
 * `library/thumbs/<pack>.json` maps slug → the GLB hash its thumbnail was drawn from, so a piece is
 * redrawn only when its GLB changed (or with --force). Pieces go to the page in batches; the manifest
 * is saved after each one, so an interrupted run resumes where it stopped. Chrome is only started when
 * something needs drawing, and it takes tools/shots' GPU lock. Mac only (Metal ANGLE); not in CI.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { type CatalogEntry, PALETTE } from "@guildhall/assets"
import { configureLog } from "@guildhall/core"
import { readShard, shardIds, writeIndex, writeShard } from "./catalog.ts"
import { paths } from "./config.ts"

/** What the page draws: the entry id and where it fetches the GLB. */
export interface ThumbJob {
  id: string
  url: string
}
export type ThumbResult = { id: string; webpBase64: string } | { id: string; error: string }
/** Draws one batch; the browser page in real runs, a fake in tests. */
export type RenderBatch = (jobs: ThumbJob[]) => Promise<ThumbResult[]>

/** slug → hash of the GLB the thumbnail was drawn from. */
export type ThumbManifest = Record<string, string>

/** Pieces per call into the page: big enough to amortise the round trip, small enough to free often. */
export const BATCH = 32
/** The page fetches GLBs under this path; the tool answers it from the library on disk. */
const GLB_ROUTE = "/library/"

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const slugOf = (e: CatalogEntry): string => e.id.slice(e.pack.length + 1)

export const thumbFile = (pack: string, slug: string): string => `thumbs/${pack}/${slug}.webp`
export const manifestFile = (library: string, pack: string): string => join(library, "thumbs", `${pack}.json`)

export function loadManifest(library: string, pack: string): ThumbManifest {
  const file = manifestFile(library, pack)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ThumbManifest
  } catch {
    return {}
  }
}

export function saveManifest(library: string, pack: string, manifest: ThumbManifest): void {
  const file = manifestFile(library, pack)
  mkdirSync(dirname(file), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => byText(a, b)))
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** The entries whose thumbnail is missing or was drawn from another GLB; every entry with `force`. */
export function staleEntries(
  library: string,
  entries: readonly CatalogEntry[],
  manifest: ThumbManifest,
  force = false,
): CatalogEntry[] {
  return entries.filter(
    (e) =>
      force || manifest[slugOf(e)] !== e.hash || !existsSync(join(library, thumbFile(e.pack, slugOf(e)))),
  )
}

/** `items` in runs of `size` (the last one shorter). */
export function batches<T>(items: readonly T[], size = BATCH): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface ThumbSummary {
  pack: string
  rendered: number
  skipped: number
  failed: string[]
  /** Thumbnails deleted because their piece left the catalog. */
  removed: number
}

export interface ThumbRun {
  library: string
  /** Shard ids; empty or "all" means every shard. */
  names: string[]
  force: boolean
  render: RenderBatch
  batch?: number
}

/** The shards named, all of them for none or "all"; an unknown name throws. */
export function selectShards(library: string, names: readonly string[]): string[] {
  const ids = shardIds(library)
  if (names.length === 0 || names.includes("all")) return ids
  const unknown = names.filter((n) => !ids.includes(n))
  if (unknown.length > 0) throw new Error(`thumbs: no catalog shard for ${unknown.join(", ")}`)
  return ids.filter((id) => names.includes(id))
}

/** Thumbnails for every selected shard, then the shards and index rewritten with `files.thumb`. */
export async function runThumbs(run: ThumbRun): Promise<ThumbSummary[]> {
  const summaries: ThumbSummary[] = []
  for (const pack of selectShards(run.library, run.names)) summaries.push(await thumbPack(run, pack))
  if (summaries.length > 0) writeIndex(run.library, PALETTE, {})
  return summaries
}

async function thumbPack(run: ThumbRun, pack: string): Promise<ThumbSummary> {
  const { library } = run
  const entries = readShard(library, pack)
  const old = loadManifest(library, pack)
  // Only pieces still in the shard keep a manifest line.
  const manifest: ThumbManifest = {}
  for (const e of entries) if (old[slugOf(e)] !== undefined) manifest[slugOf(e)] = old[slugOf(e)] as string
  const todo = staleEntries(library, entries, manifest, run.force)
  const summary: ThumbSummary = {
    pack,
    rendered: 0,
    skipped: entries.length - todo.length,
    failed: [],
    removed: 0,
  }

  const byId = new Map(todo.map((e) => [e.id, e]))
  for (const group of batches(todo, run.batch)) {
    const results = await run.render(group.map((e) => ({ id: e.id, url: `${GLB_ROUTE}${e.files.glb}` })))
    for (const r of results) {
      const e = byId.get(r.id)
      if (!e) continue
      if ("error" in r) {
        summary.failed.push(`${r.id}: ${r.error}`)
        continue
      }
      const file = join(library, thumbFile(pack, slugOf(e)))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(r.webpBase64, "base64"))
      manifest[slugOf(e)] = e.hash
      summary.rendered++
    }
    saveManifest(library, pack, manifest)
  }
  saveManifest(library, pack, manifest)

  for (const e of entries) {
    const thumb = thumbFile(pack, slugOf(e))
    e.files.thumb = existsSync(join(library, thumb)) ? thumb : null
  }
  writeShard(library, pack, entries)
  summary.removed = removeOrphans(library, pack, new Set(entries.map((e) => `${slugOf(e)}.webp`)))
  return summary
}

/** Deletes `thumbs/<pack>/*.webp` that no entry names; returns how many. */
function removeOrphans(library: string, pack: string, keep: ReadonlySet<string>): number {
  const dir = join(library, "thumbs", pack)
  if (!existsSync(dir)) return 0
  const orphans = readdirSync(dir).filter((f) => f.endsWith(".webp") && !keep.has(f))
  for (const f of orphans) rmSync(join(dir, f))
  return orphans.length
}

/** The slice of tools/shots' `openApp` this file uses (imported at runtime; see `openThumbPage`). */
interface ThumbPage {
  page: {
    route(
      url: string,
      handler: (route: {
        request(): { url(): string }
        fulfill(r: { path: string; contentType: string }): Promise<void>
        fulfill(r: { status: number }): Promise<void>
      }) => unknown,
    ): Promise<void>
    evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>
  }
  errors: string[]
  close(): Promise<void>
}

/** `window` on the thumbnail page, once it is ready. */
interface PageGlobal {
  guildhall: { ext: { thumbs?: { render: RenderBatch } } }
}

/**
 * The studio's thumbnail page in headless Chrome, its GLB fetches answered from `library` (which may
 * be a temporary one, not the repo's). openApp starts the dev server if none is up.
 */
async function openThumbPage(library: string): Promise<{ render: RenderBatch; close(): Promise<void> }> {
  // tools/import does not declare tools/shots as a dependency, so it is loaded by path.
  const shots = new URL("../../shots/src/app.ts", import.meta.url).href
  const { openApp } = (await import(shots)) as {
    openApp(o: { app: "studio"; page: "thumbs" }): Promise<ThumbPage>
  }
  const app = await openApp({ app: "studio", page: "thumbs" })
  const root = resolve(library)
  await app.page.route(`**${GLB_ROUTE}**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(GLB_ROUTE.length))
    const file = resolve(root, path)
    if (!file.startsWith(root + sep) || !existsSync(file)) return route.fulfill({ status: 404 })
    return route.fulfill({ path: file, contentType: "model/gltf-binary" })
  })
  const hasExt = await app.page.evaluate(
    () => (globalThis as unknown as PageGlobal).guildhall.ext.thumbs !== undefined,
    undefined,
  )
  if (!hasExt) {
    await app.close()
    throw new Error(`thumbs: the thumbnail page did not start (needs a GPU)\n${app.errors.join("\n")}`)
  }
  return {
    render: (jobs) =>
      app.page.evaluate(
        (batch) => (globalThis as unknown as PageGlobal).guildhall.ext.thumbs?.render(batch) ?? [],
        jobs,
      ),
    close: () => app.close(),
  }
}

export function parseThumbArgs(argv: readonly string[]): { names: string[]; force: boolean } {
  const names: string[] = []
  let force = false
  for (const a of argv) {
    if (a === "--force") force = true
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`)
    else names.push(a)
  }
  return { names, force }
}

/** The `thumbs` command; `argv` is what follows it. */
export async function thumbsCommand(argv: readonly string[]): Promise<number> {
  const { names, force } = parseThumbArgs(argv)
  const { library } = paths()
  let page: Awaited<ReturnType<typeof openThumbPage>> | undefined
  const started = performance.now()
  try {
    const summaries = await runThumbs({
      library,
      names,
      force,
      async render(jobs) {
        page ??= await openThumbPage(library)
        return page.render(jobs)
      },
    })
    let rendered = 0
    for (const s of summaries) {
      rendered += s.rendered
      console.log(
        `${s.pack}: ${s.rendered} rendered, ${s.skipped} unchanged, ${s.failed.length} failed, ${s.removed} removed`,
      )
      for (const f of s.failed) console.log(`  failed ${f}`)
    }
    if (summaries.length === 0) console.log(`thumbs: ${library} has no catalog yet; run \`bun import\` first`)
    else console.log(`thumbs: ${rendered} in ${((performance.now() - started) / 1000).toFixed(1)}s`)
    return summaries.some((s) => s.failed.length > 0) ? 1 : 0
  } finally {
    await page?.close()
  }
}

if (import.meta.main) {
  configureLog(process.env.GUILDHALL_LOG ?? "")
  thumbsCommand(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(2)
    },
  )
}
