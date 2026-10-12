import { createReadStream, statSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { type Connect, defineConfig, type Plugin } from "vite"

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

/** The generated asset library at the repo root (tools/import writes it). It may not exist yet. */
const LIBRARY = fileURLToPath(new URL("../../library", import.meta.url))

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

export default defineConfig({
  // `/library/` is what the importer wrote; `/raw/` is the untouched packs, for the lineup preview.
  plugins: [react(), folder("library", LIBRARY), folder("raw", RAW)],
  server: { port: 5300, strictPort: true },
  build: {
    rollupOptions: {
      // The studio, and the thumbnail page tools/import drives headless.
      input: { main: page("index.html"), thumbs: page("thumbs.html") },
    },
  },
})
