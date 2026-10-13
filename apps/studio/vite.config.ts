import { createHash, randomUUID } from "node:crypto"
import { createReadStream, readFileSync, statSync } from "node:fs"
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { homedir } from "node:os"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type CatalogEntry,
  type CatalogIndex,
  inStyle,
  PALETTE,
  validateMounts,
  validateNpc,
  validatePrefab,
} from "@guildhall/assets"
import react from "@vitejs/plugin-react"
import { type Connect, defineConfig, type Plugin } from "vite"
// the validator alone (its module only imports types): the world package itself does not load in a config
import { validateTilePrefab } from "../../packages/world/src/hex/prefabs.ts"
import { formatData } from "./src/json.ts"

export { formatData }

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

/** The generated asset library at the repo root (tools/import writes it). It may not exist yet. */
const LIBRARY = fileURLToPath(new URL("../../library", import.meta.url))

/** Authored, committed data at the repo root (ADR 005): recipes, mounts, npcs, tile prefabs. */
const DATA = fileURLToPath(new URL("../../data", import.meta.url))

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
}

/** Serves the folder `root` at `/<name>/` in dev and preview, never anything outside it (no `../`). */
function folder(name: string, root: string): Plugin {
  const prefix = `/${name}/`
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0] ?? ""
    if (!url.startsWith(prefix)) return next()
    const file = resolve(root, decodeURIComponent(url.slice(prefix.length)))
    if (!file.startsWith(root + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream")
    createReadStream(file).pipe(res)
  }
  return {
    name: `guildhall-${name}`,
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  }
}

/** Where the legacy hub writes its guild chronicles (V1 ADR 0003; GUILDHALL_HOME as the hub reads it). */
const CHRONICLES = join(process.env.GUILDHALL_HOME ?? join(homedir(), ".cache", "guildhall"), "chronicles")

/**
 * `/chronicles/`, the dev server only (never a build, the preview or the showcase): the hub's recorded
 * sessions for the hall's replay feed (hall/feeds/replay.ts). They hold the user's prompts, so only a
 * page on this machine may read them: a loopback socket AND a loopback Host (a tunnel connects from
 * loopback too, under its own name). `/chronicles/<guild>/` lists the guild's event chronicles, newest
 * first; `/chronicles/<guild>/latest.jsonl` is the newest; `/chronicles/<guild>/<boot>.jsonl` one boot's.
 */
function chronicles(root: string): Plugin {
  const local = (req: IncomingMessage) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "")
    return LOOPBACK.has(req.socket.remoteAddress ?? "") && LOCAL_HOSTS.has(host) && isLocal(req)
  }
  const handle: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0] ?? ""
    if (!url.startsWith("/chronicles/")) return next()
    if (!local(req)) return reply(res, 403, { error: "chronicles are for this machine only" })
    let parts: string[]
    try {
      parts = url.slice("/chronicles/".length).split("/").map(decodeURIComponent)
    } catch {
      return reply(res, 400, { error: "bad path" })
    }
    const [guild = "", file = ""] = parts
    if (parts.length !== 2 || !guild || /[/\\\0]/.test(guild) || guild.startsWith("."))
      return reply(res, 404, {})
    const dir = resolve(root, guild)
    if (!dir.startsWith(root + sep)) return reply(res, 404, {})
    const boots = () =>
      readdir(dir)
        .then((all) =>
          all.filter((f) => f.endsWith(".jsonl") && !f.endsWith(".raw.jsonl") && !f.endsWith(".sea.jsonl")),
        )
        .then((all) => all.sort().reverse())
        .catch(() => [] as string[])
    void (async () => {
      if (file === "") {
        const list = await boots()
        const sized = await Promise.all(
          list.map(async (f) => ({ file: f, bytes: (await stat(join(dir, f))).size })),
        )
        return reply(res, 200, { guild, chronicles: sized })
      }
      const pick = file === "latest.jsonl" ? (await boots())[0] : file
      if (!pick || !/^[A-Za-z0-9._-]+\.jsonl$/.test(pick) || pick.endsWith(".raw.jsonl"))
        return reply(res, 404, {})
      const path = join(dir, pick)
      if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return reply(res, 404, {})
      res.setHeader("Content-Type", "application/x-ndjson")
      res.setHeader("Cache-Control", "no-store")
      createReadStream(path).pipe(res)
    })().catch((error: unknown) => reply(res, 500, { error: String(error) }))
  }
  return {
    name: "guildhall-chronicles",
    apply: "serve",
    configureServer: (server) => void server.middlewares.use(handle),
  }
}

