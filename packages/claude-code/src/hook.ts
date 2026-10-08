import { spawn } from "node:child_process"
import { mkdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { guildOf, projectRefOf } from "./project.ts"
import { translate } from "./translate.ts"

/**
 * `bun packages/claude-code/src/hook.ts` — the command Claude Code runs on each hook event (see
 * `install.ts --print`). Reads the event's JSON from stdin, translates it, and POSTs one dispatch to
 * the hub.
 *
 * Claude Code waits for a hook before it goes on, so this must be quick and must never get in the
 * way: it prints nothing (stdout is read as hook output, and on some events added to Claude's
 * context), always exits 0 (2 would block the tool call or the prompt), and gives the hub
 * TIMEOUT_MS to answer. A hub that isn't there is started for next time; this event is let go.
 */

/** The hub's port and header (packages/hub/src/protocol.ts), spelled here so a hook loads no hub code. */
const HUB_PORT = 4747
const HERALD_HEADER = "x-guildhall-herald"
/** A local hub answers in a few ms; one that takes the connection and hangs must not hold Claude Code. */
const TIMEOUT_MS = 200
/** A hub start is tried at most this often, across every hook process (a stamp file says when). */
const START_EVERY_MS = 30_000

const home = process.env.GUILDHALL_HOME ?? join(homedir(), ".cache", "guildhall")

export async function run(text: string): Promise<void> {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return
  }
  const changes = translate(payload, Date.now())
  if (changes.length === 0) return
  const cwd = (payload as { cwd?: unknown }).cwd
  const dir = typeof cwd === "string" && cwd ? cwd : process.cwd()
  const guild = guildOf(dir)
  // The project (PROTOCOL.md §3.1): the hub gives it its own guild (`app`, `app·2`), as for OpenCode.
  const project = projectRefOf(dir)
  const port = Number(process.env.GUILDHALL_PORT ?? HUB_PORT)
  try {
    await fetch(`http://127.0.0.1:${port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", [HERALD_HEADER]: "1" },
      body: JSON.stringify({ guild, changes, project }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // Nothing listening: start a hub for the events to come. A hub that hangs holds the port already.
    if ((error as Error)?.name !== "TimeoutError") startHub()
  }
}

/** The script that runs the hub: its source in this repo; the npm package points it at its bundle. */
let hubEntry = new URL("../../hub/src/main.ts", import.meta.url).pathname

/** Where `startHub` finds the hub's entry script (the npm package's `dist/hub.js`). */
export function setHubEntry(path: string): void {
  hubEntry = path
}

/**
 * Starts the hub as a detached process, unless one was started recently. The hub runs on Bun, found
 * on PATH: the hook itself may run on Node (the npm package's bundle), which can't run the hub.
 */
function startHub(): void {
  const stamp = join(home, "claude-code.hub-start")
  try {
    if (Date.now() - statSync(stamp).mtimeMs < START_EVERY_MS) return
  } catch {
    // No stamp yet: never started from here.
  }
  try {
    mkdirSync(home, { recursive: true })
    writeFileSync(stamp, new Date().toISOString())
    const child = spawn("bun", [hubEntry], { detached: true, stdio: "ignore" })
    // No Bun on PATH arrives as an `error` event, after this returns; unhandled, it would throw.
    child.on("error", () => {})
    child.unref()
  } catch {
    // The hook must never fail Claude Code; the hub can be started by hand.
  }
}

/** The hook as a process: the event from stdin, then exit 0 whatever happened. Node or Bun. */
export async function main(): Promise<never> {
  try {
    let text = ""
    process.stdin.setEncoding("utf8")
    for await (const chunk of process.stdin) text += chunk
    await run(text)
  } catch {
    // Never throw into Claude Code.
  }
  process.exit(0)
}

if (import.meta.main) await main()
