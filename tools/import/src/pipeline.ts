/**
 * The import run: build the rigs the packs declare, then discover each pack, skip pieces whose cache
 * key is unchanged, push the rest through read → stages → write (in Bun workers with `--jobs` > 1),
 * then write the shard, cache and index (with the rigs).
 * This file is also the worker entry: off the main thread it serves `importFile` jobs.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Document } from "@gltf-transform/core"
import { type CatalogEntry, PALETTE, type PackConfig, paletteHash, type RigEntry } from "@guildhall/assets"
import { type Logger, log } from "@guildhall/core"
import { loadCache, type PackCache, pieceKey, saveCache } from "./cache.ts"
import { readShard, toEntry, writeIndex, writeShard } from "./catalog.ts"
import { IMPORTER, loadPacks, type Paths } from "./config.ts"
import { classify, discover, slugClashes } from "./discover.ts"
import { readModel, splitTopNodes } from "./read.ts"
import { importRigs } from "./rigs.ts"
import { ao } from "./stages/ao.ts"
import { characters } from "./stages/characters.ts"
import { colour } from "./stages/colour.ts"
import { measure } from "./stages/measure.ts"
import { normalize } from "./stages/normalize.ts"
import { optimize } from "./stages/optimize.ts"
import type { PieceReport, PieceSource, Stage, StageCtx } from "./stages/types.ts"
import { withAnswer } from "./tags/apply.ts"
import { loadTagCache, thumbHash } from "./tags/emit.ts"
import { loadVocab, type TagCache, type Vocab } from "./tags/vocab.ts"
import { removeOrphans, writePiece } from "./write.ts"

/** Static pieces, in order. Characters run `characters` alone. */
export const STAGES: readonly Stage[] = [normalize, colour, ao, optimize, measure]

/** The report a piece starts with, before any stage runs. */
export function startReport(source: PieceSource, doc: Document): PieceReport {
  const root = doc.getRoot()
  const skin = root.listSkins()[0]
  const report: PieceReport = {
    slug: source.slug,
    kind: source.rig && skin ? "character" : "static",
    flags: new Set(),
    swatches: new Set(),
    compose: { front: null, streetEdge: null, attach: "free", anchors: [], source: "placeholder" },
  }
  if (report.kind === "character" && source.rig)
    report.character = {
      rig: source.rig,
      clips: root.listAnimations().map((a) => a.getName()),
      bones: skin?.listJoints().length ?? 0,
    }
  return report
}

/** The roots a piece's import reads from and writes to. */
export type Roots = Pick<Paths, "raw" | "library">

/** One raw file → its catalog entries (one, or one per node with `split: "top-nodes"`). */
export async function importFile(pack: PackConfig, file: PieceSource, roots: Roots): Promise<CatalogEntry[]> {
  const logger = log("import").child(pack.id)
  const doc = await readModel(file.file)
  const parts =
    pack.split === "top-nodes"
      ? (await splitTopNodes(doc)).map((p) => ({
          source: classify(pack, file.file, file.source, p.node, p.node),
          doc: p.doc,
        }))
      : [{ source: file, doc }]
  const entries: CatalogEntry[] = []
  for (const { source, doc: piece } of parts) {
    if (source.override?.exclude === true) continue
    entries.push(await importPiece(pack, source, piece, roots, logger))
  }
  return entries
}

async function importPiece(
  pack: PackConfig,
  source: PieceSource,
  doc: Document,
  roots: Roots,
  logger: Logger,
) {
  const out = startReport(source, doc)
  const ctx: StageCtx = {
    pack,
    source,
    palette: PALETTE,
    raw: roots.raw,
    library: roots.library,
    log: logger.child(source.slug),
    out,
  }
  for (const stage of out.kind === "character" ? [characters] : STAGES) await stage(doc, ctx)
  const written = await writePiece(doc, roots.library, pack.id, source.slug)
  return toEntry(pack, source, out, written)
}

export interface PackSummary {
  id: string
  pieces: { slug: string; source: string; category: string; cached: boolean }[]
  imported: number
  cached: number
  failed: string[]
  removed: number
}

export interface ImportOptions {
  paths: Paths
  packs: PackConfig[]
  force?: boolean
  dry?: boolean
  jobs?: number
}

