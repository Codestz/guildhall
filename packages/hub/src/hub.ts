import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { type GuildEvent, WIRE_VERSION } from "@guildhall/core"
import type { Server, ServerWebSocket } from "bun"
import { type Dispatch, HERALD_HEADER, HUB_PORT, type HubMessage } from "./protocol.ts"

/**
 * The hub (ADR 0003): heralds POST their guild's changes here; halls subscribe over WebSocket.
 * It numbers events per guild, keeps this boot's events in memory so a hall that connects late
 * still sees everything, and writes every event to a chronicle (and the raw host events to a raw
 * log) under GUILDHALL_HOME. Bound to 127.0.0.1 only.
 */

export interface HubOptions {
  port?: number
  home?: string
  /** Most events kept in memory per guild for late halls. */
  keep?: number
}

export function startHub(options: HubOptions = {}): Server<unknown> {
  const port = options.port ?? Number(process.env.GUILDHALL_PORT ?? HUB_PORT)
  const home = options.home ?? process.env.GUILDHALL_HOME ?? join(homedir(), ".cache", "guildhall")
  const keep = options.keep ?? 20_000
  const boot = new Date().toISOString().replace(/[:.]/g, "-")
  const events = new Map<string, GuildEvent[]>()
  const halls = new Set<ServerWebSocket<unknown>>()

  async function record(dispatch: Dispatch): Promise<GuildEvent[]> {
    const list = events.get(dispatch.guild) ?? []
    events.set(dispatch.guild, list)
    const out = dispatch.changes.map((change) => {
      const event: GuildEvent = {
        v: WIRE_VERSION,
        guild: dispatch.guild,
        seq: (list.at(-1)?.seq ?? 0) + 1,
        change,
      }
      list.push(event)
      return event
    })
    if (list.length > keep) list.splice(0, list.length - keep)
    const dir = join(home, "chronicles", safe(dispatch.guild))
    await mkdir(dir, { recursive: true })
    if (out.length > 0)
      await appendFile(join(dir, `${boot}.jsonl`), out.map((e) => JSON.stringify(e)).join("\n") + "\n")
    if (dispatch.raw?.length) {
      const line = dispatch.raw.map((raw) =>
        JSON.stringify({ at: Date.now(), opencode: dispatch.opencode, raw }),
      )
      await appendFile(join(dir, `${boot}.raw.jsonl`), `${line.join("\n")}\n`)
    }
    return out
  }

  function broadcast(message: HubMessage): void {
    const text = JSON.stringify(message)
    for (const hall of halls) hall.send(text)
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === "/health") return Response.json({ ok: true, guilds: [...events.keys()] })
      if (url.pathname === "/events" && request.method === "POST") {
        if (request.headers.get(HERALD_HEADER) !== "1") return new Response("forbidden", { status: 403 })
        const dispatch = (await request.json()) as Dispatch
        if (!dispatch?.guild || !Array.isArray(dispatch.changes))
          return new Response("bad dispatch", { status: 400 })
        const recorded = await record(dispatch)
        if (recorded.length > 0) broadcast({ type: "events", events: recorded })
        return Response.json({ ok: true, count: recorded.length })
      }
      if (url.pathname === "/ws") {
        if (!localOrigin(request.headers.get("origin"))) return new Response("forbidden", { status: 403 })
        if (server.upgrade(request, { data: undefined })) return undefined
        return new Response("upgrade failed", { status: 400 })
      }
      return new Response("not found", { status: 404 })
    },
    websocket: {
      open(hall) {
        halls.add(hall)
        const all = [...events.values()].flat()
        hall.send(JSON.stringify({ type: "hello", version: WIRE_VERSION, events: all } satisfies HubMessage))
      },
      close(hall) {
        halls.delete(hall)
      },
      message() {
        // Control messages (answering pleas) come later, behind a per-boot token (ADR 0003).
      },
    },
  })
}

/** A hall may connect from a page served on this machine only. */
function localOrigin(origin: string | null): boolean {
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
  } catch {
    return false
  }
}

function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "guild"
}
