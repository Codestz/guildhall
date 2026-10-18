import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  CATALOG_VERSION,
  chronicleFor,
  chronicleStem,
  loadCatalog,
  namesRepo,
  openRequestFor,
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

  test("names only the form's file, its title and its `repo` field (chronicles .github/ISSUE_TEMPLATE/chronicle.yml)", () => {
    const url = new URL(requestChronicleUrl("vercel", "next.js"))
    expect([...url.searchParams.keys()].sort()).toEqual(["repo", "template", "title"])
    expect(url.searchParams.get("repo")).toBe("vercel/next.js")
    expect(url.searchParams.get("title")).toBe("Chronicle: vercel/next.js")
  })

  test("keeps an odd name whole through the query", () => {
    const url = new URL(requestChronicleUrl("a-b", "c_d.e"))
    expect(url.searchParams.get("repo")).toBe("a-b/c_d.e")
    expect(url.search).not.toContain(" ")
  })
})

describe("namesRepo", () => {
  test("finds the name as the form's field, a title, or a github.com link", () => {
    expect(namesRepo("### Repository\n\nvercel/next.js\n\n### Public repo", "vercel", "next.js")).toBe(true)
    expect(namesRepo("Chronicle: Vercel/Next.js", "vercel", "next.js")).toBe(true)
    expect(namesRepo("https://github.com/vercel/next.js.git", "vercel", "next.js")).toBe(true)
    expect(namesRepo("please do vercel/next.js.", "vercel", "next.js")).toBe(true)
  })

  test("not a longer name that starts the same, nor another owner's", () => {
    expect(namesRepo("vercel/next.js-starter", "vercel", "next.js")).toBe(false)
    expect(namesRepo("vercel/next.jsx", "vercel", "next.js")).toBe(false)
    expect(namesRepo("notvercel/next.js", "vercel", "next.js")).toBe(false)
    // a dot in the name is a dot, not any character
    expect(namesRepo("vercel/nextXjs", "vercel", "next.js")).toBe(false)
  })
})

describe("openRequestFor", () => {
  const answering = (body: unknown, status = 200, calls: string[] = []) =>
    (async (input: string | URL | Request) => {
      calls.push(String(input))
      return new Response(JSON.stringify(body), { status })
    }) as typeof fetch
  const issue = (over: Record<string, unknown> = {}) => ({
    html_url: "https://github.com/Codestz/guildhall-chronicles/issues/42",
    state: "open",
    title: "Chronicle: vercel/next.js",
    body: "### Repository\n\nvercel/next.js",
    labels: [{ name: "chronicle" }],
    ...over,
  })

  test("asks GitHub's search for the chronicles repo's open requests naming the repo", async () => {
    const calls: string[] = []
    await openRequestFor("vercel", "next.js", { fetch: answering({ items: [] }, 200, calls) })
    const url = new URL(calls[0] ?? "")
    expect(url.origin + url.pathname).toBe("https://api.github.com/search/issues")
    const q = url.searchParams.get("q") ?? ""
    expect(q).toContain("repo:Codestz/guildhall-chronicles")
    expect(q).toContain("is:open")
    expect(q).toContain('"vercel/next.js"')
  })

  test("an open request is found, and says when it is queued", async () => {
    expect(await openRequestFor("vercel", "next.js", { fetch: answering({ items: [issue()] }) })).toEqual({
      status: "open",
      url: "https://github.com/Codestz/guildhall-chronicles/issues/42",
      queued: false,
    })
    const queued = issue({ labels: [{ name: "chronicle" }, { name: "queued" }] })
    const found = await openRequestFor("vercel", "next.js", { fetch: answering({ items: [queued] }) })
    expect(found).toMatchObject({ status: "open", queued: true })
  })

  test("a loose match for another repo, a closed issue or a foreign link is not a request", async () => {
    const items = [
      issue({ title: "Chronicle: vercel/next.js-starter", body: "vercel/next.js-starter" }),
      issue({ state: "closed" }),
      issue({ html_url: "https://evil.test/issues/1" }),
    ]
    expect(await openRequestFor("vercel", "next.js", { fetch: answering({ items }) })).toEqual({
      status: "none",
    })
  })

  test("fails soft: a rate limit, a network error or an odd answer is unavailable", async () => {
    const limited = await openRequestFor("vercel", "next.js", { fetch: answering({ message: "rate" }, 403) })
    expect(limited).toEqual({ status: "unavailable", reason: "HTTP 403" })
    expect((await openRequestFor("vercel", "next.js", { fetch: down })).status).toBe("unavailable")
    expect((await openRequestFor("vercel", "next.js", { fetch: answering({}) })).status).toBe("unavailable")
  })

  test("a malformed name asks nobody", async () => {
    const calls: string[] = []
    const found = await openRequestFor("a/b", "c", { fetch: answering({ items: [] }, 200, calls) })
    expect(found).toEqual({ status: "none" })
    expect(calls).toEqual([])
  })
})