/**
 * Runs the import for the given packs and returns what happened per pack. The rigs the given packs
 * declare are built first, so a character finds its rig in the same run.
 */
export async function runImport(opts: ImportOptions): Promise<PackSummary[]> {
  const { paths, force = false, dry = false } = opts
  const logger = log("import")
  const summaries: PackSummary[] = []
  const rigs = dry ? undefined : await buildRigs(opts.packs, paths, logger)
  const pool = dry ? undefined : new Pool(Math.max(1, opts.jobs ?? 1), paths)
  try {
    for (const pack of opts.packs) {
      if (!existsSync(join(paths.raw, pack.source))) {
        logger.warn(`${pack.id}: source folder "${pack.source}" not found under ${paths.raw}; skipped`)
        continue
      }
      summaries.push(await runPack(pack, paths, { force, dry, pool }))
    }
  } finally {
    pool?.close()
  }
  if (!dry)
    writeIndex(paths.library, PALETTE, Object.fromEntries(opts.packs.map((p) => [p.id, p.vendor])), rigs)
  return summaries
}

/** Builds the rigs every given pack declares (all of them together, so packs can share a rig). */
function buildRigs(packs: readonly PackConfig[], paths: Paths, logger: Logger): Promise<RigEntry[]> {
  const declaring = packs.filter((p) => (p.rigs?.length ?? 0) > 0)
  return declaring.length === 0
    ? Promise.resolve([])
    : importRigs(declaring, paths.raw, paths.library, logger.child("rigs"))
}

let vocab: Vocab | undefined

/**
 * A fresh entry with what `tag apply` added to its previous one: the answer cached for its thumbnail
 * (as `tag apply` writes it), else the previous entry's autoTags and vision front. Rule and manual
 * compose meta always come fresh from the config.
 */
function withVision(library: string, cache: TagCache, e: CatalogEntry, old?: CatalogEntry): CatalogEntry {
  const hash = thumbHash(library, e.files.thumb)
  if (hash && cache[hash]) {
    vocab ??= loadVocab()
    return withAnswer(e, hash, cache, vocab)
  }
  const out: CatalogEntry = old?.autoTags ? { ...e, autoTags: old.autoTags } : e
  if (old?.compose.source === "vision" && e.compose.source === "placeholder")
    out.compose = { ...e.compose, front: old.compose.front, source: "vision" }
  return out
}

