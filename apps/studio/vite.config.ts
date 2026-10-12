import { createReadStream, statSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { type Connect, defineConfig, type Plugin } from "vite"

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

/** The generated asset library at the repo root (tools/import writes it). It may not exist yet. */
const LIBRARY = fileURLToPath(new URL("../../library", import.meta.url))

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".webp": "image/webp",
  ".png": "image/png",
}

/** Serves the repo's `library/` at `/library/` in dev and preview, so the studio fetches what the importer wrote. */
function library(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0] ?? ""
    if (!url.startsWith("/library/")) return next()
    const file = resolve(LIBRARY, decodeURIComponent(url.slice("/library/".length)))
    if (!file.startsWith(LIBRARY + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream")
    createReadStream(file).pipe(res)
  }
  return {
    name: "guildhall-library",
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  }
}

export default defineConfig({
  plugins: [react(), library()],
  server: { port: 5300, strictPort: true },
  build: {
    rollupOptions: {
      // The studio, and the thumbnail page tools/import drives headless.
      input: { main: page("index.html"), thumbs: page("thumbs.html") },
    },
  },
})
