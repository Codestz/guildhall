import { statSync } from "node:fs"
import { resolve, sep } from "node:path"

/**
 * The built hall, served by the hub at `/` (ADR 0002: no separate web install). Only files inside
 * `root`; no listings, no dotfiles. Vite's fingerprinted bundles (`index-CQvrk4PR.js`) never change
 * under their name, so they are cached for a year; everything else (index.html, the models and
 * sounds copied from `public/`) is revalidated against its modification time, so an upgraded
 * package is seen on the next load.
 */

/** Vite's output names: `[name]-[hash].js|css`, an 8-character hash. Models and sounds keep their names. */
const FINGERPRINTED = /-[A-Za-z0-9_-]{8}\.(?:js|css)$/

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
  const body = Bun.file(file)
  const headers = new Headers({
    "content-type": body.type,
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
