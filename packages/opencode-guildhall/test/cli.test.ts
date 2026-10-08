import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { EVENTS } from "@guildhall/claude-code"
import { startHub } from "@guildhall/hub"

const src = join(import.meta.dir, "..", "src")

async function run(argv: string[], stdin?: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(["bun", ...argv], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  })
  const stdout = await new Response(child.stdout).text()
  return { stdout, code: await child.exited }
}

describe("opencode-guildhall claude-code --print", () => {
  test("prints only the hooks block: every translated event, running the hook beside the CLI", async () => {
    const { stdout, code } = await run([join(src, "cli.ts"), "claude-code", "--print"])
    expect(code).toBe(0)
    const { hooks } = JSON.parse(stdout)
    expect(Object.keys(hooks)).toEqual([...EVENTS])
    const command: string = hooks.Stop[0].hooks[0].command
    expect(command).toMatch(/^(bun|node) "/)
    expect(JSON.parse(command.slice(command.indexOf('"')))).toBe(join(src, "claude-code.js"))
  })

  test("anything else is usage, and fails", async () => {
    const { stdout, code } = await run([join(src, "cli.ts"), "claude-code"])
    expect(code).toBe(1)
    expect(stdout).toContain("claude-code --print")
  })
})

describe("the packaged hook", () => {
  const home = mkdtempSync(join(tmpdir(), "guildhall-package-hook-"))
  const hub = startHub({ port: 0, home })
  afterAll(() => hub.stop(true))

  test("takes a hook event on stdin to the hub, saying nothing", async () => {
    const event = {
      hook_event_name: "UserPromptSubmit",
      session_id: "package-hook",
      cwd: mkdtempSync(join(tmpdir(), "guildhall-package-hook-cwd-")),
      prompt: "hello",
    }
    const { stdout, code } = await run([join(src, "claude-code.ts")], JSON.stringify(event), {
      GUILDHALL_PORT: String(hub.port),
      GUILDHALL_HOME: home,
    })
    expect({ stdout, code }).toEqual({ stdout: "", code: 0 })
    const { guilds } = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json()
    expect(guilds).toEqual([basename(event.cwd)])
  })
})
