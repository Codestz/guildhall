import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { type Connect, defineConfig, type Plugin } from "vite"

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

/** `/how` and `/harbour` serve their .html in dev and preview, as vercel.json's rewrites do on the site. */
function cleanPages(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const clean = /^\/(how|harbour)\/?(\?.*)?$/.exec(req.url ?? "")
    if (clean) req.url = `/${clean[1]}.html${clean[2] ?? ""}`
    next()
  }
  return {
    name: "guildhall-clean-pages",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  }
}

export default defineConfig({
  plugins: [react(), cleanPages()],
  build: {
    rollupOptions: {
      // The hall; the "How it's built" page (/how), a static long read with no app code; and the
      // Harbour (/harbour), the chronicled repos, a few kilobytes of plain DOM (hud/harbour.ts).
      input: { main: page("index.html"), how: page("how.html"), harbour: page("harbour.html") },
    },
  },
})
