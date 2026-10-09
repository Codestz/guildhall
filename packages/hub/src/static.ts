import { readFileSync, statSync } from "node:fs"
import { extname, resolve, sep } from "node:path"

/**
 * The built hall, served by the hub at `/` (ADR 0002: no separate web install). Only files inside
 * `root`; no listings, no dotfiles. Vite's fingerprinted bundles (`index-CQvrk4PR.js`) never change
 * under their name, so they are cached for a year; everything else (index.html, the models and
 * sounds copied from `public/`) is revalidated against its modification time, so an upgraded
 * package is seen on the next load.
 */

/** Vite's output names: `[name]-[hash].js|css`, an 8-character hash. Models and sounds keep their names. */
const FINGERPRINTED = /-[A-Za-z0-9_-]{8}\.(?:js|css)$/

/** Content types on Node, for what a hall is built from; Bun's own table on Bun. */
const TYPES: Record<string, string> = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".md": "text/markdown;charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
}

export function serveStatic(root: string, request: Request, pathname: string): Response {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
  let path: string
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return new Response("bad path", { status: 400 })
  }
  if (path.endsWith("/")) path += "index.html"
  const base = resolve(root)
  const file = resolve(base, `.${path}`)
  if (
    path.includes("\0") ||
    !file.startsWith(base + sep) ||
    file
      .slice(base.length + 1)
      .split(sep)
      .some((part) => part.startsWith("."))
  )
    return new Response("not found", { status: 404 })
  let modified: Date
  try {
    const stat = statSync(file)
    if (!stat.isFile()) return new Response("not found", { status: 404 })
    modified = stat.mtime
  } catch {
    return new Response("not found", { status: 404 })
  }
  // On Node (serve-node.ts), the file read whole and typed by its extension; the largest are a few MB.
  const bun = typeof Bun !== "undefined"
  const body = bun ? Bun.file(file) : readFileSync(file)
  const headers = new Headers({
    "content-type": bun ? (body as Blob).type : (TYPES[extname(file)] ?? "application/octet-stream"),
    "x-content-type-options": "nosniff",
  })
  if (FINGERPRINTED.test(file)) headers.set("cache-control", "public, max-age=31536000, immutable")
  else {
    headers.set("cache-control", "no-cache")
    // HTTP dates have whole seconds.
    const lastModified = new Date(Math.floor(modified.getTime() / 1000) * 1000)
    headers.set("last-modified", lastModified.toUTCString())
    const since = Date.parse(request.headers.get("if-modified-since") ?? "")
    if (!Number.isNaN(since) && lastModified.getTime() <= since)
      return new Response(null, { status: 304, headers })
  }
  return new Response(request.method === "HEAD" ? null : body, { headers })
}