/** The largest data file the endpoint accepts. */
export const MAX_DATA_BYTES = 1 << 20

/** A data file name: kebab-case, as the S1 validators require of ids. */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The folders under `data/recipes/` (plan §2.1); each holds `<id>.json` prefab recipes. */
const RECIPE_FOLDERS = ["houses", "landmarks", "stalls", "docks", "farm", "vignettes"]

/** Folders whose `<id>.json` files the endpoint lists, reads and writes. */
export const DATA_FOLDERS = [...RECIPE_FOLDERS.map((f) => `recipes/${f}`), "npcs", "tiles"]

type Validate = (json: unknown) => string[]

/**
 * The validator for a data path (relative to `data/`, already URL-decoded), or null when the path is not
 * a data file. Every segment must be a known folder or a kebab-case id, so `..`, absolute paths,
 * backslashes, dot-files and unknown folders are all refused here, before the disk is touched.
 */
export function dataRoute(path: string): Validate | null {
  if (path === "mounts.json") return validateMounts
  const slash = path.lastIndexOf("/")
  const folder = path.slice(0, slash)
  const file = path.slice(slash + 1)
  if (!DATA_FOLDERS.includes(folder) || !file.endsWith(".json") || !ID.test(file.slice(0, -5))) return null
  if (folder === "npcs") return (json) => validateNpc(json, PALETTE)
  if (folder === "tiles") return (json) => validateTilePrefab(json, file.slice(0, -5))
  return (json) => validatePrefab(json, PALETTE)
}

/** True when `rel` (under the real `root`), or any folder on the way to it, is a symlink. */
async function viaSymlink(root: string, rel: string): Promise<boolean> {
  let at = root
  for (const part of rel.split("/")) {
    at = join(at, part)
    const stat = await lstat(at).catch(() => null)
    if (!stat) return false
    if (stat.isSymbolicLink()) return true
  }
  return false
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/** A write must come from this machine, and from a local page when a browser says where it came from. */
function isLocal(req: IncomingMessage): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

/** The request body as text, or null once it passes `limit` bytes. */
async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  if (Number(req.headers["content-length"] ?? 0) > limit) return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(body))
}

/** Writes through a temporary file in the same folder, so a reader never sees half a file. */
async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, text, { flag: "wx" })
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/**
 * `/data/` over the folder `root`. GET `<folder>/` lists the ids in a data folder and GET `<path>.json`
 * reads one file; with `write`, PUT `<path>.json` validates the JSON body and stores it (see `dataRoute`).
 * Nothing outside the known data paths is served or written, and no symlink is followed.
 */
