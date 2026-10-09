import { describe, expect, test } from "bun:test"
import { chronicleFile } from "../src/world/chronicle/bundled.ts"
import { dayOf, encodeChronicle } from "../src/world/chronicle/format.ts"
import { QUICK_LIMIT, quickChronicle } from "../src/world/chronicle/quick.ts"
import { GitHubError } from "../src/world/gen/fetch.ts"
import { chronicleFor } from "../src/world/gen/load.ts"

const W = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 1000
const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 202 ? "" : JSON.stringify(body), { status, headers })

/** A stand-in for GitHub's API: routes by URL fragment, records what was asked. */
function github(routes: [fragment: string, reply: (url: string) => Response][]) {
  const asked: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    for (const [fragment, reply] of routes) if (url.includes(fragment)) return reply(url)
    return answer({ message: "Not Found" }, 404)
  }) as typeof fetch
  return { fetcher, asked }
}

const META = {
  full_name: "acme/Tool",
  default_branch: "main",
  stargazers_count: 7,
  created_at: "2020-01-06T00:00:00Z",
  pushed_at: "2021-01-04T00:00:00Z",
}
const blob = (path: string, size = 100) => ({ path, type: "blob", size })
const EARLY = [blob("README.md"), blob("src/a.ts")]
const LATE = [...EARLY, blob("src/b.ts"), blob("docs/guide.md")]
const FINAL = [...LATE, blob("lib/x.go", 300)]

const routes = (
  overrides: [string, (url: string) => Response][] = [],
): [string, (url: string) => Response][] => [
  ...overrides,
  ["/git/trees/main", () => answer({ tree: FINAL, truncated: false })],
  ["/git/trees/early", () => answer({ tree: EARLY })],
  ["/git/trees/late", () => answer({ tree: LATE })],
  [
    "/commits?",
    (url) => {
      const until = /until=([\d-]+)/.exec(url)?.[1] ?? ""
      const sha = until < "2020-07-01" ? "early" : "late"
      return answer([
        {
          sha,
          commit: { committer: { date: sha === "early" ? "2020-02-03T10:00:00Z" : "2020-08-03T10:00:00Z" } },
        },
      ])
    },
  ],
  [
    "/stats/code_frequency",
    () =>
      answer([
        [W("2020-01-05"), 500, -10],
        [W("2020-08-02"), 300, -50],
      ]),
  ],
  [
    "/stats/contributors",
    () =>
      answer([
        {
          author: { login: "ann" },
          total: 3,
          weeks: [
            { w: W("2020-01-05"), a: 1, d: 0, c: 2 },
            { w: W("2020-01-19"), a: 1, d: 0, c: 1 },
          ],
        },
        {
          author: { login: "renovate[bot]", type: "Bot" },
          total: 1,
          weeks: [{ w: W("2020-08-02"), a: 1, d: 0, c: 1 }],
        },
      ]),
  ],
  [
    "/contributors?",
    () =>
      answer([
        { login: "ann", contributions: 4 },
        { login: "zed", contributions: 1 },
      ]),
  ],
  ["/languages", () => answer({ Go: 300, TypeScript: 700 })],
  ["/releases", () => answer([{ tag_name: "v1.0.0", name: "One", published_at: "2020-06-01T00:00:00Z" }])],
  ["/repos/acme/tool", () => answer(META)],
]
const options = { sleep: async () => {}, now: () => new Date("2021-01-05T00:00:00Z") }

