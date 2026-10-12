/**
 * A machine-wide lock on the GPU, so the browser-driving scripts (probe, golden, bench, record,
 * shot) take turns: agents in parallel worktrees share one M-series GPU, and two Chromes at once
 * overload it and skew every fps number. The lock is one file in the OS temp dir, not in the repo
 * (worktrees live in different directories), created atomically ('wx') holding who has it.
 *
 *   await withGpu("bench", async () => { … })     the lock for the length of the function
 *   await acquireGpu("shot")                       or for the rest of the process (released on exit,
 *                                                  SIGINT, SIGTERM, an uncaught error)
 *
 * A holder that died (pid gone) or that has held it for over 2 h (a wedged run) is reclaimed.
 * Child processes of a holder skip the lock (GUILDHALL_GPU_HELD) so a script that runs another
 * one does not wait on itself. GUILDHALL_GPU_LOCK=0 turns the whole thing off.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const LOCK_PATH = join(tmpdir(), "guildhall-gpu.lock")
const MAX_AGE_MS = 2 * 60 * 60_000
const POLL_MS = 1000
/** How often the "waiting" line repeats, so a long wait shows it is alive without spamming. */
const LOG_EVERY_MS = 15_000

interface Holder {
  pid: number
  label: string
  /** Epoch ms. */
  start: number
}

export interface GpuOptions {
  /** Where the lock lives; tests use their own. */
  path?: string
  pollMs?: number
  maxAgeMs?: number
  log?: (line: string) => void
}

function read(path: string): Holder | undefined {
  try {
    const holder = JSON.parse(readFileSync(path, "utf8")) as Holder
    return typeof holder.pid === "number" ? holder : undefined
  } catch {
    return undefined
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Takes the lock if it is free or its holder is stale; otherwise returns who has it. */
function tryTake(path: string, me: Holder, maxAgeMs: number): Holder | undefined {
  try {
    writeFileSync(path, JSON.stringify(me), { flag: "wx" })
    return undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  const holder = read(path)
  // Unreadable: its owner is mid-write (or it is garbage); the next poll sees which.
  if (!holder) return { pid: 0, label: "(starting)", start: Date.now() }
  if (alive(holder.pid) && Date.now() - holder.start < maxAgeMs) return holder
  // Stale. Unlink only if it is still the same one we judged, so a fresh lock taken in between survives.
  const again = read(path)
  if (again?.pid === holder.pid && again.start === holder.start) rmSync(path, { force: true })
  return tryTake(path, me, maxAgeMs)
}

/** Waits for the GPU and returns the release (idempotent). A no-op when disabled or inherited from a parent. */
export async function acquireGpu(label: string, options: GpuOptions = {}): Promise<() => void> {
  const { path = LOCK_PATH, pollMs = POLL_MS, maxAgeMs = MAX_AGE_MS, log = (l) => console.error(l) } = options
  const inherited = process.env.GUILDHALL_GPU_HELD
  if (process.env.GUILDHALL_GPU_LOCK === "0" || (inherited && inherited !== String(process.pid)))
    return () => {}
  const me: Holder = { pid: process.pid, label, start: Date.now() }
  let waitedSince = 0
  let lastLogged = 0
  for (;;) {
    const holder = tryTake(path, me, maxAgeMs)
    if (!holder) break
    const now = Date.now()
    waitedSince ||= now
    if (now - lastLogged >= LOG_EVERY_MS) {
      lastLogged = now
      log(
        `waiting for GPU: held by ${holder.label} pid ${holder.pid} for ${Math.round((now - holder.start) / 1000)}s`,
      )
    }
    await Bun.sleep(pollMs)
  }
  if (waitedSince) log(`GPU free after ${Math.round((Date.now() - waitedSince) / 1000)}s: running ${label}`)

  const previous = process.env.GUILDHALL_GPU_HELD
  process.env.GUILDHALL_GPU_HELD = String(process.pid)
  let released = false
  const release = () => {
    if (released) return
    released = true
    process.off("exit", release)
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    // Only our own lock: a stale-reclaimed one may belong to someone else by now.
    const holder = read(path)
    if (holder?.pid === me.pid && holder.start === me.start) rmSync(path, { force: true })
    if (previous === undefined) delete process.env.GUILDHALL_GPU_HELD
    else process.env.GUILDHALL_GPU_HELD = previous
  }
  const onSignal = (signal: NodeJS.Signals) => {
    release()
    process.exit(128 + (signal === "SIGINT" ? 2 : 15))
  }
  process.on("exit", release)
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)
  return release
}

/** Runs `fn` holding the GPU; released however it ends. */
export async function withGpu<T>(label: string, fn: () => Promise<T> | T, options?: GpuOptions): Promise<T> {
  const release = await acquireGpu(label, options)
  try {
    return await fn()
  } finally {
    release()
  }
}
