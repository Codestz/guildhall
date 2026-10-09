/**
 * File-size ratchet for every package's src (architecture review 2026-10-08, §5.3; ADR 0018).
 *
 * Every .ts/.tsx under packages/<name>/src has a budget of LIMIT lines. Files already past it are
 * recorded in moduleSize.json (repo-relative path → line count on the day they were frozen). The test
 * fails when:
 * - a file not in moduleSize.json grows past LIMIT. Split it; do not add it to the list.
 * - a listed file grows past its recorded count plus SLACK. Split it, or move code out before adding.
 * - a listed file no longer exists. Delete its entry.
 *
 * Files that shrank are not failures; the test prints a hint to lower (or remove) their entry so the
 * ratchet tightens. Lines are counted like `wc -l`.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import recorded from "./moduleSize.json"

const ROOT = resolve(import.meta.dir, "../../..")
const LIMIT = 400
/** Growth tolerated on a listed file before it fails: 2% of its recorded count. */
const SLACK = 0.02
const LIST = "packages/hall/test/moduleSize.json"

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function linesOf(path: string): number {
  const text = readFileSync(path, "utf8")
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}

function sizes(): Map<string, number> {
  const packages = join(ROOT, "packages")
  const found = new Map<string, number>()
  for (const name of readdirSync(packages)) {
    const src = join(packages, name, "src")
    let files: string[]
    try {
      files = sources(src)
    } catch {
      continue // a package without src/
    }
    for (const file of files) found.set(relative(ROOT, file), linesOf(file))
  }
  return found
}

describe("module size ratchet", () => {
  const actual = sizes()
  const budget: Record<string, number> = recorded

  test(`files outside ${LIST} stay within ${LIMIT} lines`, () => {
    const over = [...actual]
      .filter(([file, lines]) => !(file in budget) && lines > LIMIT)
      .map(([file, lines]) => `${file}: ${lines} lines`)
      .sort()
    expect(over, `New files over ${LIMIT} lines. Split them; do not add them to ${LIST}`).toEqual([])
  })

  test(`listed files grow at most ${SLACK * 100}% past their recorded size`, () => {
    const hints = Object.entries(budget).flatMap(([file, max]) => {
      const lines = actual.get(file)
      if (lines === undefined || lines >= max) return []
      return lines <= LIMIT
        ? [`  ${file}: ${lines} lines, now within ${LIMIT}; remove its entry`]
        : [`  ${file}: ${lines} lines; lower its entry from ${max} to ${lines}`]
    })
    if (hints.length > 0) console.warn(`Files shrank. Tighten ${LIST}:\n${hints.join("\n")}`)
    const grown = Object.entries(budget)
      .filter(([file, max]) => (actual.get(file) ?? 0) > Math.floor(max * (1 + SLACK)))
      .map(([file, max]) => `${file}: ${actual.get(file)} lines (recorded ${max})`)
    expect(grown, "Over budget. Split the file rather than raising its number").toEqual([])
  })

  test(`every file in ${LIST} still exists`, () => {
    const gone = Object.keys(budget).filter((file) => !actual.has(file))
    expect(gone, `Delete these entries from ${LIST}`).toEqual([])
  })
})
