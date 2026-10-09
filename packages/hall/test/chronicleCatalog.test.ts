import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { badgeMarkdown, deepenLink, growLink, SITE, sailLink } from "../src/hud/chronicleLinks.ts"
import { compact, facts, size, voyageOf } from "../src/hud/harbourModel.ts"
import {
  buildCatalog,
  type Catalog,
  CHRONICLES_CDN,
  catalogEntry,
  inCatalog,
  loadCatalog,
  parseCatalog,
} from "../src/world/chronicle/catalog.ts"
import { type Chronicle, encodeChronicle, readChronicle } from "../src/world/chronicle/format.ts"
import { chronicleFor } from "../src/world/gen/load.ts"

const SHIPPED = join(import.meta.dir, "../public/chronicles")
const bytesOf = (file: string) => new Uint8Array(readFileSync(join(SHIPPED, file)))
const shipped = async (file: string): Promise<Chronicle> => readChronicle(bytesOf(file))

/** A fetch that answers from `routes` (by full URL) and 404s the rest, noting every URL asked. */
function fakeFetch(routes: Record<string, () => Response>): { fetcher: typeof fetch; asked: string[] } {
  const asked: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    return routes[url]?.() ?? new Response("not found", { status: 404 })
  }) as typeof fetch
  return { fetcher, asked }
}

describe("the catalog", () => {
  test("an entry carries a chronicle's name, stars, top languages, years, size and build day", async () => {
    const react = await shipped("react__react.json.gz")
    const entry = catalogEntry(react)
    expect(entry.repo).toBe("react/react")
    expect(entry.stars).toBe(react.repo.stars as number)
    expect(entry.languages).toEqual(react.repo.languages.slice(0, 3).map(([name]) => name))
    expect(entry.years[0]).toBe(2013)
    expect(entry.years[1]).toBeGreaterThanOrEqual(entry.years[0])
    expect(entry.files).toBe(react.repo.files)
    expect(entry.built).toBe(react.generatedAt.slice(0, 10))
  })

  test("building lists every shipped chronicle once, most stars first, the newest build winning", async () => {
    const files = readdirSync(SHIPPED).filter((name) => name.endsWith(".json.gz"))
    const all = await Promise.all(files.map(shipped))
    const mcpx = all.find((c) => c.repo.name === "Codestz/mcpx") as Chronicle
    const rebuilt: Chronicle = { ...mcpx, generatedAt: "2099-01-01T00:00:00Z" }
    const catalog = buildCatalog([...all, rebuilt], "2026-10-08T12:00:00Z")
    expect(catalog.updated).toBe("2026-10-08")
    expect(catalog.repos).toHaveLength(files.length)
    expect(catalog.repos.find((e) => e.repo === "Codestz/mcpx")?.built).toBe("2099-01-01")
    const stars = catalog.repos.map((e) => e.stars ?? 0)
    expect(stars).toEqual([...stars].sort((a, b) => b - a))
  })

  test("the hall's shipped index.json is a catalog of exactly its shipped chronicles", () => {
    const catalog = parseCatalog(JSON.parse(readFileSync(join(SHIPPED, "index.json"), "utf8")))
    const files = readdirSync(SHIPPED).filter((name) => name.endsWith(".json.gz"))
    expect(catalog?.repos.map((e) => e.repo.toLowerCase().replace("/", "__")).sort()).toEqual(
      files.map((name) => name.replace(".json.gz", "")).sort(),
    )
  })

  test("parsing refuses another version, and drops malformed entries while keeping the rest", () => {
    expect(parseCatalog({ v: 2, updated: "", repos: [] })).toBeUndefined()
    expect(parseCatalog("nope")).toBeUndefined()
    const good = {
      repo: "a/b",
      languages: ["Go"],
      years: [2020, 2021],
      files: 3,
      bytes: 10,
      built: "2026-01-02",
    }
    const parsed = parseCatalog({
      v: 1,
      updated: "2026-01-02",
      repos: [
        good,
        { ...good, repo: "../../etc" },
        { ...good, repo: "c/d", files: -1 },
        { ...good, repo: "e/f", built: "yesterday" },
        { ...good, repo: "g/h", years: [2020] },
        { ...good, repo: "i/j", description: "x".repeat(500), languages: ["Go", 3, "Rust", "C", "Zig"] },
      ],
    })
    expect(parsed?.repos.map((e) => e.repo)).toEqual(["a/b", "i/j"])
    const long = parsed?.repos[1]
    expect(long?.description?.length).toBe(200)
    expect(long?.languages).toEqual(["Go", "Rust", "C"])
  })

  test("membership goes by the chronicle's file, so case and the hall's aliases match", () => {
    const catalog: Catalog = {
      v: 1,
      updated: "",
      repos: [
        { repo: "react/react", languages: [], years: [2013, 2026], files: 1, bytes: 1, built: "2026-01-01" },
      ],
    }
    expect(inCatalog(catalog, "React/React")).toBe(true)
    expect(inCatalog(catalog, "facebook/react")).toBe(true)
    expect(inCatalog(catalog, "Codestz/mcpx")).toBe(false)
  })
})

