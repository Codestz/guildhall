import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, truncateSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type GuildEvent, WIRE_VERSION } from "@guildhall/core"
import {
  EVENTS_KEEP_MS,
  EVENTS_MAX_BYTES,
  loadHistory,
  pruneChronicles,
  RAW_KEEP_MS,
  RAW_MAX_BYTES,
  readTail,
} from "../src/chronicles.ts"

const DAY = 24 * 60 * 60 * 1000

const event = (seq: number, text = "t", guild = "g"): GuildEvent => ({
  v: WIRE_VERSION,
  guild,
  seq,
  change: { type: "prompt", id: "s", key: `k${seq}`, text, at: seq },
})
const lines = (events: GuildEvent[]) => `${events.map((e) => JSON.stringify(e)).join("\n")}\n`

/** A file under a fresh root, its mtime `age` ms ago. */
function chronicle(root: string, name: string, content: string | number, age = 0): string {
  mkdirSync(join(root, "g"), { recursive: true })
  const path = join(root, "g", name)
  if (typeof content === "number") {
    writeFileSync(path, "")
    truncateSync(path, content)
  } else writeFileSync(path, content)
  const when = (Date.now() - age) / 1000
  utimesSync(path, when, when)
  return path
}

describe("readTail", () => {
  test("gives the last events in order, skipping a half-written last line", () => {
    const root = mkdtempSync(join(tmpdir(), "guildhall-tail-"))
    const all = Array.from({ length: 10 }, (_, n) => event(n + 1))
    const path = chronicle(root, "a.jsonl", `${lines(all)}{"v":1,"gui`)
    expect(readTail(path, 3).map((e) => e.seq)).toEqual([8, 9, 10])
    expect(readTail(path, 100).map((e) => e.seq)).toEqual(all.map((e) => e.seq))
  })

  test("reads lines longer than its chunk, across chunk boundaries", () => {
    const root = mkdtempSync(join(tmpdir(), "guildhall-tail-"))
    const all = Array.from({ length: 6 }, (_, n) => event(n + 1, String(n).repeat(700_000)))
    const path = chronicle(root, "a.jsonl", lines(all))
    const tail = readTail(path, 4)
    expect(tail.map((e) => e.seq)).toEqual([3, 4, 5, 6])
    expect(tail[0]?.change.type === "prompt" && tail[0].change.text).toBe("2".repeat(700_000))
  })

  test("a missing file or a max of 0 gives nothing", () => {
    expect(readTail(join(tmpdir(), "guildhall-no-such-file.jsonl"), 5)).toEqual([])
    const root = mkdtempSync(join(tmpdir(), "guildhall-tail-"))
    expect(readTail(chronicle(root, "a.jsonl", lines([event(1)])), 0)).toEqual([])
  })
})

describe("loadHistory", () => {
  test("holds each guild to `keep`, newest events, across boots", () => {
    const root = mkdtempSync(join(tmpdir(), "guildhall-load-"))
    chronicle(root, "2026-01-01.jsonl", lines(Array.from({ length: 5 }, (_, n) => event(n + 1))))
    chronicle(root, "2026-01-02.jsonl", lines(Array.from({ length: 3 }, (_, n) => event(n + 6))))
    expect(
      loadHistory(root, 6)
        .get("g")
        ?.map((e) => e.seq),
    ).toEqual([3, 4, 5, 6, 7, 8])
  })
})

describe("pruneChronicles", () => {
  test("raw logs go after RAW_KEEP_MS, event chronicles only after EVENTS_KEEP_MS", () => {
    const root = mkdtempSync(join(tmpdir(), "guildhall-prune-"))
    const oldRaw = chronicle(root, "a.raw.jsonl", "{}\n", RAW_KEEP_MS + DAY)
    const freshRaw = chronicle(root, "b.raw.jsonl", "{}\n", RAW_KEEP_MS - DAY)
    const oldEvents = chronicle(root, "a.jsonl", lines([event(1)]), EVENTS_KEEP_MS + DAY)
    const keptEvents = chronicle(root, "b.jsonl", lines([event(1)]), RAW_KEEP_MS + DAY)
    pruneChronicles(root)
    expect([oldRaw, freshRaw, oldEvents, keptEvents].map((path) => existsSync(path))).toEqual([
      false,
      true,
      false,
      true,
    ])
  })

  test("over the size cap, the oldest boots go first", () => {
    const root = mkdtempSync(join(tmpdir(), "guildhall-prune-"))
    const third = Math.floor(RAW_MAX_BYTES / 3) + 1
    const raws = ["1", "2", "3", "4"].map((boot) => chronicle(root, `${boot}.raw.jsonl`, third))
    pruneChronicles(root)
    expect(raws.map((path) => existsSync(path))).toEqual([false, false, true, true])
  })

  test("a guild's newest event chronicle stays even when it alone is over the cap", () => {
    const root = mkdtempSync(join(tmpdir(), "guildhall-prune-"))
    const older = chronicle(root, "1.jsonl", 10)
    const newest = chronicle(root, "2.jsonl", EVENTS_MAX_BYTES + 1)
    pruneChronicles(root)
    expect([existsSync(older), existsSync(newest)]).toEqual([false, true])
  })

  test("a missing root is no error", () => {
    expect(() => pruneChronicles(join(tmpdir(), "guildhall-no-such-root"))).not.toThrow()
  })
})
