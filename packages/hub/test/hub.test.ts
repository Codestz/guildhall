import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { HubMessage } from "../src/index.ts"
import { HERALD_HEADER, startHub } from "../src/index.ts"

const home = mkdtempSync(join(tmpdir(), "guildhall-hub-"))
const hub = startHub({ port: 0, home })
const base = `http://127.0.0.1:${hub.port}`
afterAll(() => hub.stop(true))

const dispatch = {
  guild: "demo",
  opencode: 2,
  changes: [{ type: "session", id: "ses_1", agent: "guild-master", title: "t", at: 1 }],
  raw: [{ type: "session.created" }],
}

describe("hub", () => {
  test("refuses a POST without the herald header (a web page can't forge events)", async () => {
    const response = await fetch(`${base}/events`, { method: "POST", body: JSON.stringify(dispatch) })
    expect(response.status).toBe(403)
  })

  test("numbers events, records a chronicle and the raw log", async () => {
    const response = await fetch(`${base}/events`, {
      method: "POST",
      headers: { [HERALD_HEADER]: "1" },
      body: JSON.stringify(dispatch),
    })
    expect(await response.json()).toEqual({ ok: true, count: 1 })
    const dir = join(home, "chronicles", "demo")
    const files = readdirSync(dir)
    const chronicle = files.find((f) => !f.includes(".raw."))
    expect(chronicle).toBeDefined()
    expect(JSON.parse(readFileSync(join(dir, chronicle ?? ""), "utf8").trim()).seq).toBe(1)
    expect(files.some((f) => f.endsWith(".raw.jsonl"))).toBe(true)
  })

  test("a hall that connects late gets everything so far, then live events", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    const messages: HubMessage[] = []
    socket.onmessage = (m) => messages.push(JSON.parse(String(m.data)))
    await new Promise((r) => socket.addEventListener("open", r))
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { [HERALD_HEADER]: "1" },
      body: JSON.stringify(dispatch),
    })
    await new Promise((r) => setTimeout(r, 100))
    socket.close()
    expect(messages[0]?.type).toBe("hello")
    expect(messages[0]?.type === "hello" && messages[0].events.length).toBe(1)
    expect(messages[1]?.type === "events" && messages[1].events[0]?.seq).toBe(2)
  })

  test("refuses a hall from a foreign origin", async () => {
    const response = await fetch(`${base}/ws`, { headers: { origin: "https://evil.example" } })
    expect(response.status).toBe(403)
  })
})