describe("loading from the CDN, then the hall's own", () => {
  const catalogJson = readFileSync(join(SHIPPED, "index.json"), "utf8")
  const json = () => new Response(catalogJson, { headers: { "content-type": "application/json" } })

  test("the CDN's catalog when it answers", async () => {
    const { fetcher, asked } = fakeFetch({ [`${CHRONICLES_CDN}index.json`]: json })
    const found = await loadCatalog(fetcher, "/")
    expect(found?.source).toBe("cdn")
    expect(asked).toEqual([`${CHRONICLES_CDN}index.json`])
  })

  test("the bundled catalog when the CDN 404s or sends something else", async () => {
    for (const cdn of [undefined, () => new Response("<html>", { status: 200 })]) {
      const { fetcher } = fakeFetch({
        ...(cdn ? { [`${CHRONICLES_CDN}index.json`]: cdn } : {}),
        "/chronicles/index.json": json,
      })
      expect((await loadCatalog(fetcher, "/"))?.source).toBe("bundled")
    }
  })

  test("nothing (not a throw) when neither answers, or the network is down", async () => {
    expect(await loadCatalog(fakeFetch({}).fetcher, "/")).toBeUndefined()
    const down = (async () => {
      throw new TypeError("offline")
    }) as unknown as typeof fetch
    expect(await loadCatalog(down, "/")).toBeUndefined()
  })
})

describe("a chronicle for an island: bundled, then CDN, then quick", () => {
  const file = "codestz__mcpx.json.gz"
  const bundled = () => new Response(bytesOf(file))

  test("the bundled chronicle first: no network, and the showcase stays the same", async () => {
    const fresh = { ...(await shipped(file)), generatedAt: "2099-01-01T00:00:00Z" }
    const { fetcher, asked } = fakeFetch({
      [`${CHRONICLES_CDN}chronicles/${file}`]: () => new Response(encodeChronicle(fresh)),
      [`/chronicles/${file}`]: bundled,
    })
    const got = await chronicleFor("Codestz/mcpx", undefined, fetcher)
    expect(got?.generatedAt).toBe((await shipped(file)).generatedAt)
    expect(asked).toEqual([`/chronicles/${file}`])
  })

  test("the CDN's for a repo the hall doesn't ship", async () => {
    const other = "someone__chronicled.json.gz"
    const fresh = { ...(await shipped(file)), generatedAt: "2099-01-01T00:00:00Z" }
    const { fetcher, asked } = fakeFetch({
      [`${CHRONICLES_CDN}chronicles/${other}`]: () => new Response(encodeChronicle(fresh)),
    })
    expect((await chronicleFor("someone/chronicled", undefined, fetcher))?.generatedAt).toBe(
      fresh.generatedAt,
    )
    expect(asked).toEqual([`/chronicles/${other}`, `${CHRONICLES_CDN}chronicles/${other}`])
  })

  test("a quick build after both miss, and nothing when GitHub can't help either", async () => {
    const { fetcher, asked } = fakeFetch({})
    expect(await chronicleFor("someone/unknown", undefined, fetcher)).toBeUndefined()
    expect(asked.slice(0, 2)).toEqual([
      "/chronicles/someone__unknown.json.gz",
      `${CHRONICLES_CDN}chronicles/someone__unknown.json.gz`,
    ])
    expect(asked.slice(2).some((url) => url.startsWith("https://api.github.com/repos/someone/unknown"))).toBe(
      true,
    )
  })
})

describe("the backend's links", () => {
  test("an island link grows it, and reads plainly", () => {
    expect(growLink("Codestz/mcpx")).toBe("/?repo=Codestz/mcpx&grow")
  })

  test("an archipelago link holds at most six islands", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `o/r${i}`)
    expect(sailLink(eight)).toBe("/?repos=o/r0,o/r1,o/r2,o/r3,o/r4,o/r5")
  })

  test("the deepen link opens the chronicles repo's form with the repo filled in", () => {
    const url = new URL(deepenLink("vercel/next.js"))
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/Codestz/guildhall-chronicles/issues/new")
    expect(url.searchParams.get("template")).toBe("chronicle.yml")
    expect(url.searchParams.get("repo")).toBe("vercel/next.js")
    expect(url.searchParams.get("title")).toBe("Chronicle: vercel/next.js")
  })

  test("the badge is Markdown: a shields.io image linking to the island on the public site", () => {
    const badge = badgeMarkdown("Codestz/mcpx")
    expect(badge).toMatch(/^\[!\[[^\]]+\]\(https:\/\/img\.shields\.io\/badge\/[^)]+\)\]\([^)]+\)$/)
    expect(badge.endsWith(`(${SITE}/?repo=Codestz/mcpx&grow)`)).toBe(true)
  })
})

describe("the Harbour's cards and voyage", () => {
  test("numbers read short", () => {
    expect([compact(812), compact(1530), compact(250_753), compact(1_200_000)]).toEqual([
      "812",
      "1.5k",
      "251k",
      "1.2M",
    ])
    expect([size(500), size(40_629_727), size(2.4e9)]).toEqual(["1 KB", "40.6 MB", "2.4 GB"])
  })

  test("a card's facts: stars, years, files, size (stars left out when unknown)", () => {
    const entry = {
      repo: "a/b",
      languages: [],
      years: [2025, 2025] as [number, number],
      files: 7252,
      bytes: 2e6,
      built: "",
    }
    expect(facts(entry)).toEqual(["2025", "7,252 files", "2.0 MB"])
    expect(facts({ ...entry, stars: 1530 })[0]).toBe("★ 1.5k")
  })

  test("with nothing chosen, Sail takes the first six; with some chosen, those, in listed order", () => {
    const listed = Array.from({ length: 9 }, (_, i) => `o/r${i}`)
    const none = voyageOf(listed, new Set())
    expect(none.repos).toEqual(listed.slice(0, 6))
    expect(none.label).toBe("Sail the first 6")
    expect(voyageOf(listed.slice(0, 3), new Set()).label).toBe("Sail them all")
    const some = voyageOf(listed, new Set(["o/r7", "o/r2"]))
    expect(some.repos).toEqual(["o/r2", "o/r7"])
    expect(some.href).toBe("/?repos=o/r2,o/r7")
    expect(some.label).toBe("Sail these 2")
  })
})
