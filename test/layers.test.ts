/**
 * Cross-package layer guard (ADR 001): dependencies point DOWN only.
 *
 * Order: core < assets < world < sim < render. A layer may import the layers before it.
 * `ui` sits beside render: core + react only, never three or render.
 * `apps/*` may import any `packages/*`, never `three` (render is the only door to it).
 * `tools/*` may import anything, and nothing outside `tools/` imports them.
 * The pure layers (core, assets, world, sim) never import three, react, @react-three/* or node:*.
 * Source imports and package.json dependencies are checked by the same rules.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const FIXTURES = join(import.meta.dir, "fixtures/layers")

const ORDER: readonly string[] = ["core", "assets", "world", "sim", "render"]
const PURE: readonly string[] = ["core", "assets", "world", "sim"]

const PURE_FORBIDDEN = /^(three|react|react-dom|@react-three\/[^/]+)(\/|$)|^node:/
const RENDER_FORBIDDEN = /^(react|react-dom|@react-three\/[^/]+)(\/|$)/
const UI_FORBIDDEN = /^(three|@react-three\/[^/]+)(\/|$)/
const APP_FORBIDDEN = /^three(\/|$)/

/** Static, side-effect, re-export, dynamic and type imports all name their module in quotes after one of these. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const

type Kind = "package" | "app" | "tool"
interface Unit {
  kind: Kind
  /** Directory name: the layer name for packages. */
  name: string
  dir: string
  manifest: Record<string, unknown>
}

function units(root: string): Unit[] {
  const groups: [string, Kind][] = [
    ["packages", "package"],
    ["apps", "app"],
    ["tools", "tool"],
  ]
  return groups.flatMap(([group, kind]) => {
    const base = join(root, group)
    if (!existsSync(base)) return []
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, "package.json")))
      .map((entry) => {
        const dir = join(base, entry.name)
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<
          string,
          unknown
        >
        return { kind, name: entry.name, dir, manifest }
      })
  })
}

function sources(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : []
  })
}

/** Every module a unit names: its `src/` imports and its package.json dependency keys. */
function specifiers(unit: Unit): { file: string; spec: string }[] {
  const fromSource = sources(join(unit.dir, "src")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(SPECIFIER)].map((m) => ({ file, spec: m[1] as string })),
  )
  const manifestFile = join(unit.dir, "package.json")
  const fromManifest = DEP_FIELDS.flatMap((field) =>
    Object.keys((unit.manifest[field] as Record<string, string> | undefined) ?? {}).map((spec) => ({
      file: manifestFile,
      spec,
    })),
  )
  return [...fromSource, ...fromManifest]
}

/** Why `from` may not depend on the workspace unit `to`, or null when it may. */
function internalViolation(from: Unit, to: Unit): string | null {
  if (to.kind === "tool") return from.kind === "tool" ? null : "nothing outside tools/ imports a tool"
  if (from.kind === "tool") return null
  if (from.kind === "app") return to.kind === "package" ? null : "apps import packages only"
  if (to.kind !== "package") return `${from.name} may not import an app`
  if (from.name === "ui") return to.name === "core" ? null : "ui imports core only"
  const rank = ORDER.indexOf(from.name)
  const target = ORDER.indexOf(to.name)
  if (target === -1 || target >= rank)
    return `${from.name} may only import layers below it (${ORDER.join(" < ")})`
  return null
}

function externalViolation(from: Unit, spec: string): string | null {
  if (from.kind === "tool") return null
  if (from.kind === "app")
    return APP_FORBIDDEN.test(spec) ? "apps never import three (only via render)" : null
  if (from.name === "ui") return UI_FORBIDDEN.test(spec) ? "ui never imports three" : null
  if (from.name === "render") return RENDER_FORBIDDEN.test(spec) ? "render never imports react" : null
  if (PURE.includes(from.name) && PURE_FORBIDDEN.test(spec)) {
    return `pure layer ${from.name} never imports three, react, @react-three/* or node:*`
  }
  return null
}

/** Checks a workspace tree; returns one `path -> specifier: reason` line per violation, [] when clean. */
function checkLayers(root: string): string[] {
  const all = units(root)
  const byName = new Map(all.map((unit) => [unit.manifest.name, unit]))
  const violations: string[] = []
  for (const unit of all) {
    const rel = relative(root, unit.dir)
    if (unit.kind === "package" && unit.name !== "ui" && !ORDER.includes(unit.name)) {
      violations.push(`${rel}: package has no layer; add it to the order in test/layers.test.ts`)
      continue
    }
    for (const { file, spec } of specifiers(unit)) {
      const target = byName.get(/^@guildhall\/[^/]+/.exec(spec)?.[0])
      const reason = target
        ? target === unit
          ? null
          : internalViolation(unit, target)
        : externalViolation(unit, spec)
      if (reason) violations.push(`${relative(root, file)} -> ${spec}: ${reason}`)
    }
  }
  return violations
}

describe("package layers", () => {
  test("the repo's packages, apps and tools respect the layers", () => {
    expect(checkLayers(ROOT)).toEqual([])
  })

  test("a tree that keeps every rule passes, with world and sim absent", () => {
    expect(checkLayers(join(FIXTURES, "good"))).toEqual([])
  })

  test("three imported by assets fails, naming the file and specifier", () => {
    expect(checkLayers(join(FIXTURES, "bad"))).toContain(
      "packages/assets/src/index.ts -> three: pure layer assets never imports three, react, @react-three/* or node:*",
    )
  })

  test("a tree that breaks each rule reports every break", () => {
    expect(checkLayers(join(FIXTURES, "bad")).sort()).toEqual(
      [
        "apps/studio/package.json -> three: apps never import three (only via render)",
        "apps/studio/src/main.ts -> three/addons/controls/OrbitControls.js: apps never import three (only via render)",
        "apps/studio/src/main.ts -> @guildhall/import: nothing outside tools/ imports a tool",
        "packages/assets/src/index.ts -> three: pure layer assets never imports three, react, @react-three/* or node:*",
        "packages/core/package.json -> react: pure layer core never imports three, react, @react-three/* or node:*",
        "packages/core/src/index.ts -> node:fs: pure layer core never imports three, react, @react-three/* or node:*",
        "packages/render/package.json -> react: render never imports react",
        "packages/render/src/index.ts -> @guildhall/studio: render may not import an app",
        "packages/ui/src/index.ts -> @guildhall/render: ui imports core only",
        "packages/ui/src/index.ts -> three: ui never imports three",
        "packages/world/package.json -> @guildhall/sim: world may only import layers below it (core < assets < world < sim < render)",
      ].sort(),
    )
  })
})