export function dataHandler(root: string, { write }: { write: boolean }): Connect.NextHandleFunction {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = (req.url ?? "").split("?")[0] ?? ""
    let rel: string
    try {
      rel = decodeURIComponent(url.slice("/data/".length))
    } catch {
      return reply(res, 400, { error: "bad path encoding" })
    }
    const listing = rel.endsWith("/") && DATA_FOLDERS.includes(rel.slice(0, -1))
    const validate = listing ? null : dataRoute(rel)
    if (!listing && !validate) return reply(res, 404, { error: "not a data file" })
    const base = await realpath(root)
    if (await viaSymlink(base, listing ? rel.slice(0, -1) : rel))
      return reply(res, 403, { error: "symlinks are not followed" })
    const target = join(base, rel)

    if (req.method === "GET" || req.method === "HEAD") {
      if (listing) {
        const names = await readdir(target, { withFileTypes: true }).catch(() => [])
        const ids = names
          .filter((d) => d.isFile() && d.name.endsWith(".json") && ID.test(d.name.slice(0, -5)))
          .map((d) => d.name.slice(0, -5))
          .sort()
        return reply(res, 200, ids)
      }
      const text = await readFile(target, "utf8").catch(() => null)
      if (text === null) return reply(res, 404, { error: "no such file" })
      res.setHeader("Content-Type", "application/json")
      return void res.end(text)
    }

    if (req.method !== "PUT" || !write || !validate) return reply(res, 405, { error: "method not allowed" })
    if (!isLocal(req)) return reply(res, 403, { error: "writes are local only" })
    if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
      return reply(res, 415, { error: "expected application/json" })
    const body = await readBody(req, MAX_DATA_BYTES)
    if (body === null) return reply(res, 413, { error: `larger than ${MAX_DATA_BYTES} bytes` })
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      return reply(res, 400, { error: "not JSON" })
    }
    const problems = validate(json)
    if (problems.length > 0) return reply(res, 422, { problems })
    await mkdir(dirname(target), { recursive: true })
    await writeAtomic(target, formatData(json))
    return reply(res, 200, { path: rel })
  }
  return (req, res, next) => {
    if (!(req.url ?? "").startsWith("/data/")) return next()
    handle(req, res).catch((error: unknown) => reply(res, 500, { error: String(error) }))
  }
}

/** `/data/`: reads in dev and preview, writes in the dev server only (never in a build or preview). */
function data(root: string): Plugin {
  return {
    name: "guildhall-data",
    apply: "serve",
    configureServer: (server) => void server.middlewares.use(dataHandler(root, { write: true })),
    configurePreviewServer: (server) => void server.middlewares.use(dataHandler(root, { write: false })),
  }
}

/** `bun run build:showcase` / `preview:showcase`: the read-only public build (src/env.ts reads the same flag). */
const SHOWCASE = process.env.VITE_STUDIO_SHOWCASE === "1"

/** The library folders the showcase ships; never `.cache`, nor the importer's working folders. */
export const SHOWCASE_LIBRARY = ["catalog", "pieces", "rigs", "thumbs"]
const LEFT_OUT = new Set(["tags", "batches"])

/**
 * What the showcase ships of the library, from `STUDIO_LIBRARY` at build time:
 *   "style" (the default)  the house style's packs alone (STYLE_PACKS): their catalog shards, the
 *                          pieces and thumbnails those shards name, and the rigs their characters use;
 *   "full"                 every imported pack, as it is on disk (`?packs=all` then shows them all);
 *   an https URL           nothing: the page reads `<url>/catalog/index.json` and the rest from there
 *                          (a CDN or bucket holding the same layout, e.g. the "style" copy uploaded).
 */
export type LibraryMode = { kind: "style" } | { kind: "full" } | { kind: "remote"; url: string }

export function libraryMode(value: string | undefined): LibraryMode {
  const v = (value ?? "").trim()
  if (v === "" || v === "style") return { kind: "style" }
  if (v === "full") return { kind: "full" }
  if (/^https:\/\/[^\s]+$/.test(v)) return { kind: "remote", url: v.replace(/\/+$/, "") }
  throw new Error(`STUDIO_LIBRARY: expected "style", "full" or an https URL, got "${v}"`)
}

/** The house-style subset of a library: the index to ship and every library-relative file it needs. */
export interface LibrarySubset {
  index: CatalogIndex
  files: string[]
}

