/**
 * The probe server's command line (scripts/probe-server.ts): a warm browser on the running hall,
 * ~1 s a shot. Any command starts the server first if it isn't up (in the background, once).
 *
 *   bun scripts/probe.ts start [--dpr 1] [--url http://localhost:5199/]
 *   bun scripts/probe.ts stop
 *   bun scripts/probe.ts health
 *   bun scripts/probe.ts shot <name> [--state 'story=saga&t=11:53&hour=23&look=quarry&hud=off']
 *                                    [--lab 'character&model=mage&clip=Walking_A'] [--settle ms] [--keep] [--png]
 *   bun scripts/probe.ts state 'story=rush&t=0:40&select=Implementer'   [--keep] [--settle ms]
 *   bun scripts/probe.ts look quarry | graveyard | 12,-40
 *   bun scripts/probe.ts eval 'guild.views.length' [--lab …]
 *   bun scripts/probe.ts steps file.json [--lab …]   (shot.ts's steps; plus { "state": "…" })
 *   bun scripts/probe.ts reload
 *
 * Shots land in .probe/<name>.jpg (`--png`: lossless .png, ~4× slower to encode). A `--state` loads
 * the page afresh at that link (~1 s more): the same picture as a cold load of it, whatever was
 * shot before. `--keep` applies it in place on top of the current state instead (faster, but
 * history carries over: the story, crowd, weather easing, walkers). The deep-link params:
 * packages/hall/src/guild/deeplink.ts.
 */
import { closeSync, openSync } from "node:fs"
import { INFO_PATH, PROBE_DIR, ROOT } from "./steps.ts"

interface Info {
  port: number
  pid: number
  url: string
  dpr: number
}

async function info(): Promise<Info | undefined> {
  const file = Bun.file(INFO_PATH)
  return (await file.exists()) ? ((await file.json()) as Info) : undefined
}

async function up(port: number, wait = 60_000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(wait) })
    return response.ok
  } catch {
    return false
  }
}

/** The running server's port; starts one (detached, logging to .probe/probe-server.log) if none. */
export async function ensureServer(extra: string[] = []): Promise<number> {
  const known = await info()
  if (known && (await up(known.port))) return known.port
  const log = openSync(`${PROBE_DIR}/probe-server.log`, "a")
  const child = Bun.spawn(["bun", `${ROOT}scripts/probe-server.ts`, ...extra], {
    cwd: ROOT,
    stdio: ["ignore", log, log],
    detached: true,
  })
  child.unref()
  closeSync(log)
  process.stderr.write("starting the probe server (one cold load)…")
  const until = Date.now() + 90_000
  while (Date.now() < until) {
    await Bun.sleep(400)
    const now = await info()
    if (now && (await up(now.port))) {
      process.stderr.write(" warm\n")
      return now.port
    }
    if (child.exitCode !== null) break
  }
  throw new Error("the probe server did not start: see .probe/probe-server.log")
}

/** POSTs a command to the server; throws on its error. */
export async function call(port: number, path: string, body: object = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const out = (await response.json()) as Record<string, unknown>
  if (!response.ok) throw new Error(String(out.error ?? response.status))
  return out
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv
  const settle = flag(args, "settle")
  const lab = flag(args, "lab")
  const fresh = !args.includes("--keep")
  const opts = { ...(settle ? { settle: Number(settle) } : {}), ...(lab !== undefined ? { lab } : {}) }
  const print = (out: Record<string, unknown>) => {
    const { errors, ...rest } = out
    console.log(JSON.stringify(rest))
    if (Array.isArray(errors) && errors.length) console.log(`page errors: ${JSON.stringify(errors)}`)
  }
  switch (command) {
    case "start": {
      const extra = ["dpr", "url", "port"].flatMap((name) => {
        const value = flag(args, name)
        return value ? [`--${name}`, value] : []
      })
      const port = await ensureServer(extra)
      print(await call(port, "/health"))
      return
    }
    case "stop": {
      const known = await info()
      if (!known || !(await up(known.port))) return console.log("not running")
      await call(known.port, "/stop")
      // Gone only when it no longer answers: a `start` right after must not find the old one.
      while (await up(known.port, 300)) await Bun.sleep(100)
      return console.log("stopped")
    }
    case "health":
      return print(await call(await ensureServer(), "/health"))
    case "shot": {
      const name = args[0]
      if (!name || name.startsWith("--")) throw new Error("shot <name> [--state q] [--lab q]")
      const state = flag(args, "state")
      const png = args.includes("--png")
      return print(
        await call(await ensureServer(), "/shot", { name, fresh, png, ...opts, ...(state ? { state } : {}) }),
      )
    }
    case "state":
      return print(await call(await ensureServer(), "/state", { query: args[0] ?? "", fresh, ...opts }))
    case "look":
      return print(await call(await ensureServer(), "/look", { at: args[0] ?? "", ...opts }))
    case "eval":
      return print(await call(await ensureServer(), "/eval", { js: args[0] ?? "", ...opts }))
    case "steps": {
      const file = args[0]
      if (!file) throw new Error("steps <file.json>")
      return print(
        await call(await ensureServer(), "/steps", { steps: await Bun.file(file).json(), ...opts }),
      )
    }
    case "reload":
      return print(await call(await ensureServer(), "/reload", { query: args[0] ?? "" }))
    default:
      console.log(
        "bun scripts/probe.ts start|stop|health|shot|state|look|eval|steps|reload  (see the header)",
      )
  }
}

if (import.meta.main)
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
