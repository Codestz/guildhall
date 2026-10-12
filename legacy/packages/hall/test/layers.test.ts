/**
 * Layering guard for packages/hall/src (architecture review 2026-10-08, §1.2 and §5.3; ADR 0018).
 *
 * Every import inside the hall is reduced to a file edge `from -> to` (paths relative to src/) and
 * classified:
 * - runtime: a static `import`/`export … from`, a side-effect `import "x"`, or a dynamic `import("x")`
 *   (Bun's transpiler decides which imports survive type erasure, so this matches what ships).
 * - type: everything else (`import type`, `export type`, `import { type A }`, `typeof import("x")`).
 *
 * An edge is a violation when its source folder may not depend on its target folder (LAYERS below).
 * Today's violations and runtime import cycles are frozen in layers.json, an allowlist that may only
 * shrink:
 * - a NEW violation or cycle fails, naming it. Fix the import (move the shared module down a layer)
 *   rather than adding it to the list.
 * - an allowlisted edge or cycle that no longer exists also fails: delete its line from layers.json
 *   so it cannot quietly come back.
 *
 * Folders not in LAYERS fail too, so a new top-level folder gets a deliberate place in the order.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import allowed from "./layers.json"

const SRC = resolve(import.meta.dir, "../src")

/** Which other folders each folder may import (its own folder is always allowed). "." is the src root. */
const LAYERS: Record<string, readonly string[]> = {
  ".": ["scene", "hud", "guild", "render", "lab"], // composition root; lab only via the dev-only dynamic import
  lab: ["scene", "hud", "guild", "world", "render", "audio"], // dev labs sit on top of everything
  hud: ["guild", "world", "audio"], // never scene
  scene: ["guild", "world", "render", "audio"], // never hud
  audio: ["guild", "world"], // never scene, never hud
  render: [], // three only, never scene
  guild: ["world"], // never scene, hud
  world: [], // never scene, guild
}

type Kind = "runtime" | "type"
type Edge = { from: string; to: string; kind: Kind }

const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) }
/** Static `import … from`, `export … from` and `import "x"`, at the start of a statement. */
const STATIC = /^\s*(?:(?:import|export)\b[\w\s{},*$]*?\bfrom|import)\s*["']([^"']+)["']/gm
/** `import("x")`, which covers `typeof import("x")` in type positions. */
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : []
  })
}

/** The src file a relative specifier points at, or null for packages, assets and anything outside src. */
function target(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null
  const base = resolve(dirname(fromFile), spec.replace(/\?.*$/, ""))
  const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(
    (path) => /\.tsx?$/.test(path) && existsSync(path),
  )
  if (!hit || relative(SRC, hit).startsWith("..")) return null
  return relative(SRC, hit)
}

function scanEdges(): Edge[] {
  const edges: Edge[] = []
  for (const file of sources(SRC)) {
    const code = readFileSync(file, "utf8")
    const runtime = new Set(
      transpilers[file.endsWith(".tsx") ? "tsx" : "ts"].scan(code).imports.map((entry) => entry.path),
    )
    const live = code
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n")
    const all = new Set([...runtime])
    for (const match of live.matchAll(STATIC)) all.add(match[1]!)
    for (const match of live.matchAll(DYNAMIC)) all.add(match[1]!)
    const byTarget = new Map<string, Kind>()
    for (const spec of all) {
      const to = target(file, spec)
      if (!to) continue
      const kind: Kind = runtime.has(spec) ? "runtime" : "type"
      if (byTarget.get(to) !== "runtime") byTarget.set(to, kind)
    }
    const from = relative(SRC, file)
    for (const [to, kind] of byTarget) edges.push({ from, to, kind })
  }
  return edges
}

const folderOf = (file: string): string => (file.includes("/") ? file.split("/")[0]! : ".")
const keyOf = (edge: Edge): string => `${edge.from} -> ${edge.to}`

/** Strongly connected components of size > 1 (Tarjan), each as its sorted member list. */
function cycles(edges: readonly Edge[]): string[][] {
  const next = new Map<string, string[]>()
  for (const { from, to } of edges) next.set(from, [...(next.get(from) ?? []), to])
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const found: string[][] = []
  const visit = (node: string): void => {
    index.set(node, index.size)
    low.set(node, index.get(node)!)
    stack.push(node)
    onStack.add(node)
    for (const to of next.get(node) ?? []) {
      if (!index.has(to)) {
        visit(to)
        low.set(node, Math.min(low.get(node)!, low.get(to)!))
      } else if (onStack.has(to)) low.set(node, Math.min(low.get(node)!, index.get(to)!))
    }
    if (low.get(node) !== index.get(node)) return
    const component: string[] = []
    let member: string
    do {
      member = stack.pop()!
      onStack.delete(member)
      component.push(member)
    } while (member !== node)
    if (component.length > 1) found.push(component.sort())
  }
  for (const node of next.keys()) if (!index.has(node)) visit(node)
  return found
}

/** The failure text: what is new (fix it) and what is gone (delete it from layers.json). */
function drift(label: string, actual: readonly string[], listed: readonly string[]): string {
  const added = actual.filter((entry) => !listed.includes(entry))
  const gone = listed.filter((entry) => !actual.includes(entry))
  const lines: string[] = []
  if (added.length > 0) {
    lines.push(`New ${label} (fix the import; do not add it to packages/hall/test/layers.json):`)
    lines.push(...added.map((entry) => `  + ${JSON.stringify(entry)}`))
  }
  if (gone.length > 0) {
    lines.push(`Allowlisted ${label} no longer present. Delete these from packages/hall/test/layers.json:`)
    lines.push(...gone.map((entry) => `  - ${JSON.stringify(entry)}`))
  }
  return lines.join("\n")
}

describe("hall layering", () => {
  const edges = scanEdges()

  test("every source folder has a place in the layer order", () => {
    const unknown = [...new Set(edges.map((edge) => folderOf(edge.from)))].filter((dir) => !(dir in LAYERS))
    expect(unknown, `Add these folders to LAYERS in ${import.meta.file}`).toEqual([])
  })

  for (const kind of ["runtime", "type"] as const) {
    test(`${kind} imports respect the layer order, up to the shrinking allowlist`, () => {
      const violations = edges
        .filter((edge) => edge.kind === kind)
        .filter((edge) => {
          const [from, to] = [folderOf(edge.from), folderOf(edge.to)]
          return from !== to && !(LAYERS[from] ?? []).includes(to)
        })
        .map(keyOf)
        .sort()
      expect(drift(`${kind} layer violations`, violations, allowed[kind])).toBe("")
    })
  }

  test("runtime import cycles, up to the shrinking allowlist", () => {
    const found = cycles(edges.filter((edge) => edge.kind === "runtime"))
      .map((members) => members.join(" | "))
      .sort()
    expect(drift("runtime import cycles", found, allowed.cycles)).toBe("")
  })
})
