import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CatalogEntry, Mount, PackConfig } from "@guildhall/assets"
import { shardFile } from "../src/catalog.ts"
import type { Paths } from "../src/config.ts"
import { loadOverlay, reapplyOverlay } from "../src/overlay.ts"
import { runImport } from "../src/pipeline.ts"
import { fixturePacks, fixturePaths, tempDir } from "./fixtures/env.ts"

const AXE: Mount = { slot: "hand.r", hands: 1, handle: [0, 0.05, 0], axis: [0, 1, 0], edge: [1, 0, 0] }
const CRATE = "fixture-atlas/crate"

let data: string
let saved: string | undefined
let p: Paths
let packs: PackConfig[]

const writeMounts = (mounts: Record<string, unknown>, version = 1): void =>
  writeFileSync(join(data, "mounts.json"), JSON.stringify({ version, mounts }))
const shardText = (pack: string): string => readFileSync(shardFile(p.library, pack), "utf8")
const entry = (id: string): CatalogEntry | undefined =>
  (JSON.parse(shardText(id.split("/")[0] as string)) as CatalogEntry[]).find((e) => e.id === id)
const run = () => runImport({ paths: p, packs, jobs: 1 })

beforeEach(async () => {
  saved = process.env.GUILDHALL_DATA
  data = tempDir()
  process.env.GUILDHALL_DATA = data
  p = fixturePaths()
  packs = (await fixturePacks()).filter((x) => x.id === "fixture-atlas")
})

afterEach(() => {
  if (saved === undefined) delete process.env.GUILDHALL_DATA
  else process.env.GUILDHALL_DATA = saved
})

describe("import applies data/mounts.json", () => {
  test("a missing file is fine: entries carry no mount", async () => {
    await run()
    expect(entry(CRATE)?.compose.mount).toBeUndefined()
  })

  test("an authored mount appears in the shard, on a fresh and on a cached import", async () => {
    writeMounts({ [CRATE]: AXE, "unknown/piece": AXE })
    await run()
    expect(entry(CRATE)?.compose.mount).toEqual(AXE)
    await run()
    expect(entry(CRATE)?.compose.mount).toEqual(AXE)
  })

  test("a mount removed from the file disappears from the shard on re-import", async () => {
    writeMounts({ [CRATE]: AXE })
    await run()
    writeMounts({})
    const [summary] = await run()
    expect(summary?.cached).toBe(1)
    expect(entry(CRATE)?.compose.mount).toBeUndefined()
  })

  test("a re-run writes byte-identical shards", async () => {
    writeMounts({ [CRATE]: { ...AXE, clips: { chop: { roll: 15 } } } })
    await run()
    const first = shardText("fixture-atlas")
    await run()
    expect(shardText("fixture-atlas")).toBe(first)
  })

  test("an invalid file fails the import, naming each problem, and writes no shard", async () => {
    writeMounts({ [CRATE]: { ...AXE, slot: "tail", edge: [0, 1, 0] } }, 2)
    const err = await run().then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).toContain("mounts.json: 3 problems")
    expect(message).toContain("version: expected 1, got 2")
    expect(message).toContain(`mounts.${CRATE}.slot: unknown "tail"`)
    expect(message).toContain(`mounts.${CRATE}.edge: expected perpendicular to axis`)
    expect(existsSync(shardFile(p.library, "fixture-atlas"))).toBe(false)
  })

  test("a file that is not JSON fails with its path", () => {
    writeFileSync(join(data, "mounts.json"), "{ nope")
    expect(() => loadOverlay(data)).toThrow(`${join(data, "mounts.json")}: not JSON`)
  })
})

describe("reapplyOverlay (bun import overlay)", () => {
  test("rewrites only the shards whose mounts change, without re-importing", async () => {
    packs = await fixturePacks()
    await run()
    const untouched = shardText("fixture-material")
    writeMounts({ [CRATE]: AXE })
    expect(reapplyOverlay(p.library)).toEqual(["fixture-atlas"])
    expect(entry(CRATE)?.compose.mount).toEqual(AXE)
    expect(shardText("fixture-material")).toBe(untouched)
    expect(reapplyOverlay(p.library)).toEqual([])
    writeMounts({})
    expect(reapplyOverlay(p.library)).toEqual(["fixture-atlas"])
    expect(entry(CRATE)?.compose.mount).toBeUndefined()
  })
})
