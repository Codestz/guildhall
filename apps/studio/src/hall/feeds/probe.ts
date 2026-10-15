/**
 * The hall's live default (decisions H1a): `/hall/<this repo>` opens `?feed=live` by itself on a
 * developer's machine when the hub answers and keeps a guild for this repo, and stays history-only
 * everywhere else. The probe is a WebSocket to the hub (its `/health` sends no CORS header, and the hub
 * takes only local origins): it asks for the `hello`, the guilds in it, and gives up after `PROBE_MS`.
 * The public site never probes. The socket and the timers are injectable, for tests.
 */

import { hasParam, param } from "../../params.ts"
import type { SocketLike } from "./live.ts"
import { hubUrlOf } from "./live.ts"
import { guildMatcher, hubMessage } from "./wire.ts"

/** How long the hub has to say hello before the hall stays on its history. */
export const PROBE_MS = 600

/** This machine: where a hub can be (localhost, 127.0.0.1, [::1]); anything else never probes. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost")
}

export interface ProbeOptions {
  /** The hub's socket address (default: the legacy hub). */
  url?: string
  /** Which guilds are this repo's. */
  guild: (guild: string) => boolean
  timeoutMs?: number
  socket?: (url: string) => SocketLike
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** Does the hub answer with a hello that holds a guild of this repo, within the timeout? Never throws. */
export function probeHub(opts: ProbeOptions): Promise<boolean> {
  const open = opts.socket ?? ((url) => new WebSocket(url) as unknown as SocketLike)
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  return new Promise((resolve) => {
    let socket: SocketLike | null = null
    let timer: unknown = null
    let done = false
    const finish = (answer: boolean) => {
      if (done) return
      done = true
      if (timer !== null) clearTimer(timer)
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
        try {
          socket.close()
        } catch {}
      }
      resolve(answer)
    }
    try {
      socket = open(opts.url ?? hubUrlOf(null))
    } catch {
      finish(false)
      return
    }
    timer = setTimer(() => finish(false), opts.timeoutMs ?? PROBE_MS)
    socket.onmessage = (message) => {
      const data = hubMessage(message.data)
      if (!data || data.type !== "hello") return
      finish(data.events.some((e) => opts.guild(e.guild)) || data.sea.some((r) => opts.guild(r.guild)))
    }
    socket.onclose = () => finish(false)
    socket.onerror = () => finish(false)
  })
}

export interface AutoFeedOptions {
  /** The page's host name (`location.hostname`). */
  hostname: string
  probe?: (opts: ProbeOptions) => Promise<boolean>
}

/**
 * The feed a repo's hall opens by default: `"live"` on this machine when the link names no `?feed=` and
 * the hub has a guild of this repo; null otherwise (history only). Off this machine it does not even try.
 */
export async function autoFeed(
  query: URLSearchParams,
  slug: string,
  opts: AutoFeedOptions,
): Promise<"live" | null> {
  if (hasParam(query, "feed") || !isLocalHost(opts.hostname)) return null
  const repo = slug.split("/").pop() || slug
  const exact = param(query, "guild")
  const answered = await (opts.probe ?? probeHub)({
    url: hubUrlOf(param(query, "hub")),
    guild: guildMatcher(exact ?? repo, exact !== null),
  }).catch(() => false)
  return answered ? "live" : null
}
