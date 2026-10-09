import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireGpu, withGpu } from "./gpulock.ts"

const dir = mkdtempSync(join(tmpdir(), "gpulock-test-"))
let n = 0
const lockPath = () => join(dir, `lock-${n++}`)
const quiet = { pollMs: 5, log: () => {} }

afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => {
  delete process.env.GUILDHALL_GPU_LOCK
  delete process.env.GUILDHALL_GPU_HELD
})

describe("gpu lock", () => {
  test("a second taker waits until the first releases, then runs", async () => {
    const path = lockPath()
    const order: string[] = []
    const lines: string[] = []
    const first = await acquireGpu("first", { path, ...quiet })
    const second = withGpu(
      "second",
      () => {
        order.push("second ran")
      },
      { path, pollMs: 5, log: (line) => lines.push(line) },
    )
    await Bun.sleep(60)
    order.push("first releasing")
    first()
    await second
    expect(order).toEqual(["first releasing", "second ran"])
    expect(lines[0]).toMatch(/^waiting for GPU: held by first pid \d+ for \d+s$/)
    expect(existsSync(path)).toBe(false)
  })

  test("reclaims a lock whose holder pid is dead", async () => {
    const path = lockPath()
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 12345, label: "ghost", start: Date.now() }))
    await withGpu("live", () => expect(existsSync(path)).toBe(true), { path, ...quiet })
    expect(existsSync(path)).toBe(false)
  })

  test("reclaims a lock held longer than the max age even if its pid lives", async () => {
    const path = lockPath()
    writeFileSync(path, JSON.stringify({ pid: process.pid, label: "wedged", start: Date.now() - 10_000 }))
    await withGpu("fresh", () => {}, { path, ...quiet, maxAgeMs: 1000 })
    expect(existsSync(path)).toBe(false)
  })

  test("releases when the function throws", async () => {
    const path = lockPath()
    await expect(
      withGpu(
        "boom",
        () => {
          throw new Error("boom")
        },
        { path, ...quiet },
      ),
    ).rejects.toThrow("boom")
    expect(existsSync(path)).toBe(false)
  })

  test("release is idempotent and leaves a lock someone else took", async () => {
    const path = lockPath()
    const release = await acquireGpu("mine", { path, ...quiet })
    rmSync(path)
    writeFileSync(path, JSON.stringify({ pid: process.pid + 1, label: "theirs", start: Date.now() }))
    release()
    release()
    expect(existsSync(path)).toBe(true)
  })

  test("GUILDHALL_GPU_LOCK=0 skips the lock", async () => {
    const path = lockPath()
    process.env.GUILDHALL_GPU_LOCK = "0"
    await withGpu("off", () => expect(existsSync(path)).toBe(false), { path, ...quiet })
  })

  test("a child of a holder (GUILDHALL_GPU_HELD from another pid) does not wait", async () => {
    const path = lockPath()
    writeFileSync(path, JSON.stringify({ pid: process.pid, label: "parent", start: Date.now() }))
    process.env.GUILDHALL_GPU_HELD = String(process.pid + 1)
    await withGpu("child", () => {}, { path, ...quiet })
    expect(existsSync(path)).toBe(true)
  })
})
