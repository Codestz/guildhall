import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startHub } from "@guildhall/hub"
import { createCourier } from "../src/courier.ts"

const change = { type: "status", id: "ses_1", status: "busy", at: 1 } as const

describe("courier", () => {
  const port = 4900 + Math.floor(Math.random() * 90)
  let hub: ReturnType<typeof startHub> | undefined
  afterAll(() => hub?.stop(true))

  test("a batch sent while the hub is down is kept and delivered once it is up", async () => {
    const logs: string[] = []
    // Bun.which("bun") would start a real hub on the default port; point PATH away for this test.
    const path = process.env.PATH
    process.env.PATH = ""
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port })
    courier.send([change], { raw: 1 })
    await new Promise((r) => setTimeout(r, 300))
    process.env.PATH = path
    hub = startHub({ port, home: mkdtempSync(join(tmpdir(), "guildhall-courier-")) })
    await new Promise((r) => setTimeout(r, 1500))
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { guilds: string[] }
    expect(health.guilds).toEqual(["t"])
    expect(logs.some((m) => m.includes("reachable again"))).toBe(true)
  })
})
