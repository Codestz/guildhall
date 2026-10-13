import type { Change } from "@guildhall/core"
import { placeKind } from "../repo/places.ts"

/**
 * A told story on another repo's island: its file paths moved onto that repo's own units, so its heroes
 * still go to as many places as the story means them to. A story is written in one repo's layout (the
 * saga in this repo's `packages/world`, V1's stories in an app's `src/users`); on a repo without those
 * folders every path would bind to the capital (repo/places.ts `bindPlaces`), and every hero would stand
 * in one town.
 *
 * Each *district* a story's paths name (a path's first two folders: `packages/world`, `src/users`,
 * `docs/plan`) keeps its name when the repo has that unit, and is otherwise given one of the repo's units,
 * in the order the story first names them (or `first`, the districts that matter most, ahead): a unit of the same content first (docs to docs, tests to
 * tests, as `placeKind` reads a name), else the biggest code unit not yet given, else the biggest not yet
 * given; when every unit is taken, they are given again from the biggest. Paths are rewritten by prefix
 * (`packages/world/src/hex/heroes.ts` → `packages/hall/src/hex/heroes.ts`) and a district's name is
 * rewritten in the story's words too (a command, a title, a reply), when it has a folder in it. Files at
 * the root stay. Pure and deterministic for a story and a unit list.
 */

/** A repo's unit as a story needs it: its name and how big it is. */
export interface StoryUnit {
  name: string
  files?: number
}

/** The input keys that name a file or a folder (normalize.ts `pathsOf`). */
const PATH_KEYS = ["filePath", "file_path", "path", "file", "notebook_path", "notebookPath"] as const

/** The district a path is in: its first two folders (a path whose last part has no dot is a folder). */
export function districtOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  if (parts.length > 0 && /\./.test(parts[parts.length - 1] as string)) parts.pop()
  return parts.slice(0, 2).join("/")
}

const segments = (name: string) => name.split("/").filter(Boolean)

/** What a district's name says it holds: the first of its folders with a content kind, else code. */
function kindOf(name: string): string {
  for (const part of segments(name)) {
    const kind = placeKind(part, 2)
    if (kind !== "settlement") return kind
  }
  return "settlement"
}

/** Which unit each district of `paths` goes to on a repo of `units` (a district the repo has maps to itself). */
export function districtMap(
  paths: readonly string[],
  units: readonly StoryUnit[],
  first: readonly string[] = [],
): Map<string, string> {
  const targets = units
    .filter((u) => u.name !== "/" && !u.name.endsWith("*"))
    .sort((a, b) => (b.files ?? 0) - (a.files ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const out = new Map<string, string>()
  const given = new Set<string>()
  const order: string[] = []
  for (const path of [...first, ...paths]) {
    const d = districtOf(path)
    if (d && !order.includes(d)) order.push(d)
  }
  // a district the repo already has keeps it (and its unit is taken)
  for (const d of order)
    if (targets.some((u) => u.name === d)) {
      out.set(d, d)
      given.add(d)
    }
  let again = 0
  for (const d of order) {
    if (out.has(d)) continue
    const free = targets.filter((u) => !given.has(u.name))
    const kind = kindOf(d)
    const unit =
      (kind !== "settlement" ? free.find((u) => kindOf(u.name) === kind) : undefined) ??
      free.find((u) => kindOf(u.name) === "settlement") ??
      free[0] ??
      targets[again++ % Math.max(1, targets.length)]
    if (!unit) continue
    out.set(d, unit.name)
    given.add(unit.name)
  }
  return out
}

/** The file paths a story's changes name, in order. */
export function storyPaths(changes: readonly Change[]): string[] {
  const out: string[] = []
  for (const c of changes)
    if (c.type === "tool" && c.input)
      for (const key of PATH_KEYS) {
        const v = c.input[key]
        if (typeof v === "string" && v) out.push(v)
      }
  return out
}

/** The story's changes with their paths moved onto `units` (see the top of this file). */
export function rehome(
  changes: readonly Change[],
  units: readonly StoryUnit[],
  first: readonly string[] = [],
): Change[] {
  if (units.length === 0) return [...changes]
  const map = districtMap(storyPaths(changes), units, first)
  const moves = [...map].filter(([from, to]) => from !== to).sort((a, b) => b[0].length - a[0].length)
  if (moves.length === 0) return [...changes]
  const movePath = (path: string): string => {
    for (const [from, to] of moves)
      if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length)
    return path
  }
  // words: only districts with a folder in them, at a path boundary
  const worded = moves.filter(([from]) => from.includes("/"))
  const moveWords = (text: string): string => {
    let out = text
    for (const [from, to] of worded)
      out = out.replace(new RegExp(`(^|[^\\w/.-])${escapeRe(from)}(?=$|[^\\w-])`, "g"), `$1${to}`)
    return out
  }
  const deep = (value: unknown, key?: string): unknown => {
    if (typeof value === "string")
      return key && (PATH_KEYS as readonly string[]).includes(key) ? movePath(value) : moveWords(value)
    if (Array.isArray(value)) return value.map((v) => deep(v))
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v, k)]))
    return value
  }
  return changes.map((c) => {
    const next = { ...c } as Record<string, unknown>
    for (const field of ["title", "text", "summary", "output", "error"] as const)
      if (typeof next[field] === "string") next[field] = moveWords(next[field] as string)
    if (c.type === "tool" && c.input) next.input = deep(c.input)
    return next as Change
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
