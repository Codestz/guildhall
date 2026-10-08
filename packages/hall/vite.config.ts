import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { type Connect, defineConfig, type Plugin } from "vite"

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

/** `/how` serves how.html in dev and preview, as vercel.json's rewrite does on the site. */
function cleanHow(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const clean = /^\/how\/?(\?.*)?$/.exec(req.url ?? "")
    if (clean) req.url = `/how.html${clean[1] ?? ""}`
    next()
  }
  return {
    name: "guildhall-clean-how",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  }
}

export default defineConfig({
  plugins: [react(), cleanHow()],
  build: {
    rollupOptions: {
      // The hall, and the "How it's built" page (/how): a static long read with no app code.
      input: { main: page("index.html"), how: page("how.html") },
    },
  },
})
