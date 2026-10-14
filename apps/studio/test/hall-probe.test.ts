/**
 * The hall's live default (hall/feeds/probe.ts): on localhost, a repo's hall with no `?feed=` opens the
 * live feed when the hub says hello with a guild of that repo within ~600 ms; otherwise (no hub, a hub of
 * other repos, a hub that stays silent, a link that names its feed, any host off this machine) it stays
 * on its history, and off localhost it never even opens a socket. A mock hub stands in.
 */
import { describe, expect, test } from "bun:test"
import type { GuildEvent } from "@guildhall/core"
import type { SocketLike } from "../src/hall/feeds/live.ts"
import { autoFeed, isLocalHost, PROBE_MS, type ProbeOptions, probeHub } from "../src/hall/feeds/probe.ts"
import { guildMatcher } from "../src/hall/feeds/wire.ts"

class MockSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  close() {
    this.closed = true
  }
  hello(guilds: string[]) {
    const events = guilds.map((guild, i) => ({
      v: 1,
      guild,
      seq: i + 1,
      change: { type: "session", id: `ses_${guild}`, agent: "build", at: 1 },
    })) as unknown as GuildEvent[]
    this.onmessage?.({ data: JSON.stringify({ type: "hello", events, sea: [] }) })
  }
}

/** Timers that run only when told. */
function fakeTimers() {
  const due: { at: number; fn: () => void; id: number }[] = []
  let now = 0
  let id = 0
  return {
    setTimer: (fn: () => void, ms: number) => {
      due.push({ at: now + ms, fn, id: ++id })
      return id
    },
    clearTimer: (t: unknown) => {
      const i = due.findIndex((d) => d.id === t)
      if (i >= 0) due.splice(i, 1)
    },
    advance(ms: number) {
      now += ms
      for (const d of due.filter((x) => x.at <= now)) {
        due.splice(due.indexOf(d), 1)
        d.fn()
      }
    },
    pending: () => due.length,
  }
}

function hub(then: (s: MockSocket) => void) {
  const sockets: MockSocket[] = []
  const timers = fakeTimers()
  const probe = (opts: ProbeOptions) =>
    probeHub({
      ...opts,
      ...timers,
      socket: (url) => {
        const s = new MockSocket(url)
        sockets.push(s)
        queueMicrotask(() => then(s))
        return s
      },
    })
  return { probe, sockets, timers }
}

const q = (s = "") => new URLSearchParams(s)

describe("isLocalHost", () => {
  test("only this machine", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST", "hall.localhost"])
      expect(isLocalHost(h)).toBe(true)
    for (const h of ["guildhall.codestz.dev", "localhost.evil.com", "192.168.1.5", "example.com"])
      expect(isLocalHost(h)).toBe(false)
  })
})

describe("probeHub", () => {
  const guild = guildMatcher("guildhall")

  test("a hello with a guild of the repo answers yes, and the socket is closed", async () => {
    const { probe, sockets } = hub((s) => s.hello(["other", "guildhall·2"]))
    expect(await probe({ guild })).toBe(true)
    expect((sockets[0] as MockSocket).closed).toBe(true)
    expect((sockets[0] as MockSocket).url).toBe("ws://127.0.0.1:4747/ws")
  })

  test("a hello without the repo's guild answers no", async () => {
    const { probe } = hub((s) => s.hello(["guildhall-site", "codestz"]))
    expect(await probe({ guild })).toBe(false)
  })

  test("a hub that stays silent is given PROBE_MS, then no", async () => {
    const { probe, timers, sockets } = hub(() => {})
    let answer: boolean | undefined
    const p = probe({ guild }).then((a) => {
      answer = a
    })
    await Promise.resolve()
    timers.advance(PROBE_MS - 1)
    await Promise.resolve()
    expect(answer).toBeUndefined()
    timers.advance(1)
    await p
    expect(answer).toBe(false)
    expect((sockets[0] as MockSocket).closed).toBe(true)
    expect(timers.pending()).toBe(0)
  })

  test("a refused connection (error or close) answers no at once; a throwing socket too", async () => {
    expect(await hub((s) => s.onerror?.({})).probe({ guild })).toBe(false)
    expect(await hub((s) => s.onclose?.({})).probe({ guild })).toBe(false)
    const throwing = await probeHub({
      guild,
      socket: () => {
        throw new Error("blocked")
      },
    })
    expect(throwing).toBe(false)
  })

  test("noise before the hello is ignored", async () => {
    const { probe } = hub((s) => {
      s.onmessage?.({ data: "not json" })
      s.onmessage?.({ data: JSON.stringify({ type: "events", events: [] }) })
      s.hello(["guildhall"])
    })
    expect(await probe({ guild })).toBe(true)
  })
})

describe("autoFeed: the rule", () => {
  const yes = (s: MockSocket) => s.hello(["guildhall"])

  test("localhost, no ?feed=, the hub has the repo: live", async () => {
    const { probe } = hub(yes)
    expect(await autoFeed(q(), "Codestz/guildhall", { hostname: "localhost", probe })).toBe("live")
    expect(await autoFeed(q(), "Codestz/guildhall", { hostname: "127.0.0.1", probe })).toBe("live")
  })

  test("localhost, the hub has no guild for this repo: history", async () => {
    const { probe } = hub(yes)
    expect(await autoFeed(q(), "facebook/react", { hostname: "localhost", probe })).toBeNull()
  })

  test("localhost, no hub: history", async () => {
    const { probe } = hub((s) => s.onerror?.({}))
    expect(await autoFeed(q(), "Codestz/guildhall", { hostname: "localhost", probe })).toBeNull()
  })

  test("a link that names a feed (even replay, even an unknown one) is left alone, no probe", async () => {
    const { probe, sockets } = hub(yes)
    for (const feed of ["replay", "story", "live", "nonsense"])
      expect(
        await autoFeed(q(`feed=${feed}`), "Codestz/guildhall", { hostname: "localhost", probe }),
      ).toBeNull()
    expect(sockets).toHaveLength(0)
  })

  test("off localhost it never probes", async () => {
    const { probe, sockets } = hub(yes)
    for (const hostname of ["guildhall.codestz.dev", "localhost.evil.com", "192.168.0.2"])
      expect(await autoFeed(q(), "Codestz/guildhall", { hostname, probe })).toBeNull()
    expect(sockets).toHaveLength(0)
  })

  test("?guild= is matched exactly and ?hub= stays on this machine", async () => {
    const seen: string[] = []
    const probe = async (o: ProbeOptions) => {
      seen.push(o.url ?? "")
      return o.guild("guildhall·2") && !o.guild("guildhall")
    }
    expect(
      await autoFeed(q("guild=guildhall·2&hub=ws://localhost:9000/ws"), "Codestz/guildhall", {
        hostname: "localhost",
        probe,
      }),
    ).toBe("live")
    expect(
      await autoFeed(q("hub=ws://evil.example/ws"), "Codestz/guildhall", { hostname: "localhost", probe }),
    ).toBeNull()
    expect(seen).toEqual(["ws://localhost:9000/ws", "ws://127.0.0.1:4747/ws"])
  })

  test("a probe that throws is history", async () => {
    const probe = () => Promise.reject(new Error("boom"))
    expect(await autoFeed(q(), "Codestz/guildhall", { hostname: "localhost", probe })).toBeNull()
  })
})
