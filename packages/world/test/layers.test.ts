/**
 * The layers inside world (ADR 011): geom at the bottom, hex (the hex world) on it. A folder may import
 * itself and the folders below it, and only the workspace packages its row allows; `src/index.ts` sits
 * above them all.
 * The cross-package order (core < assets < world …) is the root test/layers.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const SRC = resolve(import.meta.dir, "../src")

/** Per folder: the world folders and the @guildhall packages it may import. */
const RULES: Readonly<Record<string, { folders: readonly string[]; packages: readonly string[] }>> = {
  geom: { folders: ["geom"], packages: ["core"] },
  // the hex world (decisions.md "Clean restart on hex"): on geom only
  hex: { folders: ["geom", "hex"], packages: ["core", "assets"] },
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g

interface SourceFile {
  /** Path relative to `src/`, with `/` separators. */
  path: string
  text: string
}

function read(dir: string): SourceFile[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((p) => /\.tsx?$/.test(p) && !p.endsWith(".d.ts"))
    .map((p) => ({ path: p.split("\\").join("/"), text: readFileSync(join(dir, p), "utf8") }))
}

/** The folder a relative import from `file` lands in (`..` past `src/` → "<outside>"), or "" for `src/` itself. */
function folderOf(file: string, spec: string): string {
  const parts = file.split("/").slice(0, -1)
  for (const seg of spec.split("/")) {
    if (seg === "..") {
      if (parts.length === 0) return "<outside>"
      parts.pop()
    } else if (seg !== ".") parts.push(seg)
  }
  return parts.length > 1 ? (parts[0] as string) : ""
}

/** One `file -> specifier: reason` line per import that breaks the order; [] when clean. */
function checkWorldLayers(files: readonly SourceFile[]): string[] {
  const out: string[] = []
  for (const { path, text } of files) {
    const folder = path.includes("/") ? (path.split("/")[0] as string) : ""
    const rule = RULES[folder]
    if (folder && !rule) {
      out.push(`${path}: folder has no layer; add it to RULES in packages/world/test/layers.test.ts`)
      continue
    }
    if (!rule) continue
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[1] as string
      const pkg = /^@guildhall\/([^/]+)/.exec(spec)?.[1]
      if (pkg !== undefined) {
        if (!rule.packages.includes(pkg))
          out.push(`${path} -> ${spec}: ${folder} may import ${rule.packages.join(", ")} only`)
        continue
      }
      if (!spec.startsWith(".")) continue
      const to = folderOf(path, spec)
      if (!rule.folders.includes(to))
        out.push(`${path} -> ${spec}: ${folder} may import ${rule.folders.join(", ")} only (geom < hex)`)
    }
  }
  return out
}

describe("world layers", () => {
  test("world's own folders respect geom < hex", () => {
    const files = read(SRC)
    expect(files.length).toBeGreaterThan(0)
    expect(checkWorldLayers(files)).toEqual([])
  })

  test("hex importing an unknown folder fails, a dynamic or re-export import included", () => {
    const files = [
      { path: "hex/index.ts", text: 'export { LEVELS } from "../draw/types.ts"' },
      { path: "hex/world.ts", text: 'const m = await import("../draw/water.ts")' },
    ]
    expect(checkWorldLayers(files)).toEqual([
      "hex/index.ts -> ../draw/types.ts: hex may import geom, hex only (geom < hex)",
      "hex/world.ts -> ../draw/water.ts: hex may import geom, hex only (geom < hex)",
    ])
  })

  test("geom importing hex, geom importing assets, and an unknown folder fail", () => {
    const files = [
      { path: "geom/noise.ts", text: 'import { hexCentre } from "../hex/grid.ts"' },
      { path: "geom/noise.ts", text: 'import type { PALETTE } from "@guildhall/assets"' },
      { path: "sky/clouds.ts", text: "" },
    ]
    expect(checkWorldLayers(files)).toEqual([
      "geom/noise.ts -> ../hex/grid.ts: geom may import geom only (geom < hex)",
      "geom/noise.ts -> @guildhall/assets: geom may import core only",
      "sky/clouds.ts: folder has no layer; add it to RULES in packages/world/test/layers.test.ts",
    ])
  })

  test("downward imports, npm packages and the package index pass", () => {
    const files = [
      { path: "hex/world.ts", text: 'import { x } from "../geom/noise.ts"\nimport { y } from "./grid.ts"' },
      { path: "hex/sub/deep.ts", text: 'import { z } from "../../geom/noise.ts"' },
      { path: "geom/noise.ts", text: 'import { Vector3 } from "three"' },
      { path: "index.ts", text: 'export * from "./hex/index.ts"' },
    ]
    expect(checkWorldLayers(files)).toEqual([])
  })
})
