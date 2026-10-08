import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { type GuildEvent, type SeaEvent, type SeaRecord, WIRE_VERSION } from "@guildhall/core"
import type { Server, ServerWebSocket } from "bun"
import { list, loadHistory, loadSea, PRUNE_EVERY_MS, pruneChronicles } from "./chronicles.ts"
import { createGithub, type GithubMode, type GithubOptions, type SeaTarget } from "./github.ts"
import { createProjects, type KnownProject } from "./projects.ts"
import { type Dispatch, HERALD_HEADER, HUB_PORT, type HubMessage } from "./protocol.ts"
import { serveStatic } from "./static.ts"
import { MAX_CHANGES, MAX_RAW, MAX_RAW_TOTAL, validChange, validGuild, validProject } from "./validate.ts"

/**
 * The hub (ADR 0003): heralds POST their guild's changes here; halls subscribe over WebSocket.
 * It numbers events per guild, keeps recent events in memory so a hall that connects late still
 * sees everything, and writes every event to a chronicle (and the raw host events to a raw log)
 * under GUILDHALL_HOME. On start it reads back the last day's chronicles, so a hub restart doesn't
 * blank the halls. Old chronicles are pruned on start and as the hub runs (see chronicles.ts), and a
 * hall's hello carries the recent guilds only (HELLO_GUILDS, HELLO_EVENTS). Bound to 127.0.0.1 only.
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
  /**
   * A built hall (Vite's `dist`) to serve at `/`, as the npm package does (ADR 0002). Without one,
   * the hub serves only its API and the hall runs from its own dev server.
   */
  hall?: string
  /** How often retention is applied again while the hub runs (PRUNE_EVERY_MS); it also is on start. */
  pruneEvery?: number
  /**
   * The watch on GitHub for projects with a GitHub remote (github.ts, PROTOCOL.md §7): on unless
   * `false` or GUILDHALL_GITHUB=0. It does nothing until a project with a GitHub remote is heard from.
   */
  github?: (GithubOptions & { every?: number }) | false
}

/** Largest herald POST. A batch is capped at MAX_CHANGES changes, each capped by the validator. */
const MAX_BODY = 16 * 1024 * 1024
/**
 * What a hall gets in its hello: the events of the HELLO_GUILDS guilds most recently active (by their
 * last event), newest events first up to HELLO_EVENTS in all. Each guild keeps at most `keep` events
 * in memory already; this bounds how many guilds' worth one connection is sent.
 */
export const HELLO_GUILDS = 8
export const HELLO_EVENTS = 50_000
/** Sea records kept per guild for a hall's hello. */
export const SEA_KEEP = 200
/** A project heard from within this long has its repo watched. */
export const SEA_ACTIVE_MS = 6 * 60 * 60 * 1000
/** How often the GitHub watch looks for a repo that is due (each repo has its own interval). */
const SEA_TICK_MS = 15_000

/**
 * Which hub this is: a hash of the hub's own source files. A herald computes it from the same files
 * on disk and compares it with `/health`, so a hub still running older code (or something else
 * holding the port) is noticed rather than trusted (docs/reviews/review-2.md, finding 5). In the
 * npm package the hub and the herald are bundles side by side in one `dist/`, so there it is a hash
 * of those bundles: a new package version is a new build.
 */
export function hubBuild(dir = dirname(fileURLToPath(import.meta.url))): string {
  const hash = createHash("sha256")
  for (const file of list(dir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".js"))
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
  /** Chronicle writes that failed since start (the events were still numbered and sent). */
  writeFailures: number
  /** The last failed chronicle write, if any. */
  lastWriteError?: { at: string; guild: string; error: string }
  /** The GitHub watch: off, idle (no GitHub project yet), or polling with gh's token or without. */
  github: GithubMode | "off"
}

