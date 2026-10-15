/**
 * The query registry (src/params.ts): every read of a URL's query goes through it, every name read is
 * declared there, and the dev params are honoured on this machine or with `?dev=1` only.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { islandKnobs } from "../src/hexworld/knobs.ts"
import {
  devHonoured,
  hasParam,
  isParam,
  PARAMS,
  param,
  publicOnly,
  setParamEnv,
  worldEntries,
} from "../src/params.ts"

const SRC = join(import.meta.dir, "../src")
const PACKAGES = join(import.meta.dir, "../../../packages")
const q = (s: string) => new URLSearchParams(s)

/** Every .ts/.tsx under `dir`. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

const studio = sources(SRC).filter((f) => !f.endsWith("/params.ts"))
const lines = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .map((text, k) => ({ text, at: `${relative(SRC, file)}:${k + 1}` }))

/**
 * Literal-key `.get("…")` / `.has("…")` calls that are not a query's (a catalog's piece, a response's
 * header, a set of shows): anything else with a string key is read as a query read.
 */
const NOT_A_QUERY = [/\bcatalog\.get\("/, /\bheaders\.get\("/, /\bstarted\.has\("/]

describe("every query read goes through the registry", () => {
  test("no source reads a URL's query itself", () => {
    const found: string[] = []
    for (const file of studio)
      for (const { text, at } of lines(file)) {
        const code = text.replace(/\/\/.*$/, "")
        if (/^\s*\*/.test(code)) continue
        // the router owns the address (it resolves the path and query into a screen's query)
        if (/location\.search/.test(code) && !at.startsWith("shell/router.ts")) found.push(at)
        if (/searchParams\.(get|has|getAll)\(/.test(code)) found.push(at)
        if (/new URLSearchParams\(\s*(globalThis\.)?location/.test(code)) found.push(at)
        if (/\.(get|has|getAll)\(\s*["']/.test(code) && !NOT_A_QUERY.some((re) => re.test(code)))
          found.push(at)
      }
    expect(found).toEqual([])
  })

  test("no package reads the page's address (the app hands them what it read)", () => {
    const found: string[] = []
    for (const pkg of readdirSync(PACKAGES)) {
      let files: string[] = []
      try {
        files = sources(join(PACKAGES, pkg, "src"))
      } catch {
        continue
      }
      for (const file of files)
        for (const [k, text] of readFileSync(file, "utf8").split("\n").entries())
          if (/location\??\.search|searchParams\.(get|has)\(/.test(text))
            found.push(`${pkg}:${file}:${k + 1}`)
    }
    expect(found).toEqual([])
  })

  test("every name read is registered", () => {
    const unknown: string[] = []
    for (const file of studio)
      for (const { text, at } of lines(file))
        for (const m of text.matchAll(/\b(?:param|hasParam|rawParam)\([^,()]+(?:\([^)]*\))?,\s*"(\w+)"\)/g))
          if (!isParam(m[1] as string)) unknown.push(`${at} ${m[1]}`)
    expect(unknown).toEqual([])
  })

  test("every knob the Viewer writes into the address is registered", () => {
    const keys = new Set<string>()
    for (const seedKey of ["seed", "town"])
      for (const section of islandKnobs(seedKey)) for (const knob of section.knobs) keys.add(knob.key)
    // the other screens' knob sections, read from their source
    for (const file of studio) {
      const text = readFileSync(file, "utf8")
      for (const m of text.matchAll(/kind: "(?:range|toggle|segment|stepper|select)",[^}]*?key: "(\w+)"/gs))
        keys.add(m[1] as string)
    }
    expect(keys.size).toBeGreaterThan(30)
    expect([...keys].filter((k) => !isParam(k))).toEqual([])
  })

  test("each entry says what it is for, in one line", () => {
    for (const [name, spec] of Object.entries(PARAMS)) {
      expect(spec.purpose.length).toBeGreaterThan(8)
      expect(spec.purpose).not.toContain("\n")
      expect(name).toMatch(/^[a-zA-Z]+$/)
    }
  })

  test("the links the site hands out are public", () => {
    for (const name of [
      "repo",
      "story",
      "act",
      "t",
      "season",
      "files",
      "hour",
      "weather",
      "town",
      "feed",
      "guild",
    ])
      expect(PARAMS[name as keyof typeof PARAMS].kind).toBe("public")
  })
})

describe("the dev gate", () => {
  afterEach(() => setParamEnv(null))
  const away = { devBuild: false, hostname: "guildhall.codestz.dev", search: "" }

  test("on this machine, in a dev build, in a test, or with ?dev=1", () => {
    expect(devHonoured({ devBuild: true, hostname: "guildhall.codestz.dev" })).toBe(true)
    expect(devHonoured({ devBuild: false, hostname: "localhost" })).toBe(true)
    expect(devHonoured({ devBuild: false, hostname: "127.0.0.1" })).toBe(true)
    expect(devHonoured({ devBuild: false })).toBe(true)
    expect(devHonoured(away)).toBe(false)
    expect(devHonoured({ ...away, search: "?story=saga&dev=1" })).toBe(true)
  })

  test("off this machine a dev param reads as absent; a public one as given", () => {
    setParamEnv(away)
    const query = q("hud=perf&loader=0&next=0&story=saga&hour=22&files=900")
    expect(param(query, "hud")).toBeNull()
    expect(param(query, "loader")).toBe(true)
    expect(param(query, "next")).toBe(true)
    expect(hasParam(query, "loader")).toBe(false)
    expect(param(query, "story")).toBe("saga")
    expect(param(query, "hour")).toBe(22)
    expect(param(query, "files")).toBe(900)
  })

  test("?dev=1 in the page's address or the query opens them", () => {
    setParamEnv({ ...away, search: "?dev=1" })
    expect(param(q("hud=perf"), "hud")).toBe("perf")
    setParamEnv(away)
    expect(param(q("hud=perf&dev=1"), "hud")).toBe("perf")
  })

  test("a dev param ignored off this machine does not rebuild the world", () => {
    setParamEnv(away)
    expect(worldEntries(q("seed=3&fx=1&story=saga&bogus=1"))).toEqual(["seed=3"])
    setParamEnv(null)
    expect(worldEntries(q("seed=3&fx=1&story=saga&bogus=1"))).toEqual(["fx=1", "seed=3"])
  })
})

describe("the parsers", () => {
  test("flags, numbers, acts and choices", () => {
    expect(param(q(""), "post")).toBe(true)
    expect(param(q("post=0"), "post")).toBe(false)
    expect(param(q(""), "spots")).toBe(false)
    expect(param(q("spots=1"), "spots")).toBe(true)
    expect(param(q("hour="), "hour")).toBeNull()
    expect(param(q("hour=x"), "hour")).toBeNull()
    expect(param(q("hour=21.5"), "hour")).toBe(21.5)
    expect(param(q("act=3"), "act")).toBe(3)
    expect(param(q("act=9"), "act")).toBeUndefined()
    expect(param(q("feed=story"), "feed")).toBe("story")
    expect(param(q("feed=bogus"), "feed")).toBeNull()
  })

  test("a link for someone else carries the public params only", () => {
    expect(publicOnly(q("story=saga&hud=perf&dev=1&t=0.5&bogus=1&season=winter")).toString()).toBe(
      "story=saga&t=0.5&season=winter",
    )
  })
})
