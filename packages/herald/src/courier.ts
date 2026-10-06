import type { Change } from "@guildhall/core"
import { type Dispatch, HERALD_HEADER, type Health, HUB_PORT, hubBuild } from "@guildhall/hub"

/**
 * Carries a herald's changes to the hub in small batches (every FLUSH_MS). Never throws into
 * OpenCode. What the hub says decides what happens to a batch:
 *   2xx                     taken
 *   413 (too large)         split in half and sent again; a single event still too large is dropped
 *   other 4xx               dropped (logged): the hub will refuse it however often it is sent
 *   5xx, 429, 408, timeout  kept (capped) and retried with backoff; so is a hub that isn't there, and
 *   no answer at all        then the herald also tries to start a hub. Work goes on.
 */
const FLUSH_MS = 120
const RETRY_MS = 600
const MAX_RETRY_MS = 10_000
/** A hub that takes the connection but doesn't answer must not hang a flush (or OpenCode's exit). */
const TIMEOUT_MS = 3000
/** Flush on dispose gives up after this, however much is still queued. */
const DISPOSE_MS = 5000
/** Events (changes and raw host events) kept through an outage. */
const MAX_QUEUED = 10_000
/** Changes (and raw events) per POST: the hub refuses a batch of more. */
const MAX_BATCH = 500
/** Bytes per POST: well inside the hub's body cap (16 MB). */
const MAX_BYTES = 8 * 1024 * 1024

