/** Test helpers: the fixture packs, read from the committed fixtures into a throwaway library. */
import { cpSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { PackConfig } from "@guildhall/assets"
import { loadPacks, type Paths } from "../../src/config.ts"

export const FIXTURES = import.meta.dir
export const PACKS = resolve(import.meta.dir, "../../packs")

export const tempDir = (): string => mkdtempSync(join(tmpdir(), "guildhall-import-"))

/** Paths with the fixtures as raw packs (copied when `copyRaw`, so a test may edit them). */
export function fixturePaths(copyRaw = false): Paths {
  let raw = FIXTURES
  if (copyRaw) {
    raw = tempDir()
    cpSync(FIXTURES, raw, { recursive: true })
  }
  return { raw, library: tempDir(), packs: PACKS }
}

export async function fixturePacks(): Promise<PackConfig[]> {
  return (await loadPacks(PACKS)).filter((p) => p.id.startsWith("fixture-"))
}
