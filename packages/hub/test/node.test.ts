import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { HERALD_HEADER, type Health, type HubMessage } from "../src/index.ts"

/**
 * The hub on Node (serve-node.ts), as the npm package's `dist/hub.js` runs where there is no Bun: the
 * hub bundled for Node, run by `node`, asked what a herald and a hall ask.
 */

const node = Bun.which("node")
const dir = mkdtempSync(join(tmpdir(), "guildhall-node-hub-"))
const hall = join(dir, "hall")
const port = 20_000 + Math.floor(Math.random() * 20_000)
const base = `http://127.0.0.1:${port}`
let child: Subprocess | undefined

beforeAll(async () => {
  if (!node) return
  mkdirSync(join(hall, "assets"), { recursive: true })
  writeFileSync(join(hall, "index.html"), "<!doctype html><title>hall</title>")
  writeFileSync(join(hall, "assets", "kit.glb"), "glTF")
  const entry = join(dir, "entry.ts")
  writeFileSync(
    entry,
    `import { startHub } from ${JSON.stringify(join(import.meta.dir, "../src/index.ts"))}\n` +
      `startHub({ hall: ${JSON.stringify(hall)} })\n`,
  )
  const built = await Bun.build({ entrypoints: [entry], outdir: join(dir, "out"), target: "node" })
  if (!built.success) throw new Error("bundling the hub for Node failed")
  child = Bun.spawn([node, join(dir, "out", "entry.js")], {
    env: { ...process.env, GUILDHALL_PORT: String(port), GUILDHALL_HOME: dir, GUILDHALL_GITHUB: "0" },
    stdout: "ignore",
    stderr: "inherit",
  })
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`${base}/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return
    await Bun.sleep(50)
  }
  throw new Error("the hub never answered on Node")
}, 30_000)
afterAll(() => child?.kill())

const dispatch = {
  guild: "demo",
  changes: [{ type: "session", id: "ses_1", agent: "guild-master", title: "t", at: 1 }],
}

const post = (body: string, headers: Record<string, string> = { [HERALD_HEADER]: "1" }) =>
  fetch(`${base}/events`, { method: "POST", headers, body })

describe.skipIf(!node)("the hub on Node", () => {
  test("/health answers from the Node process", async () => {
    const health = (await (await fetch(`${base}/health`)).json()) as Health
    expect(health.ok).toBe(true)
    expect(health.pid).toBe(child?.pid as number)
  })

  test("takes a herald's dispatch and refuses one without the header", async () => {
    expect((await post(JSON.stringify(dispatch), {})).status).toBe(403)
    expect(await (await post(JSON.stringify(dispatch))).json()).toEqual({ ok: true, count: 1 })
  })

  test("refuses a body over the limit", async () => {
    expect((await post("x".repeat(17 * 1024 * 1024))).status).toBe(413)
  })

  test("a hall gets its hello, then live events, over WebSocket", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const messages: HubMessage[] = []
    socket.onmessage = (m) => messages.push(JSON.parse(String(m.data)))
    await new Promise((r) => socket.addEventListener("open", r))
    await post(JSON.stringify(dispatch))
    await Bun.sleep(100)
    socket.close()
    expect(messages[0]?.type).toBe("hello")
    expect(messages[0]?.type === "hello" && messages[0].events.length).toBeGreaterThan(0)
    expect(messages.at(-1)).toMatchObject({ type: "events", events: [{ guild: "demo" }] })
  })

  test("a page from another origin can't subscribe", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: "https://evil.example" } })
    const outcome = await new Promise((r) => {
      socket.onopen = () => r("open")
      socket.onerror = () => r("refused")
    })
    expect(outcome).toBe("refused")
  })

  test("serves the hall, typed, and nothing outside it", async () => {
    const page = await fetch(`${base}/`)
    expect(page.headers.get("content-type")).toStartWith("text/html")
    expect(await page.text()).toContain("<title>hall</title>")
    expect((await fetch(`${base}/assets/kit.glb`)).headers.get("content-type")).toBe("model/gltf-binary")
    expect((await fetch(`${base}/..%2fentry.ts`)).status).toBe(404)
  })
})