/** One queued event: a translated change, or the raw host event behind some. */
type Item = { change: Change } | { raw: unknown }

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
  /** Oldest first. A batch is the first few; they leave the queue once the hub has answered. */
  let queue: Item[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  /** In an outage: logged once when it starts, once when it ends. */
  let down = false
  let retry = RETRY_MS
  let disposed = false
  /** Most items the next batch may hold: halved by each 413, back to the full size after a success. */
  let cap = Number.POSITIVE_INFINITY
  /** One POST at a time, so batches reach the hub in the order they were sent. */
  let sending: Promise<boolean> = Promise.resolve(true)
  /** The hub's build was compared since it was last reached: once per hub, again after an outage. */
  let checked = false

  function schedule(ms: number): void {
    if (!disposed) timer ??= setTimeout(() => void flush(), ms)
  }

  function flush(): Promise<boolean> {
    timer = undefined
    sending = sending.then(post)
    return sending
  }

  /** The hub answered: it is up, whatever it thought of the batch. */
  function reached(): void {
    if (down) options.log("hub reachable again")
    down = false
    retry = RETRY_MS
    if (!checked) {
      checked = true
      void checkHub(base, options.log)
    }
  }

  /** Sends one batch; true when the queue moved on (sent, split or dropped) or was empty. */
  async function post(): Promise<boolean> {
    const batch = next()
    if (!batch) return true
    let failure: string
    let unreachable = false
    try {
      const response = await fetch(`${base}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", [HERALD_HEADER]: "1" },
        body: batch.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const status = response.status
      if (response.ok || (status >= 400 && status < 500 && status !== 429 && status !== 408)) {
        reached()
        if (status === 413 && batch.size > 1) cap = Math.ceil(batch.size / 2)
        else {
          if (status === 413) options.log(`hub at ${base} answered 413: dropped 1 event too large to send`)
          else if (!response.ok)
            options.log(
              `hub at ${base} answered ${status}: dropped ${batch.size} event(s) it will never take`,
            )
          queue.splice(0, batch.size)
          cap = Number.POSITIVE_INFINITY
        }
        if (queue.length > 0) schedule(0)
        return true
      }
      failure = `hub at ${base} answered ${status}`
    } catch (error) {
      const timedOut = (error as Error)?.name === "TimeoutError"
      unreachable = !timedOut
      failure = timedOut ? `hub at ${base} did not answer in ${TIMEOUT_MS} ms` : `hub unreachable at ${base}`
    }
    if (!down) options.log(`${failure}; keeping events and retrying`)
    down = true
    // Whatever answers next may be another hub (a restart, or a stale one the outage revealed).
    checked = false
    // Only when nothing listens: a hub that answers (or hangs) holds the port already.
    if (unreachable) startHub(options.log)
    // Keep the batch and try again: a hub just started needs a moment. Capped, so a hub that never
    // comes back can't grow the queue without bound.
    if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED)
    schedule(retry)
    retry = Math.min(retry * 2, MAX_RETRY_MS)
    return false
  }

  /**
   * The next batch from the head of the queue, as JSON: at most `cap` items and MAX_BATCH changes,
   * halved until it fits MAX_BYTES. A single event bigger than that, or one that can't be sent as
   * JSON at all (a host event with a BigInt or a cycle), is dropped (logged) on the way.
   */
  function next(): { body: string; size: number } | undefined {
    while (queue.length > 0) {
      let size = 0
      let changes = 0
      let raws = 0
      for (const item of queue) {
        if (size >= cap) break
        if ("change" in item ? changes >= MAX_BATCH : raws >= MAX_BATCH) break
        if ("change" in item) changes++
        else raws++
        size++
      }
      const body = serialize(queue.slice(0, size))
      if (body === undefined) continue
      if (Buffer.byteLength(body) <= MAX_BYTES) return { body, size }
      if (size > 1) {
        cap = Math.ceil(size / 2)
        continue
      }
      queue.shift()
      cap = Number.POSITIVE_INFINITY
      options.log(`dropped 1 event of more than ${MAX_BYTES} bytes`)
    }
    return undefined
  }

  /** The items as a dispatch; undefined when some couldn't be sent as JSON (they leave the queue). */
  function serialize(items: Item[]): string | undefined {
    const dispatch: Dispatch = {
      guild: options.guild,
      opencode: options.opencode,
      changes: items.flatMap((item) => ("change" in item ? [item.change] : [])),
      raw: items.flatMap((item) => ("raw" in item ? [item.raw] : [])),
    }
    try {
      return JSON.stringify(dispatch)
    } catch {
      const bad = new Set(
        items.filter((item) => json("change" in item ? item.change : item.raw) === undefined),
      )
      queue = queue.filter((item) => !bad.has(item))
      options.log(`dropped ${bad.size} event(s) that can't be sent as JSON`)
      return undefined
    }
  }

  return {
    flush: async () => {
      if (timer) clearTimeout(timer)
      disposed = true
      const deadline = Date.now() + DISPOSE_MS
      while (queue.length > 0 && Date.now() < deadline) {
        if (!(await flush())) break
      }
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    send(next, event) {
      for (const change of next) queue.push({ change })
      queue.push({ raw: event })
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

/**
 * Logs, loudly, when what answers on the hub's port is not the hub these sources would start: a hub
 * still running older code, or another program. Events still go to it; stopping it is the user's
 * call (the log says how). Never throws.
 */
async function checkHub(base: string, log: (message: string) => void): Promise<void> {
  let ours: string
  try {
    ours = hubBuild()
  } catch {
    return // the hub's sources aren't readable from here: nothing to compare with
  }
  let health: Partial<Health>
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    health = (await response.json()) as Partial<Health>
    if (typeof health !== "object" || health === null || health.ok !== true) throw new Error("not a hub")
  } catch {
    log(`WARNING: what answers at ${base} is not a guildhall hub (no valid /health); events are going to it`)
    return
  }
  if (health.build === ours) return
  const which = health.build ? `build ${health.build}` : "a build from before builds were reported"
  log(
    `WARNING: stale hub at ${base}: it runs ${which} (pid ${health.pid ?? "unknown"}, started ${health.started ?? "unknown"}), ` +
      `these sources are build ${ours}. It lacks any hub fix made since. Stop that process and a herald will start a fresh hub.`,
  )
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
