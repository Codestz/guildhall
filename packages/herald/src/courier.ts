import type { Change } from "@guildhall/core"
import { type Dispatch, HERALD_HEADER, HUB_PORT } from "@guildhall/hub"

/**
 * Carries a herald's changes to the hub in small batches (every FLUSH_MS). Never throws into
 * OpenCode: while the hub is down, refuses a batch or doesn't answer, the batch is kept (capped) and
 * retried with backoff; if nothing listens at all the herald tries to start a hub. Work goes on.
 */
const FLUSH_MS = 120
const RETRY_MS = 600
const MAX_RETRY_MS = 10_000
/** A hub that takes the connection but doesn't answer must not hang a flush (or OpenCode's exit). */
const TIMEOUT_MS = 3000
/** Flush on dispose gives up after this, however much is still queued. */
const DISPOSE_MS = 5000
const MAX_QUEUED = 5000
/** Changes per POST, so a long outage's backlog goes out in requests the hub will take. */
const MAX_BATCH = 500

export interface Courier {
  send(changes: Change[], raw: unknown): void
  /**
   * Send what is queued now — on shutdown, so a session's last events (its "done") aren't lost.
   * Returns within a few seconds even if the hub is gone, and stops retrying afterwards.
   */
  flush(): Promise<void>
}

export function createCourier(options: {
  guild: string
  opencode: 1 | 2
  log: (message: string) => void
  port?: number
}): Courier {
  const base = `http://127.0.0.1:${options.port ?? Number(process.env.GUILDHALL_PORT ?? HUB_PORT)}`
  let changes: Change[] = []
  let raw: unknown[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  /** In an outage: logged once when it starts, once when it ends. */
  let down = false
  let retry = RETRY_MS
  let disposed = false
  /** One POST at a time, so batches reach the hub in the order they were sent. */
  let sending: Promise<boolean> = Promise.resolve(true)

  function schedule(ms: number): void {
    if (!disposed) timer ??= setTimeout(() => void flush(), ms)
  }

  function flush(): Promise<boolean> {
    timer = undefined
    sending = sending.then(post)
    return sending
  }

  /** Sends one batch; true when the hub took it (or there was nothing to send). */
  async function post(): Promise<boolean> {
    if (changes.length === 0 && raw.length === 0) return true
    const batch = { changes: changes.splice(0, MAX_BATCH), raw: raw.splice(0, MAX_BATCH) }
    const body = serialize(batch)
    let failure: string
    let unreachable = false
    try {
      const response = await fetch(`${base}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", [HERALD_HEADER]: "1" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.ok) {
        if (down) options.log("hub reachable again")
        down = false
        retry = RETRY_MS
        if (changes.length > 0 || raw.length > 0) schedule(0)
        return true
      }
      failure = `hub at ${base} answered ${response.status}`
    } catch (error) {
      const timedOut = (error as Error)?.name === "TimeoutError"
      unreachable = !timedOut
      failure = timedOut ? `hub at ${base} did not answer in ${TIMEOUT_MS} ms` : `hub unreachable at ${base}`
    }
    if (!down) options.log(`${failure}; keeping events and retrying`)
    down = true
    // Only when nothing listens: a hub that answers (or hangs) holds the port already.
    if (unreachable) startHub(options.log)
    // Keep the batch and try again: a hub just started needs a moment. Capped, so a hub that never
    // comes back can't grow the queue without bound.
    changes = [...batch.changes, ...changes].slice(-MAX_QUEUED)
    raw = [...batch.raw, ...raw].slice(-MAX_QUEUED)
    schedule(retry)
    retry = Math.min(retry * 2, MAX_RETRY_MS)
    return false
  }

  /**
   * The dispatch as JSON. Host events are whatever OpenCode hands us: one with a BigInt or a cycle
   * is dropped (logged) rather than taken for a dead hub. Changes are ours, but checked the same way.
   */
  function serialize(batch: { changes: Change[]; raw: unknown[] }): string {
    const dispatch: Dispatch = { guild: options.guild, opencode: options.opencode, ...batch }
    try {
      return JSON.stringify(dispatch)
    } catch {
      const keep = <T>(items: T[]) => items.filter((item) => json(item) !== undefined)
      const clean = { ...dispatch, changes: keep(dispatch.changes), raw: keep(batch.raw) }
      const dropped = batch.changes.length + batch.raw.length - clean.changes.length - clean.raw.length
      options.log(`dropped ${dropped} event(s) that can't be sent as JSON`)
      batch.changes = clean.changes
      batch.raw = clean.raw
      return JSON.stringify(clean)
    }
  }

  return {
    flush: async () => {
      if (timer) clearTimeout(timer)
      disposed = true
      const deadline = Date.now() + DISPOSE_MS
      while ((changes.length > 0 || raw.length > 0) && Date.now() < deadline) {
        if (!(await flush())) break
      }
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    send(next, event) {
      changes.push(...next)
      raw.push(event)
      schedule(FLUSH_MS)
    },
  }
}

function json(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/** A failed or finished start may be tried again after this (a hub that crashed, a later outage). */
const START_EVERY_MS = 30_000
let started = Number.NEGATIVE_INFINITY

/**
 * Start the hub as its own process if Bun is on PATH (OpenCode itself is a compiled binary). Shared
 * by every courier in this process, and at most once per START_EVERY_MS.
 */
function startHub(log: (message: string) => void): void {
  if (Date.now() - started < START_EVERY_MS) return
  started = Date.now()
  // PATH as it is now: Bun.which alone reads the PATH the process started with.
  const bun = Bun.which("bun", { PATH: process.env.PATH ?? "" })
  if (!bun) {
    log("bun not found on PATH; start the hub with `bun packages/hub/src/main.ts`")
    return
  }
  const main = new URL("../../hub/src/main.ts", import.meta.url).pathname
  const child = Bun.spawn([bun, main], { stdio: ["ignore", "ignore", "ignore"] })
  child.unref()
  log(`started hub (pid ${child.pid})`)
}