async function runPack(
  pack: PackConfig,
  paths: Paths,
  run: { force: boolean; dry: boolean; pool: Pool | undefined },
): Promise<PackSummary> {
  const files = discover(pack, paths.raw)
  const clashes = pack.split === "top-nodes" ? [] : slugClashes(files)
  if (clashes.length > 0)
    throw new Error(`slug clashes (exclude or override one):\n  ${clashes.join("\n  ")}`)
  const cache: PackCache = loadCache(paths.library, pack.id)
  const previous = readShard(paths.library, pack.id)
  const keys = new Map<string, string>()
  for (const f of files)
    keys.set(
      f.slug,
      pieceKey({
        source: await Bun.file(f.file).bytes(),
        pack,
        palette: paletteHash(PALETTE),
        importer: IMPORTER,
      }),
    )
  const fromFile = (f: PieceSource) =>
    previous.filter((e) => e.source === f.source || e.source.startsWith(`${f.source}#`))
  const isCached = (f: PieceSource): boolean =>
    !run.force &&
    cache[f.slug] === keys.get(f.slug) &&
    fromFile(f).length > 0 &&
    fromFile(f).every((e) => existsSync(join(paths.library, e.files.glb)))
  const summary: PackSummary = {
    id: pack.id,
    pieces: files.map((f) => ({ slug: f.slug, source: f.source, category: f.category, cached: isCached(f) })),
    imported: 0,
    cached: 0,
    failed: [],
    removed: 0,
  }
  if (run.dry || !run.pool) return summary

  const entries: CatalogEntry[] = []
  const nextCache: PackCache = {}
  const todo: PieceSource[] = []
  for (const f of files) {
    if (isCached(f)) {
      entries.push(...fromFile(f))
      nextCache[f.slug] = cache[f.slug] as string
      summary.cached++
    } else todo.push(f)
  }
  const pool = run.pool
  const tags = loadTagCache(paths.library)
  await Promise.all(
    todo.map(async (f) => {
      try {
        const made = await pool.run(pack, f)
        const before = new Map(fromFile(f).map((e) => [e.id, e]))
        // A re-import keeps what later steps added: the thumbnail path, then the vision answer cached
        // for that thumbnail (autoTags, and front over placeholder meta), as `tag apply` writes it.
        for (const e of made) {
          const old = before.get(e.id)
          if (old?.files.thumb) e.files.thumb = old.files.thumb
          entries.push(withVision(paths.library, tags, e, old))
        }
        nextCache[f.slug] = keys.get(f.slug) as string
        summary.imported++
      } catch (err) {
        summary.failed.push(`${f.source}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }),
  )
  const ids = new Set<string>()
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`${e.id}: two pieces share this id (exclude or override one)`)
    ids.add(e.id)
  }
  writeShard(paths.library, pack.id, entries)
  saveCache(paths.library, pack.id, nextCache)
  summary.removed = removeOrphans(paths.library, pack.id, new Set(entries.map((e) => e.files.glb)))
  return summary
}

interface Job {
  id: number
  packs: string
  raw: string
  library: string
  pack: string
  file: PieceSource
}
type Reply = { id: number; entries: CatalogEntry[] } | { id: number; error: string }

/** Runs `importFile` one at a time in-process (size 1), or across `size` Bun workers. */
class Pool {
  private readonly idle: Worker[] = []
  private readonly all: Worker[] = []
  private readonly waiting: (() => void)[] = []
  private readonly pending = new Map<
    Worker,
    { resolve: (e: CatalogEntry[]) => void; reject: (e: Error) => void }
  >()
  private serial: Promise<unknown> = Promise.resolve()
  private next = 0

  constructor(
    size: number,
    private readonly paths: Paths,
  ) {
    if (size <= 1) return
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./pipeline.ts", import.meta.url).href)
      w.onmessage = (ev: MessageEvent<Reply>) =>
        this.settle(w, "error" in ev.data ? new Error(ev.data.error) : ev.data.entries)
      w.onerror = (ev: ErrorEvent) => this.settle(w, new Error(`worker crashed: ${ev.message}`))
      this.all.push(w)
      this.idle.push(w)
    }
  }

  run(pack: PackConfig, file: PieceSource): Promise<CatalogEntry[]> {
    if (this.all.length === 0) {
      const job = this.serial.then(() => importFile(pack, file, this.paths))
      this.serial = job.catch(() => undefined)
      return job
    }
    return this.acquire().then(
      (worker) =>
        new Promise((resolve, reject) => {
          this.pending.set(worker, { resolve, reject })
          const job: Job = {
            id: this.next++,
            packs: this.paths.packs,
            raw: this.paths.raw,
            library: this.paths.library,
            pack: pack.id,
            file,
          }
          worker.postMessage(job)
        }),
    )
  }

  private settle(w: Worker, result: CatalogEntry[] | Error): void {
    const job = this.pending.get(w)
    this.pending.delete(w)
    if (result instanceof Error) job?.reject(result)
    else job?.resolve(result)
    this.idle.push(w)
    this.waiting.shift()?.()
  }

  private acquire(): Promise<Worker> {
    const w = this.idle.pop()
    if (w) return Promise.resolve(w)
    return new Promise((resolve) => this.waiting.push(() => resolve(this.idle.pop() as Worker)))
  }

  close(): void {
    for (const w of this.all) w.terminate()
  }
}

if (!Bun.isMainThread) {
  const port = globalThis as unknown as {
    onmessage: (ev: MessageEvent<Job>) => void
    postMessage: (reply: Reply) => void
  }
  const configs = new Map<string, Promise<PackConfig[]>>()
  port.onmessage = async ({ data: job }) => {
    try {
      if (!configs.has(job.packs)) configs.set(job.packs, loadPacks(job.packs))
      const pack = (await configs.get(job.packs))?.find((p) => p.id === job.pack)
      if (!pack) throw new Error(`unknown pack ${job.pack}`)
      port.postMessage({
        id: job.id,
        entries: await importFile(pack, job.file, { raw: job.raw, library: job.library }),
      })
    } catch (err) {
      port.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
}