/** Reads the library at `root` and keeps the house style's packs and what their entries name. */
export async function styleSubset(root: string): Promise<LibrarySubset> {
  const full = JSON.parse(await readFile(join(root, "catalog", "index.json"), "utf8")) as CatalogIndex
  const packs = full.packs.filter((p) => inStyle(p.id))
  const files = new Set<string>(["catalog/index.json"])
  const rigs = new Set<string>()
  for (const { id } of packs) {
    files.add(`catalog/${id}.json`)
    const shard = JSON.parse(await readFile(join(root, "catalog", `${id}.json`), "utf8")) as CatalogEntry[]
    for (const entry of shard) {
      for (const path of Object.values(entry.files)) if (typeof path === "string") files.add(path)
      if (entry.character) rigs.add(entry.character.rig)
    }
  }
  const keptRigs = full.rigs.filter((r) => rigs.has(r.id))
  for (const rig of keptRigs) files.add(rig.file)
  return { index: { ...full, packs, rigs: keptRigs }, files: [...files].sort() }
}

/** Every file the "full" mode ships: the SHOWCASE_LIBRARY folders, minus dot-files and importer caches. */
async function everyFile(root: string): Promise<string[]> {
  const files: string[] = []
  for (const folder of SHOWCASE_LIBRARY) {
    const entries = await readdir(join(root, folder), { withFileTypes: true, recursive: true }).catch(
      () => [],
    )
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const rel = join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .split(sep)
        .join("/")
      const parts = rel.split("/")
      if (parts.some((p) => p.startsWith(".") || LEFT_OUT.has(p))) continue
      // thumbs/<pack>.json is the importer's thumbnail hash cache, not read by the page
      if (parts[0] === "thumbs" && parts.length === 2 && rel.endsWith(".json")) continue
      files.push(rel)
    }
  }
  return files.sort()
}

/**
 * The library as a showcase ships it: the files, the index written in place of the library's own (the
 * style subset names fewer packs; null keeps it), and `version`, a hash of every shipped path and byte.
 * The build serves the library under `/library/<version>/`, so every file in it can be cached as
 * immutable: a re-import that changes any byte ships under a new folder.
 */
export interface ShippedLibrary {
  root: string
  files: string[]
  index: CatalogIndex | null
  version: string
}

const INDEX = "catalog/index.json"
const indexText = (index: CatalogIndex) => `${JSON.stringify(index, null, 2)}\n`

export async function planLibrary(library: string, mode: "style" | "full"): Promise<ShippedLibrary> {
  const root = await realpath(library).catch(() => null)
  if (!root) throw new Error(`showcase: no library at ${library} (run bun import first)`)
  const { files, index } =
    mode === "style" ? await styleSubset(root) : { files: await everyFile(root), index: null }
  const hash = createHash("sha256")
  for (const rel of files) {
    hash.update(`${rel}\n`)
    hash.update(rel === INDEX && index ? indexText(index) : await readFile(join(root, rel)))
  }
  return { root, files, index, version: hash.digest("hex").slice(0, 12) }
}

/** Copies a planned library into `out` (each path checked to stay inside the library). */
async function copyLibrary(plan: ShippedLibrary, out: string): Promise<void> {
  for (const rel of plan.files) {
    const to = join(out, rel)
    await mkdir(dirname(to), { recursive: true })
    if (rel === INDEX && plan.index) {
      await writeFile(to, indexText(plan.index))
      continue
    }
    const from = resolve(plan.root, rel)
    if (!from.startsWith(plan.root + sep)) throw new Error(`showcase: ${rel} is outside the library`)
    await cp(from, to, { dereference: true })
  }
}

/** Every file under `dir`: how many, and their bytes. */
async function measure(dir: string): Promise<{ files: number; bytes: number }> {
  const total = { files: 0, bytes: 0 }
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    total.files += 1
    total.bytes += (await stat(join(entry.parentPath, entry.name))).size
  }
  return total
}

/**
 * The showcase's static copy of `data/`: mounts.json and every valid `<folder>/<id>.json`, plus
 * `index.json` naming each folder's ids (a static host has no folder listing; src/data.ts reads it).
 */
