import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  CATALOG_VERSION,
  chronicleFor,
  chronicleStem,
  loadCatalog,
  parseCatalog,
  requestChronicleUrl,
} from "../src/index.ts"
import { REPO_DIR } from "./repo-fixtures.ts"

/** The chronicles backend (catalog + chronicle files) over recorded fixtures: offline and deterministic. */

const BASE = "https://cdn.test/"
const LOCAL = "/local/"

/** Serves the routes it knows from the fixtures folder; anything else is a 404. */
function serve(routes: Record<string, string>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const name = routes[url]
    if (!name) return new Response("nope", { status: 404 })
    return new Response(await Bun.file(join(REPO_DIR, name)).arrayBuffer())
  }) as typeof fetch
}
const down = (async () => {
  throw new TypeError("offline")
}) as unknown as typeof fetch
/** The CDN answers with `cdn`; everything else is served by `rest`. */
const cdnReturns = (cdn: () => Response, rest: typeof fetch) =>
  (async (input: string | URL | Request) =>
    String(input).startsWith(BASE) ? cdn() : rest(input)) as typeof fetch

const CDN = {
  [`${BASE}index.json`]: "index.json",
  [`${BASE}chronicles/react__react.json.gz`]: "react.json.gz",
}
const LOCALS = {
  [`${LOCAL}react.json.gz`]: "react.json.gz",
  [`${LOCAL}guildhall.json.gz`]: "guildhall.json.gz",
}

describe("loadCatalog", () => {
  test("reads the recorded index.json", async () => {
    const result = await loadCatalog({ fetch: serve(CDN), baseUrl: BASE })
    if (result.status !== "ok") throw new Error("expected ok")
    expect(result.catalog.v).toBe(CATALOG_VERSION)
    expect(result.catalog.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.catalog.repos.length).toBeGreaterThan(3)
    expect(result.catalog.repos.find((r) => r.repo === "react/react")?.years[0]).toBe(2013)
    expect(result.catalog.repos[0]?.stars).toBeGreaterThanOrEqual(result.catalog.repos[1]?.stars ?? 0)
  })

  test("is unavailable (never a rejection) offline, on a 404, on junk", async () => {
    expect((await loadCatalog({ fetch: down, baseUrl: BASE })).status).toBe("unavailable")
    expect((await loadCatalog({ fetch: serve({}), baseUrl: BASE })).status).toBe("unavailable")
    const junk = (async () => new Response("<html>")) as unknown as typeof fetch
    expect((await loadCatalog({ fetch: junk, baseUrl: BASE })).status).toBe("unavailable")
  })

  test("rejects an unknown version, keeps the good entries of a known one", () => {
    expect(parseCatalog({ v: 2, updated: "2027-01-01", repos: [] })).toContain("version 2")
    expect(typeof parseCatalog(null)).toBe("string")
    const good = {
      repo: "a/b",
      languages: ["Go"],
      years: [2020, 2021],
      files: 3,
      bytes: 9,
      built: "2026-01-02",
    }
    const parsed = parseCatalog({ v: 1, updated: "2026-01-02", repos: [good, { repo: "no slash" }, 7] })
    if (typeof parsed === "string") throw new Error(parsed)
    expect(parsed.repos).toEqual([good])
  })
})

describe("chronicleFor", () => {
  test("decodes the CDN's copy and reports when it was built", async () => {
    const calls: string[] = []
    const result = await chronicleFor("react", "react", {
      fetch: serve(CDN, calls),
      baseUrl: BASE,
      localBase: LOCAL,
    })
    if (result.status !== "ok") throw new Error("expected ok")
    expect(result.source).toBe("cdn")
    expect(result.chronicle.repo.name).toBe("react/react")
    expect(result.generatedAt).toBe(result.chronicle.generatedAt)
    expect(calls).toEqual([`${BASE}chronicles/react__react.json.gz`])
  })

  test("files are lowercase, and GitHub's old spelling of react finds it", async () => {
    const result = await chronicleFor("Facebook", "React", { fetch: serve(CDN), baseUrl: BASE })
    expect(result.status).toBe("ok")
    expect(chronicleStem("Codestz", "Guildhall")).toBe("codestz__guildhall")
  })

  test("falls back to the local copy when the CDN is offline", async () => {
    const result = await chronicleFor("react", "react", { fetch: down, baseUrl: BASE, localBase: LOCAL })
    expect(result.status).toBe("unavailable")
    const withLocal = cdnReturns(() => new Response("", { status: 404 }), serve(LOCALS))
    const local = await chronicleFor("react", "react", { fetch: withLocal, baseUrl: BASE, localBase: LOCAL })
    expect(local.status === "ok" && local.source).toBe("local")
  })

  test("falls back to local on a server error and on a corrupt file", async () => {
    const error = cdnReturns(() => new Response("oops", { status: 503 }), serve(LOCALS))
    const viaError = await chronicleFor("Codestz", "guildhall", {
      fetch: error,
      baseUrl: BASE,
      localBase: LOCAL,
    })
    expect(viaError.status === "ok" && viaError.source).toBe("local")
    const corrupt = cdnReturns(() => new Response("not gzip, not json"), serve(LOCALS))
    const viaCorrupt = await chronicleFor("react", "react", {
      fetch: corrupt,
      baseUrl: BASE,
      localBase: LOCAL,
    })
    expect(viaCorrupt.status === "ok" && viaCorrupt.source).toBe("local")
  })

  test("not chronicled when the CDN says 404 and no local copy exists", async () => {
    const result = await chronicleFor("nobody", "nothing", {
      fetch: serve(CDN),
      baseUrl: BASE,
      localBase: LOCAL,
    })
    expect(result).toEqual({ status: "not-chronicled", repo: "nobody/nothing" })
    expect((await chronicleFor("bad name", "x", { fetch: serve(CDN) })).status).toBe("not-chronicled")
  })

  test("unavailable (not 'not chronicled') when it could not ask", async () => {
    const result = await chronicleFor("nobody", "nothing", { fetch: down, baseUrl: BASE })
    expect(result).toEqual({ status: "unavailable", repo: "nobody/nothing", reason: "offline" })
  })
})

describe("requestChronicleUrl", () => {
  test("prefills the chronicles repo's issue form", () => {
    const url = new URL(requestChronicleUrl("facebook", "react"))
    expect(url.origin + url.pathname).toBe("https://github.com/Codestz/guildhall-chronicles/issues/new")
    expect(url.searchParams.get("template")).toBe("chronicle.yml")
    expect(url.searchParams.get("title")).toBe("Chronicle: facebook/react")
    expect(url.searchParams.get("repo")).toBe("facebook/react")
  })
})