describe("quick builder", () => {
  test("builds a whole chronicle within its call budget", async () => {
    const { fetcher, asked } = github(routes())
    const c = await quickChronicle("acme/tool", { ...options, fetcher })
    expect(c.depth).toBe("quick")
    expect(c.budget).toEqual({ calls: asked.length, limit: QUICK_LIMIT })
    expect(asked.length).toBeLessThanOrEqual(QUICK_LIMIT)
    expect(c.partial).toBeUndefined()
    expect(c.repo).toMatchObject({ name: "acme/Tool", stars: 7, files: 5, bytes: 700, contributors: 2 })
    expect(c.repo.languages).toEqual([
      ["TypeScript", 70],
      ["Go", 30],
    ])
    expect(c.snapshots.day).toEqual([dayOf("2020-02-03"), dayOf("2020-08-03"), dayOf("2021-01-04")])
    const born = Object.fromEntries(c.units.map((u) => [u.name, u.born]))
    expect(born).toEqual({
      "/": dayOf("2020-02-03"),
      src: dayOf("2020-02-03"),
      docs: dayOf("2020-08-03"),
      lib: dayOf("2021-01-04"),
    })
    expect(c.contributors.map((p) => [p.login, p.commits, !!p.bot])).toEqual([
      ["ann", 4, false],
      ["renovate[bot]", 1, true],
      ["zed", 1, false],
    ])
    expect(c.contributors[0]?.weeks).toBe("201")
    expect(c.weekly.additions?.reduce((a, b) => a + b, 0)).toBe(800)
    expect(c.releases).toEqual([{ tag: "v1.0.0", day: dayOf("2020-06-01"), name: "One", major: true }])
  })

  test("a tree the caller already has saves a call", async () => {
    const without = github(routes())
    await quickChronicle("acme/tool", { ...options, fetcher: without.fetcher })
    const withTree = github(routes())
    await quickChronicle("acme/tool", {
      ...options,
      fetcher: withTree.fetcher,
      tree: { entries: FINAL.map(({ path, size }) => ({ path, type: "blob" as const, size })) },
    })
    expect(withTree.asked.length).toBe(without.asked.length - 1)
  })

  test("a stats endpoint still computing (202) is asked once more, then left out", async () => {
    let first = true
    const once = github(
      routes([
        [
          "/stats/code_frequency",
          () => {
            const reply = first ? answer(null, 202) : answer([[W("2020-01-05"), 5, 0]])
            first = false
            return reply
          },
        ],
      ]),
    )
    const c = await quickChronicle("acme/tool", { ...options, fetcher: once.fetcher })
    expect(c.weekly.additions?.reduce((a, b) => a + b, 0)).toBe(5)
    expect(once.asked.filter((url) => url.includes("code_frequency"))).toHaveLength(2)

    const never = github(routes([["/stats/", () => answer(null, 202)]]))
    const left = await quickChronicle("acme/tool", { ...options, fetcher: never.fetcher })
    expect(left.partial).toEqual(["activity", "growth"])
    expect(left.weekly).toEqual({})
    expect(left.contributors[0]).toMatchObject({ login: "ann", weeks: "" })
    expect(left.budget?.calls).toBeLessThanOrEqual(QUICK_LIMIT)
  })

  test("a hit rate limit stops every later call and keeps what it had", async () => {
    const limited = () => answer({ message: "rate" }, 403, { "x-ratelimit-remaining": "0" })
    const { fetcher, asked } = github(routes([["/commits?", limited]]))
    const c = await quickChronicle("acme/tool", { ...options, fetcher })
    expect(asked.filter((url) => url.includes("/commits?"))).toHaveLength(1)
    expect(asked.some((url) => url.includes("/releases"))).toBe(false)
    expect(c.partial).toContain("rate")
    expect(c.snapshots.day).toEqual([dayOf("2021-01-04")])
    expect(c.units.map((u) => u.name).sort()).toEqual(["/", "docs", "lib", "src"])
  })

  test("a small budget is never overspent", async () => {
    const { fetcher, asked } = github(routes())
    const c = await quickChronicle("acme/tool", { ...options, fetcher, limit: 5 })
    expect(asked).toHaveLength(5)
    expect(c.partial).toContain("budget")
  })

  test("no such repo rejects, as the tree would", async () => {
    const { fetcher } = github([])
    await expect(quickChronicle("acme/none", { ...options, fetcher })).rejects.toBeInstanceOf(GitHubError)
  })

  test("this repo's private paths stay out of a live build too", async () => {
    const secret = [
      blob("docs/x.md"),
      blob(".claude/s.json"),
      blob(".agents/a.md"),
      blob("CONTEXT.md"),
      blob("skills-lock.json"),
    ]
    const { fetcher, asked } = github(
      routes([
        ["/repos/Codestz/guildhall/git/trees/main", () => answer({ tree: [...FINAL, ...secret] })],
        ["/repos/Codestz/guildhall/git/trees/", () => answer({ tree: [...EARLY, ...secret] })],
        [
          "/repos/Codestz/guildhall",
          (url) =>
            url.endsWith("guildhall") ? answer({ ...META, full_name: "Codestz/guildhall" }) : answer({}, 404),
        ],
      ]).filter(([fragment]) => fragment !== "/git/trees/main"),
    )
    const c = await quickChronicle("Codestz/guildhall", { ...options, fetcher })
    const text = encodeChronicle(c)
    for (const name of [".claude", ".agents", "CONTEXT", "skills-lock", '"docs"'])
      expect(text).not.toContain(name)
    expect(asked.some((url) => url.endsWith("/languages"))).toBe(false)
  })
})

describe("chronicleFor (?repo=)", () => {
  test("a bundled chronicle comes first, by its file name", async () => {
    const deep = encodeChronicle({
      ...(await quickChronicle("acme/tool", { ...options, fetcher: github(routes()).fetcher })),
      depth: "deep",
    })
    const { fetcher, asked } = github([
      ["/chronicles/", () => new Response(Bun.gzipSync(new TextEncoder().encode(deep)))],
    ])
    expect((await chronicleFor("facebook/react", undefined, fetcher))?.depth).toBe("deep")
    expect(asked).toEqual(["/chronicles/react__react.json.gz"])
    expect(chronicleFile("sample")).toBe("codestz__guildhall.json.gz")
  })

  test("without one it builds quick, and without GitHub it is undefined (tree-only)", async () => {
    const live = github(routes())
    expect((await chronicleFor("acme/tool", undefined, live.fetcher))?.depth).toBe("quick")
    const html = github([["/chronicles/", () => new Response("<!doctype html>")]])
    expect(await chronicleFor("acme/tool", undefined, html.fetcher)).toBeUndefined()
  })
})
