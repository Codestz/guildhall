import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GuildEvent, SeaRecord } from "@guildhall/core"
import { HERALD_HEADER, type HubMessage, type HubOptions, startHub } from "../src/index.ts"
import { freeName } from "../src/projects.ts"
import { commit, fakeGithub, pull, run, sha } from "./fixtures/github.ts"

type Hub = ReturnType<typeof startHub>
const hubs: Hub[] = []
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.stop(true)
})

function hubAt(home: string, github: HubOptions["github"] = false): Hub {
  const hub = startHub({ port: 0, home, github })
  hubs.push(hub)
  return hub
}

const ID_A = "aaaaaaaaaaaaaaaa"
const ID_B = "bbbbbbbbbbbbbbbb"
const at = () => Date.now()

async function post(hub: Hub, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${hub.port}/events`, {
    method: "POST",
    headers: { [HERALD_HEADER]: "1" },
    body: JSON.stringify(body),
  })
}

const session = (id: string) => [{ type: "session", id, agent: "guild-master", at: at() }]

/** A hall: every message it gets, and a way to wait for one. */
function hall(hub: Hub) {
  const messages: HubMessage[] = []
  const texts: string[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
  ws.onmessage = (event) => {
    texts.push(String(event.data))
    messages.push(JSON.parse(String(event.data)))
  }
  const until = async (found: (messages: HubMessage[]) => boolean, ms = 5000) => {
    const end = Date.now() + ms
    while (!found(messages)) {
      if (Date.now() > end) throw new Error("timed out waiting for a hub message")
      await Bun.sleep(10)
    }
  }
  return { messages, texts, until, close: () => ws.close() }
}

async function helloGuilds(hub: Hub): Promise<string[]> {
  const h = hall(hub)
  await h.until((m) => m.length > 0)
  h.close()
  const hello = h.messages[0]
  return hello?.type === "hello" ? hello.events.map((e: GuildEvent) => e.guild) : []
}

describe("project identity at the hub", () => {
  test("two projects with one name are two guilds; the first heard keeps the plain name", async () => {
    const hub = hubAt(mkdtempSync(join(tmpdir(), "guildhall-projects-")))
    await post(hub, { guild: "app", changes: session("ses_a"), project: { id: ID_A } })
    await post(hub, { guild: "app", changes: session("ses_b"), project: { id: ID_B } })
    await post(hub, { guild: "app", changes: session("ses_a2"), project: { id: ID_A } })
    expect(new Set(await helloGuilds(hub))).toEqual(new Set(["app", "app·2"]))
  })

  test("a project keeps its guild across a hub restart, whoever is heard first", async () => {
    const home = mkdtempSync(join(tmpdir(), "guildhall-projects-"))
    const first = hubAt(home)
    await post(first, { guild: "app", changes: session("ses_a"), project: { id: ID_A } })
    await post(first, { guild: "app", changes: session("ses_b"), project: { id: ID_B } })
    first.stop(true)
    expect(existsSync(join(home, "projects.json"))).toBe(true)
    const second = hubAt(home)
    await post(second, { guild: "app", changes: session("ses_b2"), project: { id: ID_B } })
    const hello = hall(second)
    await hello.until((m) => m.length > 0)
    hello.close()
    const events = hello.messages[0]?.type === "hello" ? hello.messages[0].events : []
    expect(events.find((e) => e.change.id === "ses_b2")?.guild).toBe("app·2")
  })

  test("a dispatch without a project (an older adapter) keeps the guild it names", async () => {
    const hub = hubAt(mkdtempSync(join(tmpdir(), "guildhall-projects-")))
    await post(hub, { guild: "app", changes: session("ses_b"), project: { id: ID_B } })
    await post(hub, { guild: "app", changes: session("ses_old") })
    await post(hub, { guild: "legacy", changes: session("ses_l") })
    expect(new Set(await helloGuilds(hub))).toEqual(new Set(["app", "legacy"]))
  })

  test("a malformed project is ignored, not refused", async () => {
    const hub = hubAt(mkdtempSync(join(tmpdir(), "guildhall-projects-")))
    const response = await post(hub, {
      guild: "app",
      changes: session("ses_x"),
      project: { id: "../../etc", github: "https://user:tok@github.com/a/b" },
    })
    expect(await response.json()).toEqual({ ok: true, count: 1 })
    expect(await helloGuilds(hub)).toEqual(["app"])
  })

  test("names stay within a guild's length", () => {
    const long = "x".repeat(200)
    const name = freeName(long, new Set([long]))
    expect(name.length).toBe(200)
    expect(name.endsWith("·2")).toBe(true)
  })
})

describe("the sea at the hub", () => {
  const TOKEN = `ghp_${crypto.randomUUID().replaceAll("-", "")}`

  test("GitHub news reaches the halls as `sea`, goes in the chronicle and the next hello, and the token goes nowhere but api.github.com", async () => {
    const logs: string[] = []
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((method) =>
      spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "))
      }),
    )
    try {
      const home = mkdtempSync(join(tmpdir(), "guildhall-sea-"))
      const github = fakeGithub("acme/shop", Date.now())
      const hub = hubAt(home, { fetch: github.fetch, token: async () => TOKEN, every: 20, interval: 40 })
      const watcher = hall(hub)
      await watcher.until((m) => m.length > 0)
      await post(hub, {
        guild: "shop",
        changes: session("ses_1"),
        project: { id: ID_A, github: "acme/shop", branch: "main" },
      })
      // A second clone of the same repo: its own guild, the same sea.
      await post(hub, {
        guild: "shop",
        changes: session("ses_2"),
        project: { id: ID_B, github: "acme/shop", branch: "main" },
      })
      // The baseline poll, then news.
      const health = async () => (await (await fetch(`http://127.0.0.1:${hub.port}/health`)).text()) as string
      const end = Date.now() + 5000
      while (!(await health()).includes('"github":"token"')) {
        if (Date.now() > end) throw new Error("the GitHub watch never polled")
        await Bun.sleep(10)
      }
      await Bun.sleep(100)
      const now = Date.now()
      github.state.commits = [commit(2, new Date(now).toISOString(), "mona"), ...github.state.commits]
      github.state.runs.set(sha(2), [run(21, sha(2), "completed", "failure", new Date(now).toISOString())])
      github.state.pulls = [pull(5, new Date(now).toISOString()), ...github.state.pulls]
      await watcher.until((m) =>
        m.some((x) => x.type === "sea" && x.events.some((r) => r.event.kind === "ci")),
      )

      const sea = watcher.messages.flatMap((m) => (m.type === "sea" ? m.events : []))
      expect(new Set(sea.map((r) => r.guild))).toEqual(new Set(["shop", "shop·2"]))
      expect(new Set(sea.map((r) => r.event.kind))).toEqual(new Set(["push", "ci", "pr_opened"]))

      const later = hall(hub)
      await later.until((m) => m.length > 0)
      later.close()
      const hello = later.messages[0]
      const records: SeaRecord[] = hello?.type === "hello" ? (hello.sea ?? []) : []
      expect(records.length).toBe(sea.length)

      // A 401 along the way: logged, and the token must not be in the log.
      github.state.status = 401
      await Bun.sleep(300)
      watcher.close()

      // The token was sent, and only to api.github.com, only as the Authorization header.
      const authorized = github.calls.filter((call) => call.headers.authorization === `Bearer ${TOKEN}`)
      expect(authorized.length).toBeGreaterThan(0)
      for (const call of github.calls) {
        expect(new URL(call.url).origin).toBe("https://api.github.com")
        expect(call.url).not.toContain(TOKEN)
        const { authorization: _, ...rest } = call.headers
        expect(JSON.stringify(rest)).not.toContain(TOKEN)
      }
      // ...and nowhere else: not to a hall, not in /health, not on disk, not in a log.
      expect(watcher.texts.join("\n")).not.toContain(TOKEN)
      expect(later.texts.join("\n")).not.toContain(TOKEN)
      expect(await health()).not.toContain(TOKEN)
      const written = files(home).map((file) => readFileSync(file, "utf8"))
      expect(written.some((text) => text.includes("pr_opened"))).toBe(true)
      for (const text of written) expect(text).not.toContain(TOKEN)
      expect(logs.some((line) => line.includes("401"))).toBe(true)
      for (const line of logs) expect(line).not.toContain(TOKEN)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  test("off with `github: false`: /health says so", async () => {
    const hub = hubAt(mkdtempSync(join(tmpdir(), "guildhall-sea-")))
    const health = (await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json()) as { github: string }
    expect(health.github).toBe("off")
  })
})

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