export function startHub(options: HubOptions = {}): Server<unknown> {
  const port = options.port ?? Number(process.env.GUILDHALL_PORT ?? HUB_PORT)
  const home = options.home ?? process.env.GUILDHALL_HOME ?? join(homedir(), ".cache", "guildhall")
  const keep = options.keep ?? 20_000
  const maxBuffered = options.maxBuffered ?? 16 * 1024 * 1024
  const started = new Date().toISOString()
  const build = hubBuild()
  const boot = started.replace(/[:.]/g, "-")
  const pruneEvery = options.pruneEvery ?? PRUNE_EVERY_MS
  const chronicles = join(home, "chronicles")
  pruneChronicles(chronicles)
  let pruned = Date.now()
  const events = loadHistory(chronicles, keep)
  const sea = loadSea(chronicles, SEA_KEEP)
  const projects = createProjects(join(home, "projects.json"))
  const halls = new Set<ServerWebSocket<unknown>>()
  const inOrder = serially()
  let writeFailures = 0
  let lastWriteError: Health["lastWriteError"]

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
      // /health says so instead.
      writeFailures++
      lastWriteError = { at: new Date().toISOString(), guild, error: String(error) }
      console.warn(`hub: could not write ${guild}'s chronicle: ${String(error)}`)
    }
    // Retention again, at most every `pruneEvery`: chronicles only grow when they are written to.
    if (Date.now() - pruned >= pruneEvery) {
      pruned = Date.now()
      pruneChronicles(chronicles)
    }
    return out
  }

  /**
   * A repo's sea events, for each guild whose project works in it: sent to the halls, kept for the
   * hello, written beside the guild's events.
   */
  async function recordSea(found: SeaEvent[]): Promise<void> {
    const active = projects.active(Date.now() - SEA_ACTIVE_MS)
    const records: SeaRecord[] = found.flatMap((event) =>
      [...new Set(active.filter((p) => p.github === event.repo).map((p) => p.guild))].map(
        (guild): SeaRecord => ({ v: 1, guild, event }),
      ),
    )
    if (records.length === 0) return
    broadcast({ type: "sea", events: records })
    for (const record of records) {
      const kept = sea.get(record.guild) ?? []
      kept.push(record)
      if (kept.length > SEA_KEEP) kept.splice(0, kept.length - SEA_KEEP)
      sea.set(record.guild, kept)
      try {
        const dir = chronicleDir(home, record.guild)
        await mkdir(dir, { recursive: true })
        await appendFile(join(dir, `${boot}.sea.jsonl`), `${JSON.stringify(record)}\n`)
      } catch (error) {
        writeFailures++
        lastWriteError = { at: new Date().toISOString(), guild: record.guild, error: String(error) }
      }
    }
  }

  const githubOptions =
    options.github === false || process.env.GUILDHALL_GITHUB === "0" ? undefined : (options.github ?? {})
  const github = githubOptions && createGithub(githubOptions)
  if (github) {
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      github
        .poll(seaTargets(projects.active(Date.now() - SEA_ACTIVE_MS)))
        .then(recordSea)
        .catch((error) => console.warn(`hub: GitHub watch failed: ${String(error)}`))
        .finally(() => {
          polling = false
        })
    }, githubOptions?.every ?? SEA_TICK_MS)
    timer.unref()
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
          writeFailures,
          ...(lastWriteError ? { lastWriteError } : {}),
          github: github?.mode() ?? "off",
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
        const now = Date.now()
        // With its project, a dispatch goes to that project's own guild (`app`, `app·2`, …).
        const guild = validProject(body.project) ? projects.claim(body.guild, body.project, now) : body.guild
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
      // The hall's files are no secret, but a page that rebinds its DNS name to 127.0.0.1 gets
      // nothing from this port under its own name either.
      if (options.hall && loopbackHost(request.headers.get("host"), server.port))
        return serveStatic(options.hall, request, url.pathname)
      return new Response("not found", { status: 404 })
    },
    websocket: {
      open(hall) {
        halls.add(hall)
        const recent = helloEvents(events)
        const guilds = new Set(recent.map((event) => event.guild))
        const records = [...sea].flatMap(([guild, kept]) => (guilds.has(guild) ? kept : []))
        hall.send(
          JSON.stringify({
            type: "hello",
            version: WIRE_VERSION,
            events: recent,
            ...(records.length > 0 ? { sea: records } : {}),
          } satisfies HubMessage),
        )
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

/** The repos the active projects work in, each with the branches they have checked out. */
export function seaTargets(active: readonly KnownProject[]): SeaTarget[] {
  const branches = new Map<string, Set<string>>()
  for (const project of active) {
    if (!project.github) continue
    const set = branches.get(project.github) ?? new Set()
    if (project.branch) set.add(project.branch)
    branches.set(project.github, set)
  }
  return [...branches].map(([repo, set]) => ({ repo, branches: [...set] }))
}

/**
 * A queue per key: each piece of work starts once the previous one for its key has settled. A key's
 * queue is forgotten once it runs empty, so guilds that went quiet don't stay in the map. `size` is
 * how many keys have work queued or running.
 */
export function serially(): (<T>(key: string, work: () => Promise<T>) => Promise<T>) & { size(): number } {
  const queues = new Map<string, Promise<unknown>>()
  const inOrder = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const run = (queues.get(key) ?? Promise.resolve()).then(work)
    const tail: Promise<void> = run.then(
      () => settled(),
      () => settled(),
    )
    const settled = () => {
      if (queues.get(key) === tail) queues.delete(key)
    }
    queues.set(key, tail)
    return run
  }
  return Object.assign(inOrder, { size: () => queues.size })
}

/**
 * The hello's events (see HELLO_GUILDS, HELLO_EVENTS): the most recently active guilds, each a
 * contiguous run of its newest events, the most recent guild last (a hall follows the last guild it
 * hears from).
 */
export function helloEvents(events: Map<string, GuildEvent[]>): GuildEvent[] {
  const last = (list: GuildEvent[]) => list.at(-1)?.change.at ?? 0
  const recent = [...events.values()]
    .filter((list) => list.length > 0)
    .sort((a, b) => last(b) - last(a))
    .slice(0, HELLO_GUILDS)
  const picked: GuildEvent[][] = []
  let budget = HELLO_EVENTS
  for (const list of recent) {
    if (budget <= 0) break
    const some = list.slice(-budget)
    budget -= some.length
    picked.unshift(some)
  }
  return picked.flat()
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
