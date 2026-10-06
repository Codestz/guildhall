import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { type GuildEvent, WIRE_VERSION } from "@guildhall/core"
import type { Server, ServerWebSocket } from "bun"
import { type Dispatch, HERALD_HEADER, HUB_PORT, type HubMessage } from "./protocol.ts"
import { MAX_CHANGES, MAX_RAW, MAX_RAW_TOTAL, validChange, validGuild } from "./validate.ts"

/**
 * The hub (ADR 0003): heralds POST their guild's changes here; halls subscribe over WebSocket.
 * It numbers events per guild, keeps recent events in memory so a hall that connects late still
 * sees everything, and writes every event to a chronicle (and the raw host events to a raw log)
 * under GUILDHALL_HOME. On start it reads back the last day's chronicles, so a hub restart doesn't
 * blank the halls. Bound to 127.0.0.1 only.
 */

export interface HubOptions {
  port?: number
  home?: string
  /** Most events kept in memory per guild for late halls. */
  keep?: number
  /**
   * Most bytes a hall may leave unread before it is dropped as too slow (it reconnects and gets a
   * fresh hello), rather than have events silently go missing.
   */
  maxBuffered?: number
}

/** Largest herald POST. A batch is capped at MAX_CHANGES changes, each capped by the validator. */
const MAX_BODY = 16 * 1024 * 1024
/** Chronicles older than this aren't read back on start: those sessions are long over. */
const HISTORY_MS = 24 * 60 * 60 * 1000

/**
 * Which hub this is: a hash of the hub's own source files. A herald computes it from the same files
 * on disk and compares it with `/health`, so a hub still running older code (or something else
 * holding the port) is noticed rather than trusted (docs/reviews/review-2.md, finding 5).
 */
