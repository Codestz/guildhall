import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { createV1Translator, createV2Translator } from "@guildhall/core"
import { createCourier } from "./courier.ts"

/**
 * The herald (CONTEXT.md): the OpenCode half of Guildhall. It listens to OpenCode's events,
 * translates them with cockpit's translators into `Change`s, and sends them to the hub.
 *
 * One default export both OpenCodes load (cockpit's dual shape, docs/opencode/plugin-api.md):
 * OpenCode 1 calls `server(input)` and gets hooks back; OpenCode 2 calls `setup(ctx)`.
 */

const ID = "guildhall"

/** Each unknown host event type, logged once: the stream carries many we don't need. */
const seen = new Set<string>()
function unknown(version: number) {
  return (what: string, detail?: unknown) => {
    const type =
      typeof detail === "object" && detail ? String((detail as { type?: unknown }).type ?? what) : what
    if (seen.has(`${version}:${type}`)) return
    seen.add(`${version}:${type}`)
    log(`v${version} unknown: ${type}`)
  }
}

const logFile = join(process.env.GUILDHALL_HOME ?? join(homedir(), ".cache", "guildhall"), "herald.log")
function log(message: string): void {
  try {
    mkdirSync(join(logFile, ".."), { recursive: true })
    appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] ${message}\n`)
  } catch {
    // Logging must never break OpenCode.
  }
}

interface V1Input {
  directory: string
}

interface V2Context {
  location?: { directory: string }
  tool?: unknown
  event?: { subscribe(options: { signal: AbortSignal }): AsyncIterable<unknown> }
}

export default {
  id: ID,

  /** OpenCode 1: the `event` hook sees every bus event. */
  server: async (input: V1Input) => {
    const guild = basename(input.directory)
    log(`v1 server start in ${input.directory}`)
    const translator = createV1Translator(unknown(1))
    const courier = createCourier({ guild, opencode: 1, log })
    return {
      dispose: async () => courier.flush(),
      event: async ({ event }: { event: unknown }) => {
        try {
          courier.send(translator.event(event, Date.now()), event)
        } catch (error) {
          log(`v1 translate failed: ${String(error)}`)
        }
      },
    }
  },

  /** OpenCode 2: subscribe to the event stream, reopening it if it ends (cockpit's `follow`). */
  setup: async (ctx: V2Context) => {
    // v1 1.18.29+ also calls setup with a preview context: no tools, no location. Skip it.
    if (!ctx.tool || !ctx.location || !ctx.event) return
    const events = ctx.event
    const guild = basename(ctx.location.directory)
    log(`v2 setup in ${ctx.location.directory}`)
    const translator = createV2Translator(unknown(2))
    const courier = createCourier({ guild, opencode: 2, log })
    const stop = new AbortController()
    void (async () => {
      let delay = 1000
      while (!stop.signal.aborted) {
        const opened = Date.now()
        try {
          for await (const event of events.subscribe({ signal: stop.signal })) {
            try {
              courier.send(translator.event(event, Date.now()), event)
            } catch (error) {
              log(`v2 translate failed: ${String(error)}`)
            }
          }
        } catch (error) {
          if (stop.signal.aborted) return
          log(`v2 event stream failed: ${String(error)}`)
        }
        if (Date.now() - opened > 60_000) delay = 1000
        await new Promise((done) => setTimeout(done, delay))
        delay = Math.min(delay * 2, 30_000)
      }
    })()
    return async () => {
      stop.abort()
      await courier.flush()
    }
  },
}
