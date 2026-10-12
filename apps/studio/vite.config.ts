import { randomUUID } from "node:crypto"
import { createReadStream, statSync } from "node:fs"
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { PALETTE, validateMounts, validateNpc, validatePrefab } from "@guildhall/assets"
import react from "@vitejs/plugin-react"
import { type Connect, defineConfig, type Plugin } from "vite"

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

/** The generated asset library at the repo root (tools/import writes it). It may not exist yet. */
const LIBRARY = fileURLToPath(new URL("../../library", import.meta.url))

/** Authored, committed data at the repo root (ADR 005): recipes, mounts, npcs, town presets. */
const DATA = fileURLToPath(new URL("../../data", import.meta.url))

/** The raw vendor packs the lineup screen previews: `$GUILDHALL_ASSETS`, else the repo's `assets/src`. */
const RAW = resolve(
  process.env.GUILDHALL_ASSETS || fileURLToPath(new URL("../../assets/src", import.meta.url)),
)

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

/** The largest data file the endpoint accepts. */
export const MAX_DATA_BYTES = 1 << 20

/** A data file name: kebab-case, as the S1 validators require of ids. */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The folders under `data/recipes/` (plan §2.1); each holds `<id>.json` prefab recipes. */
const RECIPE_FOLDERS = ["houses", "landmarks", "stalls", "docks", "farm"]

/** Folders whose `<id>.json` files the endpoint lists, reads and writes. */
export const DATA_FOLDERS = [...RECIPE_FOLDERS.map((f) => `recipes/${f}`), "npcs", "towns"]

type Validate = (json: unknown) => string[]

/** No town validator exists yet (W1 owns TownSpec); until one lands a preset need only be an object. */
const validateTown: Validate = (json) =>
  json !== null && typeof json === "object" && !Array.isArray(json) ? [] : ["town: expected an object"]

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
  if (folder === "towns") return validateTown
  return (json) => validatePrefab(json, PALETTE)
}

/** Data as the writer stores it: keys sorted at every depth, 2-space indent, final newline (biome-clean). */
export function formatData(value: unknown): string {
  const sorted = (_key: string, v: unknown): unknown =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  return `${JSON.stringify(value, sorted, 2)}\n`
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

export default defineConfig({
  // `/library/` is what the importer wrote; `/raw/` is the untouched packs, for the lineup preview;
  // `/data/` is the authored data the studio edits.
  plugins: [react(), folder("library", LIBRARY), folder("raw", RAW), data(DATA)],
  server: { port: 5300, strictPort: true },
  build: {
    rollupOptions: {
      // The studio, and the thumbnail page tools/import drives headless.
      input: { main: page("index.html"), thumbs: page("thumbs.html") },
    },
  },
})