export function hubBuild(dir = dirname(fileURLToPath(import.meta.url))): string {
  const hash = createHash("sha256")
  for (const file of list(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort()) {
    hash.update(`${file}\0`)
    hash.update(readFileSync(join(dir, file)))
  }
  return hash.digest("hex").slice(0, 12)
}

/** What `/health` answers. */
export interface Health {
  ok: true
  /** `hubBuild()` when this hub started. */
  build: string
  /** When this hub started, ISO 8601. */
  started: string
  pid: number
  wire: number
  guilds: string[]
  halls: number
}

export function startHub(options: HubOptions = {}): Server<unknown> {
  const port = options.port ?? Number(process.env.GUILDHALL_PORT ?? HUB_PORT)
  const home = options.home ?? process.env.GUILDHALL_HOME ?? join(homedir(), ".cache", "guildhall")
  const keep = options.keep ?? 20_000
  const maxBuffered = options.maxBuffered ?? 16 * 1024 * 1024
  const started = new Date().toISOString()
  const build = hubBuild()
  const boot = started.replace(/[:.]/g, "-")
  const events = loadHistory(join(home, "chronicles"), keep)
  const halls = new Set<ServerWebSocket<unknown>>()
  /** Per guild, the dispatch being recorded: the next waits for it, so seq and broadcasts agree. */
  const queues = new Map<string, Promise<unknown>>()

  function inOrder<T>(guild: string, work: () => Promise<T>): Promise<T> {
    const run = (queues.get(guild) ?? Promise.resolve()).then(work)
    queues.set(
      guild,
      run.catch(() => {}),
    )
    return run
  }

  /** Numbers the changes, sends them to the halls, then writes them down. Run in order per guild. */
  async function record(guild: string, dispatch: Dispatch): Promise<GuildEvent[]> {
    const list = events.get(guild) ?? []
    events.set(guild, list)
    const out = dispatch.changes.map((change) => {
      const event: GuildEvent = { v: WIRE_VERSION, guild, seq: (list.at(-1)?.seq ?? 0) + 1, change }
      list.push(event)
      return event
    })
    if (list.length > keep) list.splice(0, list.length - keep)
    if (out.length > 0) broadcast({ type: "events", events: out })
    try {
      const dir = chronicleDir(home, guild)
      await mkdir(dir, { recursive: true })
      if (out.length > 0)
        await appendFile(join(dir, `${boot}.jsonl`), `${out.map((e) => JSON.stringify(e)).join("\n")}\n`)
      if (dispatch.raw?.length) {
        const line = dispatch.raw.map((raw) =>
          JSON.stringify({ at: Date.now(), opencode: dispatch.opencode, raw }),
        )
        await appendFile(join(dir, `${boot}.raw.jsonl`), `${line.join("\n")}\n`)
      }
    } catch (error) {
      // The events are numbered and sent already: failing the POST would have the herald resend them.
      console.warn(`hub: could not write ${guild}'s chronicle: ${String(error)}`)
    }
    return out
  }

  function broadcast(message: HubMessage): void {
    const text = JSON.stringify(message)
    for (const hall of halls) {
      if (hall.readyState !== WebSocket.OPEN) {
        halls.delete(hall)
        continue
      }
      // Bun: 0 = dropped, -1 = queued behind bytes the hall hasn't read yet.
      const sent = hall.send(text)
      if (sent === 0 || (sent === -1 && hall.getBufferedAmount() > maxBuffered)) {
        halls.delete(hall)
        hall.terminate()
      }
    }
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    maxRequestBodySize: MAX_BODY,
    async fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === "/health")
        return Response.json({
          ok: true,
          build,
          started,
          pid: process.pid,
          wire: WIRE_VERSION,
          guilds: [...events.keys()],
          halls: halls.size,
        } satisfies Health)
      if (url.pathname === "/events" && request.method === "POST") {
        if (request.headers.get(HERALD_HEADER) !== "1") return new Response("forbidden", { status: 403 })
        // Heralds never send an Origin; a browser always does. A page that rebinds its own DNS name
        // to 127.0.0.1 is a browser too, and its requests carry that name as Host.
        if (request.headers.has("origin") || !loopbackHost(request.headers.get("host"), server.port))
          return new Response("forbidden", { status: 403 })
        const body = (await request.json().catch(() => undefined)) as Partial<Dispatch> | undefined
        if (!body || !validGuild(body.guild) || !Array.isArray(body.changes))
          return new Response("bad dispatch", { status: 400 })
        if (body.changes.length > MAX_CHANGES)
          return new Response(`too many changes: at most ${MAX_CHANGES} per dispatch`, { status: 400 })
        const guild = body.guild
        const now = Date.now()
        const changes = body.changes.filter((change) => validChange(change, now))
        const rejected = body.changes.length - changes.length
        if (rejected > 0) console.warn(`hub: rejected ${rejected} bad change(s) from ${guild}`)
        const raw = Array.isArray(body.raw) ? rawWithin(body.raw, guild) : undefined
        if (raw === null) return new Response(`raw events over ${MAX_RAW_TOTAL} chars`, { status: 413 })
        const opencode = body.opencode === 1 ? 1 : 2
        const recorded = await inOrder(guild, () => record(guild, { guild, opencode, changes, raw }))
        return Response.json(
          rejected > 0
            ? { ok: true, count: recorded.length, rejected }
            : { ok: true, count: recorded.length },
        )
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

/**
 * Each guild's recent events from earlier boots: its chronicles of the last HISTORY_MS, newest
 * first, for as long as their seqs run on from each other (a boot that started over at 1 ends it),
 * up to `keep`. Lines that don't parse or check out — a half-written last line — are skipped.
 */
function loadHistory(root: string, keep: number): Map<string, GuildEvent[]> {
  const loaded = new Map<string, GuildEvent[]>()
  const since = Date.now() - HISTORY_MS
  for (const dir of list(root)) {
    const files = list(join(root, dir))
      .filter((file) => file.endsWith(".jsonl") && !file.endsWith(".raw.jsonl"))
      .filter((file) => modified(join(root, dir, file)) >= since)
      .sort()
      .reverse()
    let history: GuildEvent[] = []
    for (const file of files) {
      const older = read(join(root, dir, file))
      const first = history[0]
      if (first && older.some((event) => event.guild !== first.guild || event.seq >= first.seq)) break
      history = [...older, ...history]
      if (history.length >= keep) break
    }
    const guild = history[0]?.guild
    if (guild && !loaded.has(guild)) loaded.set(guild, history.slice(-keep))
  }
  return loaded
}

function read(file: string): GuildEvent[] {
  const out: GuildEvent[] = []
  let text = ""
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return out
  }
  for (const line of text.split("\n")) {
    if (!line) continue
    try {
      const event = JSON.parse(line) as GuildEvent
      const last = out.at(-1)
      if (
        event?.v === WIRE_VERSION &&
        validGuild(event.guild) &&
        Number.isInteger(event.seq) &&
        validChange(event.change) &&
        (!last || (event.guild === last.guild && event.seq > last.seq))
      )
        out.push(event)
    } catch {
      // A line cut short when the last hub stopped.
    }
  }
  return out
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function modified(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
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

/**
 * The raw host events worth keeping: each one over MAX_RAW (as JSON) is dropped, or can't be written
 * at all; null when what is left is still over MAX_RAW_TOTAL.
 */
function rawWithin(raw: unknown[], guild: string): unknown[] | null {
  let total = 0
  const kept = raw.filter((event) => {
    let length: number
    try {
      length = JSON.stringify(event)?.length ?? 0
    } catch {
      return false
    }
    if (length > MAX_RAW) return false
    total += length
    return true
  })
  if (kept.length < raw.length)
    console.warn(`hub: dropped ${raw.length - kept.length} raw event(s) from ${guild}`)
  return total > MAX_RAW_TOTAL ? null : kept
}

/** A herald talks to 127.0.0.1:<port> (or localhost), and says so in Host. */
function loopbackHost(host: string | null, port: number | undefined): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

/**
 * The guild's chronicle directory, always inside `<home>/chronicles` whatever the name holds (the
 * validator refuses dangerous names already; this holds even if it didn't).
 */
function chronicleDir(home: string, guild: string): string {
  const root = resolve(home, "chronicles")
  const name =
    guild
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^\.+/, "_")
      .slice(0, 80) || "guild"
  const dir = resolve(root, name)
  if (!dir.startsWith(root + sep)) throw new Error(`guild ${JSON.stringify(guild)} leaves the chronicles`)
  return dir
}