export async function copyData(root: string, out: string): Promise<Record<string, string[]>> {
  const index: Record<string, string[]> = {}
  await mkdir(out, { recursive: true })
  const mounts = join(root, "mounts.json")
  if (statSync(mounts, { throwIfNoEntry: false })?.isFile()) await cp(mounts, join(out, "mounts.json"))
  for (const folder of DATA_FOLDERS) {
    const names = await readdir(join(root, folder), { withFileTypes: true }).catch(() => [])
    const ids = names
      .filter((d) => d.isFile() && d.name.endsWith(".json") && ID.test(d.name.slice(0, -5)))
      .map((d) => d.name.slice(0, -5))
      .sort()
    if (ids.length === 0) continue
    await mkdir(join(out, folder), { recursive: true })
    for (const id of ids) await cp(join(root, folder, `${id}.json`), join(out, folder, `${id}.json`))
    index[folder] = ids
  }
  await writeFile(join(out, "index.json"), formatData(index))
  return index
}

/** After a showcase build: the library and the data beside the app, so it runs with no server behind it. */
function showcase(plan: ShippedLibrary | null, mode: LibraryMode, data: string): Plugin {
  let outDir = "dist"
  return {
    name: "guildhall-showcase",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      const lib = plan ? join(outDir, "library", plan.version) : null
      if (plan && lib) await copyLibrary(plan, lib)
      const index = await copyData(data, join(outDir, "data"))
      const shipped = lib ? await measure(lib) : null
      const all = await measure(outDir)
      const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`
      const recipes = Object.entries(index).map(([folder, ids]) => `${folder} ${ids.length}`)
      this.info(
        `library ${mode.kind === "remote" ? `read from ${mode.url}` : `${mode.kind} /library/${plan?.version}/`}` +
          `${shipped ? `: ${shipped.files} files, ${mb(shipped.bytes)}` : ""}; ` +
          `data ${recipes.join(", ") || "mounts only"}; dist ${all.files} files, ${mb(all.bytes)}`,
      )
    },
  }
}

/** The host's config for the public site (the proposal the deploy uses; deploy/plan in .probe). */
export const HOST_CONFIG = fileURLToPath(new URL("../../deploy/vercel.v2.json", import.meta.url))

interface HostConfig {
  rewrites?: { source: string; destination: string }[]
  headers?: { source: string; headers: { key: string; value: string }[] }[]
}

/**
 * A vercel.json's rewrites and headers as the host applies them to a path. The sources here are plain
 * regular expressions (groups, alternations, `.*`, escaped dots), which path-to-regexp reads the same
 * way; named `:params` are not used, so the file needs no translation.
 */
export function hostRules(config: HostConfig) {
  const whole = (source: string) => new RegExp(`^${source}$`)
  const rewrites = (config.rewrites ?? []).map((r) => ({ test: whole(r.source), to: r.destination }))
  const headers = (config.headers ?? []).map((h) => ({ test: whole(h.source), set: h.headers }))
  return {
    /** Where a path that is not a file is rewritten to, or null (the host's 404). */
    rewrite: (path: string): string | null => rewrites.find((r) => r.test.test(path))?.to ?? null,
    /** Every header the host sends for a path; a later rule wins for the same key. */
    headers: (path: string): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const rule of headers) if (rule.test.test(path)) for (const h of rule.set) out[h.key] = h.value
      return out
    },
  }
}

/**
 * The showcase preview answers like the host: deploy/vercel.v2.json's headers on every answer (so the
 * CSP is tried locally), a file when there is one, index.html for a path the rewrites name, and
 * 404.html with a 404 status for anything else (a missing `/library/` piece included), where vite's SPA
 * fallback would otherwise answer every path with the app.
 */
function hostLike(): Plugin {
  return {
    name: "guildhall-host-like",
    configurePreviewServer(server) {
      const dist = resolve(server.config.root, server.config.build.outDir)
      const rules = hostRules(JSON.parse(readFileSync(HOST_CONFIG, "utf8")) as HostConfig)
      server.middlewares.use((req, res, next) => {
        const [path = "/", query] = (req.url ?? "/").split("?")
        for (const [key, value] of Object.entries(rules.headers(path))) res.setHeader(key, value)
        let file: string
        try {
          file = resolve(dist, `.${decodeURIComponent(path)}`)
        } catch {
          file = ""
        }
        const inside = file === dist || file.startsWith(dist + sep)
        if (path === "/" || (inside && statSync(file, { throwIfNoEntry: false })?.isFile())) return next()
        const to = rules.rewrite(path)
        if (to) {
          req.url = query === undefined ? to : `${to}?${query}`
          return next()
        }
        res.statusCode = 404
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        createReadStream(join(dist, "404.html")).pipe(res)
      })
    },
  }
}

/**
 * The public site's origin (STUDIO_SITE_URL), for what must be absolute: the social card's image,
 * robots.txt's sitemap line and the sitemap. The default is the host decided for the showcase.
 */
export const SITE_URL = (process.env.STUDIO_SITE_URL ?? "https://studio.guildhall.codestz.dev").replace(
  /\/+$/,
  "",
)

/** The public pages a crawler is pointed at (the Studio's tools and the labs are reachable from them). */
export const SITEMAP_PATHS = ["/", "/demos", "/harbour", "/built", "/studio", "/hall/facebook/react"]

export function sitemap(site: string, paths: readonly string[] = SITEMAP_PATHS): string {
  const urls = paths.map((p) => `  <url><loc>${site}${p}</loc></url>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export const robots = (site: string): string => `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`

/** `%SITE_URL%` in index.html becomes the site's origin. */
function siteUrl(site: string): Plugin {
  return { name: "guildhall-site-url", transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", site) }
}

/**
 * After a showcase build: robots.txt, sitemap.xml, and 404.html (the app itself, which draws its own
 * "Not found" for a path no route answers; the host serves it with a 404 status for any path its
 * rewrites do not send to index.html).
 */
function publicFiles(site: string): Plugin {
  let outDir = "dist"
  return {
    name: "guildhall-public-files",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      await writeFile(join(outDir, "robots.txt"), robots(site))
      await writeFile(join(outDir, "sitemap.xml"), sitemap(site))
      await cp(join(outDir, "index.html"), join(outDir, "404.html"))
    },
  }
}

export default defineConfig(async ({ command }) => {
  // The showcase's library (STUDIO_LIBRARY): planned once, before the bundle, so the page is built
  // knowing the versioned folder it reads from. Dev and the plain build serve the library as it is.
  const mode: LibraryMode = SHOWCASE ? libraryMode(process.env.STUDIO_LIBRARY) : { kind: "full" }
  const plan =
    SHOWCASE && command === "build" && mode.kind !== "remote" ? await planLibrary(LIBRARY, mode.kind) : null
  const libraryUrl = mode.kind === "remote" ? mode.url : plan ? `/library/${plan.version}` : ""
  return {
    // src/env.ts: where the page reads the library ("" = vite's own `/library/`)
    define: { "import.meta.env.VITE_LIBRARY_URL": JSON.stringify(libraryUrl) },
    // `/library/` is what the importer wrote; `/data/` is the authored data the studio edits. The showcase
    // serves neither: its build copies the library and the data into dist, and its preview serves dist
    // alone, as the host will.
    plugins: [
      react(),
      siteUrl(SITE_URL),
      ...(SHOWCASE
        ? [showcase(plan, mode, DATA), publicFiles(SITE_URL), hostLike()]
        : [folder("library", LIBRARY), data(DATA), chronicles(CHRONICLES)]),
    ],
    // a Cloudflare quick tunnel may serve the dev Studio to a phone (writes stay local: `isLocal`)
    server: { port: 5300, strictPort: true, allowedHosts: [".trycloudflare.com"] },
    preview: { port: 5310, strictPort: true },
    build: {
      rollupOptions: {
        // The studio, and (not in the showcase) the thumbnail page tools/import drives headless.
        input: SHOWCASE
          ? { main: page("index.html") }
          : { main: page("index.html"), thumbs: page("thumbs.html") },
      },
    },
  }
})
