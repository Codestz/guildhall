import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { save, saveMounts } from "../src/data.ts"
import { isLocalHost, READ_ONLY_NOTICE, viewOnly } from "../src/env.ts"
import { jumpable } from "../src/shell/directory.ts"
import { resolve } from "../src/shell/router.ts"
import { liveStories } from "../src/site/chronicle.ts"
import {
  hallSeed,
  hallSlug,
  isSiteScreen,
  mountKey,
  openedStory,
  storyHref,
  worldKey,
  worldQuery,
} from "../src/site/routes.ts"
import { STORIES } from "../src/site/stories.ts"

const q = (s: string) => new URLSearchParams(s)
const at = (url: string) => {
  const u = new URL(url, "http://x")
  const r = resolve(u.pathname, u.search, "/")
  return { screen: r.screen as string, query: r.query, url }
}

describe("site routes", () => {
  test("the site's four screens are the site; the Studio's are not", () => {
    for (const id of ["island", "demos", "built", "hall"]) expect(isSiteScreen(id)).toBe(true)
    for (const id of ["home", "pieces", "town", "sitelab"]) expect(isSiteScreen(id)).toBe(false)
    expect(isSiteScreen(null)).toBe(false)
  })

  test("/, /demos and a bare /hall keep one island: moving between them does not remount", () => {
    const keys = ["/", "/demos", "/hall", "/?story=saga&act=3"].map((u) => {
      const { screen, query, url } = at(u)
      return mountKey(screen, query, url)
    })
    expect(new Set(keys).size).toBe(1)
  })

  test("a repo's hall, a changed map and a section change do remount", () => {
    const key = (u: string) => {
      const { screen, query, url } = at(u)
      return mountKey(screen, query, url)
    }
    expect(key("/hall/facebook/react")).not.toBe(key("/"))
    expect(key("/hall/facebook/react")).toBe(key("/hall/Facebook/React"))
    expect(key("/hall/facebook/react")).not.toBe(key("/hall/vitejs/vite"))
    expect(key("/?seed=4")).not.toBe(key("/"))
    expect(key("/built")).toBe("built")
    // a Studio screen remounts on any URL change
    expect(key("/pieces?q=a")).not.toBe(key("/pieces?q=b"))
  })

  test("a repo's slug is read from the path and must be a GitHub owner/repo", () => {
    expect(hallSlug(q("repo=facebook/react"))).toBe("facebook/react")
    expect(hallSlug(q("repo=vitejs/vite.git"))).toBe("vitejs/vite")
    expect(hallSlug(q("repo=-bad-/x"))).toBeNull()
    expect(hallSlug(q(""))).toBeNull()
  })

  test("a repo's seed is stable, case-blind and in range", () => {
    expect(hallSeed("facebook/react")).toBe(hallSeed("Facebook/React"))
    expect(hallSeed("facebook/react")).not.toBe(hallSeed("facebook/relay"))
    for (const slug of ["a/b", "facebook/react", "Codestz/mcpx", "x/y.z"]) {
      const s = hallSeed(slug)
      expect(s).toBeGreaterThanOrEqual(1)
      expect(s).toBeLessThanOrEqual(9000)
    }
  })

  test("the world is built from the repo's seed unless the link names one", () => {
    const hall = worldQuery("hall", q("repo=facebook/react&hour=9"))
    expect(hall.get("seed")).toBe(String(hallSeed("facebook/react")))
    expect(hall.get("hour")).toBe("9")
    expect(hall.has("repo")).toBe(false)
    expect(worldQuery("hall", q("repo=facebook/react&seed=7")).get("seed")).toBe("7")
    const home = worldQuery("island", q("story=saga&act=2"))
    expect([...home.keys()]).toEqual([])
    expect(worldKey("island", q("story=saga"))).toBe(worldKey("demos", q("")))
  })

  test("a story opens on the island with its act; a repo story opens the repo's hall", () => {
    const saga = STORIES.find((s) => s.id === "saga")
    expect(saga && storyHref(saga.link)).toBe("/?story=saga")
    expect(saga && storyHref(saga.link, 3)).toBe("/?story=saga&act=3")
    const react = STORIES.find((s) => s.id === "react")
    expect(react && storyHref(react.link)).toBe("/hall/facebook/react")
    const night = STORIES.find((s) => s.id === "night")
    expect(night && storyHref(night.link)).toBe("/?hour=22&weather=storm")
  })

  test("?story= names a story, and an act only when the story has it", () => {
    expect(openedStory(q("story=saga&act=2"), STORIES)?.act).toBe(2)
    expect(openedStory(q("story=saga&act=9"), STORIES)?.act).toBeUndefined()
    expect(openedStory(q("story=party&act=2"), STORIES)?.act).toBeUndefined()
    expect(openedStory(q("story=nope"), STORIES)).toBeNull()
    expect(openedStory(q(""), STORIES)).toBeNull()
  })

  test("the palette lists the site's places before the Studio's tools", () => {
    const ids = jumpable().map((p) => p.tool.id)
    expect(ids.slice(0, 4)).toEqual(["island", "hall", "demos", "built"])
    expect(ids).toContain("home")
    expect(ids).toContain("pieces")
  })
})

describe("the view-only gate", () => {
  test("only the machine's own addresses are local", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "[::1]", "::1", "guildhall.localhost"])
      expect(isLocalHost(h)).toBe(true)
    for (const h of [
      "guildhall.dev",
      "x.trycloudflare.com",
      "192.168.1.5",
      "localhost.evil.com",
      "127.0.0.1.nip.io",
    ])
      expect(isLocalHost(h)).toBe(false)
  })

  test("off localhost, or in the showcase build, the page is read-only; a test with no host is local", () => {
    expect(viewOnly(false, "localhost")).toBe(false)
    expect(viewOnly(false, undefined)).toBe(false)
    expect(viewOnly(false, "guildhall.dev")).toBe(true)
    expect(viewOnly(true, "localhost")).toBe(true)
  })

  test("on localhost a save reaches the server; read-only, it is a no-op that touches nothing", async () => {
    const calls: string[] = []
    const fetcher = async (url: string, init?: { method: string }) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      return { ok: true, status: 200, json: async () => ({}) } as never
    }
    expect((await save("npcs", "guard", {}, fetcher as never, "/data", false)).ok).toBe(true)
    expect(calls).toEqual(["PUT /data/npcs/guard.json"])
    calls.length = 0
    expect((await save("npcs", "guard", {}, fetcher as never, "/data", true)).ok).toBe(true)
    expect((await saveMounts({} as never, fetcher as never, "/data", true)).ok).toBe(true)
    expect(calls).toEqual([])
  })

  test("the top bar shows the read-only notice when the page is read-only", () => {
    expect(READ_ONLY_NOTICE).toBe("Read-only: explore freely, nothing is saved")
    const bar = readFileSync(join(import.meta.dir, "../src/shell/TopBar.tsx"), "utf8")
    expect(bar).toMatch(/\{READ_ONLY && \(/)
    expect(bar).toContain("READ_ONLY_NOTICE")
  })
})

describe("live chronicles in the demo picker", () => {
  test("each catalog repo is a card on its own shelf that opens its hall", () => {
    const cards = liveStories({
      v: 1,
      updated: "2026-10-13",
      repos: [
        {
          repo: "react/react",
          languages: ["JavaScript"],
          years: [2013, 2026],
          files: 6500,
          bytes: 1,
          built: "2026-10-01",
        },
      ],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]?.shelf).toBe("Live chronicles")
    expect(cards[0] && storyHref(cards[0].link)).toBe("/hall/react/react")
  })
})
