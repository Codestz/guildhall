import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GuildEvent } from "@guildhall/core"
import { projectId } from "@guildhall/core/project"
import { type HubMessage, startHub } from "@guildhall/hub"
import { EVENTS, settings } from "../src/install.ts"
import { guildOf } from "../src/project.ts"
import { translate } from "../src/translate.ts"
import failures from "./fixtures/failures.json"
import session from "./fixtures/session.json"
import subagents from "./fixtures/subagents.json"

const HOOK = join(import.meta.dir, "../src/hook.ts")
const NODE = Bun.which("node")
const home = mkdtempSync(join(tmpdir(), "guildhall-claude-code-"))
const hub = startHub({ port: 0, home })
afterAll(() => hub.stop(true))

/** Runs the hook as Claude Code does: a process per event, the payload on stdin. */
async function hook(
  payload: string,
  port: number | undefined = hub.port,
  hubHome = home,
  command = ["bun", HOOK],
) {
  const child = Bun.spawn(command, {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GUILDHALL_PORT: String(port), GUILDHALL_HOME: hubHome },
  })
  const [stdout, code] = [await new Response(child.stdout).text(), await child.exited]
  return { stdout, code }
}

/** Everything the hub holds, as a hall's hello gets it. */
async function hello(): Promise<GuildEvent[]> {
  const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
  const message = await new Promise<HubMessage>((resolve, reject) => {
    ws.onmessage = (event) => resolve(JSON.parse(String(event.data)))
    ws.onerror = reject
  })
  ws.close()
  return message.type === "hello" ? message.events : []
}

describe("the hook", () => {
  test("every fixture event reaches the hub, and the hub takes every change", async () => {
    const events = [...session.events, ...subagents.events, ...failures.events]
    for (const event of events) {
      const { stdout, code } = await hook(JSON.stringify(event))
      expect(stdout).toBe("")
      expect(code).toBe(0)
    }
    const expected = events.flatMap((event) => translate(event, Date.now())).length
    const got = (await hello()).filter((event) => event.guild === "shop")
    // The hub drops any change its validator refuses: none may be missing.
    expect(got).toHaveLength(expected)
  }, 30_000)

  test("with no hub listening it still exits 0 at once, saying nothing", async () => {
    const quiet = mkdtempSync(join(tmpdir(), "guildhall-claude-code-down-"))
    // A hub was "just started": the hook must not start a real one from a test.
    writeFileSync(join(quiet, "claude-code.hub-start"), "now")
    const free = Bun.serve({ port: 0, fetch: () => new Response() })
    const port = free.port
    free.stop(true)
    const started = performance.now()
    const { stdout, code } = await hook(JSON.stringify(session.events[1]), port, quiet)
    expect(code).toBe(0)
    expect(stdout).toBe("")
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test("a hub that takes the connection and never answers is let go, and no hub is started", async () => {
    const quiet = mkdtempSync(join(tmpdir(), "guildhall-claude-code-hang-"))
    const listener = createServer(() => {
      // Never answers.
    }).listen(0, "127.0.0.1")
    await new Promise((resolve) => listener.once("listening", resolve))
    const { port } = listener.address() as AddressInfo
    try {
      const started = performance.now()
      const { stdout, code } = await hook(JSON.stringify(session.events[1]), port, quiet)
      expect({ stdout, code }).toEqual({ stdout: "", code: 0 })
      expect(performance.now() - started).toBeLessThan(2000)
    } finally {
      listener.close()
    }
    // Something holds the port: starting a hub there could only fail.
    expect(existsSync(join(quiet, "claude-code.hub-start"))).toBe(false)
  })

  test.skipIf(!NODE)("bundled for Node and run by Node, as the npm package's hook is", async () => {
    const out = mkdtempSync(join(tmpdir(), "guildhall-claude-code-node-"))
    const built = await Bun.build({ entrypoints: [HOOK], outdir: out, target: "node" })
    expect(built.success).toBe(true)
    const event = { ...session.events[1], cwd: join(out, "nodeguild") }
    const { stdout, code } = await hook(JSON.stringify(event), hub.port, home, [
      NODE as string,
      join(out, "hook.js"),
    ])
    expect({ stdout, code }).toEqual({ stdout: "", code: 0 })
    expect((await hello()).some((e) => e.guild === "nodeguild")).toBe(true)
  })

  test("the dispatch carries the project, so the hub can tell two `app`s apart", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "guildhall-claude-code-project-")), "app")
    mkdirSync(join(root, ".git"), { recursive: true })
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(
      join(root, ".git", "config"),
      '[remote "origin"]\n\turl = https://github.com/acme/app.git\n',
    )
    let body: unknown
    const listener = Bun.serve({
      port: 0,
      fetch: async (request) => {
        body = await request.json()
        return new Response()
      },
    })
    try {
      await hook(JSON.stringify({ ...session.events[1], cwd: join(root) }), listener.port)
    } finally {
      listener.stop(true)
    }
    expect(body).toMatchObject({
      guild: "app",
      project: { id: projectId(root), github: "acme/app", branch: "main" },
    })
  })

  test("garbage on stdin exits 0, saying nothing", async () => {
    expect(await hook("not json{")).toEqual({ stdout: "", code: 0 })
    expect(await hook("")).toEqual({ stdout: "", code: 0 })
  })
})

describe("the guild", () => {
  test("is the git root's name, from anywhere under it", () => {
    const root = join(mkdtempSync(join(tmpdir(), "guildhall-repo-")), "shop")
    mkdirSync(join(root, ".git"), { recursive: true })
    mkdirSync(join(root, "src", "cart"), { recursive: true })
    expect(guildOf(join(root, "src", "cart"))).toBe("shop")
    expect(guildOf(root)).toBe("shop")
  })

  test("is the directory's own name outside git", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "guildhall-nogit-")), "scratch")
    mkdirSync(dir)
    expect(guildOf(dir)).toBe("scratch")
  })
})

describe("install --print", () => {
  test("registers the hook on every event it translates, and points at it", () => {
    const { hooks } = settings()
    expect(Object.keys(hooks)).toEqual([...EVENTS])
    const command = hooks.Stop?.[0]?.hooks[0]?.command ?? ""
    const path = JSON.parse(command.slice(command.indexOf('"')))
    expect(existsSync(path)).toBe(true)
  })

  test("prints JSON and writes nothing", async () => {
    const child = Bun.spawn(["bun", join(import.meta.dir, "../src/install.ts"), "--print"], {
      stdout: "pipe",
    })
    const printed = JSON.parse(await new Response(child.stdout).text())
    expect(await child.exited).toBe(0)
    expect(printed).toEqual(JSON.parse(JSON.stringify(settings())))
  })
})
