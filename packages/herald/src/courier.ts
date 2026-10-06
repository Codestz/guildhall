import type { Change } from "@guildhall/core"
import { type Dispatch, HERALD_HEADER, HUB_PORT } from "@guildhall/hub"

/**
 * Carries a herald's changes to the hub in small batches (every FLUSH_MS). Never throws into
 * OpenCode: if the hub is down the batch is dropped, the herald tries to start one, and work goes on.
 */
const FLUSH_MS = 120

export interface Courier {
  send(changes: Change[], raw: unknown): void
  /** Send what is queued now — on shutdown, so a session's last events (its "done") aren't lost. */
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
  let down = false

  async function flush(): Promise<void> {
    timer = undefined
    if (changes.length === 0 && raw.length === 0) return
    const dispatch: Dispatch = { guild: options.guild, opencode: options.opencode, changes, raw }
    changes = []
    raw = []
    try {
      const response = await fetch(`${base}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", [HERALD_HEADER]: "1" },
        body: JSON.stringify(dispatch),
      })
      if (down) options.log("hub reachable again")
      down = !response.ok
    } catch {
      if (!down) {
        options.log(`hub unreachable at ${base}; starting one`)
        startHub(options.log)
      }
      down = true
    }
  }

  return {
    flush: async () => {
      if (timer) clearTimeout(timer)
      await flush()
    },
    send(next, event) {
      changes.push(...next)
      raw.push(event)
      timer ??= setTimeout(() => void flush(), FLUSH_MS)
    },
  }
}

let starting = false

/** Start the hub as its own process, once, if Bun is on PATH (OpenCode itself is a compiled binary). */
function startHub(log: (message: string) => void): void {
  if (starting) return
  starting = true
  const bun = Bun.which("bun")
  if (!bun) {
    log("bun not found on PATH; start the hub with `bun packages/hub/src/main.ts`")
    return
  }
  const main = new URL("../../hub/src/main.ts", import.meta.url).pathname
  const child = Bun.spawn([bun, main], { stdio: ["ignore", "ignore", "ignore"] })
  child.unref()
  log(`started hub (pid ${child.pid})`)
}
