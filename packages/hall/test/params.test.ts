import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { devFlagsOf } from "../src/guild/devFlags.ts"
import { PARAMS, PUBLIC_PARAMS } from "../src/guild/params.ts"

const SRC = resolve(import.meta.dir, "../src")

/** Every source file but the labs' (src/lab): they read their own params, only after `lab` is set. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "lab" ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** A key read or written on something holding URL params: `params.get("x")`, `link.has("x")`, `url.searchParams.set("x"`… */
const KEY_ON_PARAMS =
  /\b(?:params|link|q|searchParams|URLSearchParams\([^)]*\))\??\.(?:get|has|set|delete)\(\s*"([^"]+)"/g
/** The deep-link parser's `case "story":` labels. */
const DEEP_LINK_CASE = /^\s*case "(\w+)":/gm

function keysRead(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8")
    const where = relative(SRC, file)
    for (const match of text.matchAll(KEY_ON_PARAMS)) found.set(match[1] as string, where)
    if (where === "guild/deeplink.ts")
      for (const match of text.matchAll(DEEP_LINK_CASE)) found.set(match[1] as string, where)
  }
  return found
}

describe("the param registry (guild/params.ts)", () => {
  test("every URL param read anywhere in src is registered", () => {
    const registered = new Set(PARAMS.map((param) => param.key))
    const read = keysRead()
    expect(read.size).toBeGreaterThan(20) // the scan itself still finds the reads
    const missing = [...read].filter(([key]) => !registered.has(key)).map(([key, file]) => `${key} (${file})`)
    expect(missing).toEqual([])
  })

  test("a key is listed once, and the public surface is the 20 documented params", () => {
    const keys = PARAMS.map((param) => param.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...PUBLIC_PARAMS].sort()).toEqual(
      "story act t n hour weather look repo select view paused bard hud live renderer demo archipelago repos island split grow"
        .split(" ")
        .sort(),
    )
  })

  test("every public param is on the public how-it-works page", () => {
    const page = readFileSync(resolve(import.meta.dir, "../how.html"), "utf8")
    for (const key of PUBLIC_PARAMS) expect(page).toContain(`<code>${key}</code>`)
  })
})

describe("dev flags (guild/devFlags.ts)", () => {
  const ASKED = "?cascades=off&haze=off&characters=off&folk=off&tsl=1&anyhub=1&townsfolk=7&bridgemax=150"

  test("a production build ignores every one of them", () => {
    expect(devFlagsOf(ASKED, false)).toEqual({
      cascades: true,
      haze: true,
      characters: true,
      folk: true,
      tsl: false,
      anyhub: false,
      townsfolk: undefined,
      bridgemax: undefined,
    })
  })

  test("a dev or probe build reads them, with one off grammar (off, 0, false)", () => {
    expect(devFlagsOf(ASKED, true)).toEqual({
      cascades: false,
      haze: false,
      characters: false,
      folk: false,
      tsl: true,
      anyhub: true,
      townsfolk: 7,
      bridgemax: 150,
    })
    for (const off of ["off", "0", "false"]) expect(devFlagsOf(`?folk=${off}`, true).folk).toBe(false)
  })

  test("no params means the defaults; nonsense numbers are not a cap", () => {
    expect(devFlagsOf("", true)).toEqual(devFlagsOf("", false))
    expect(devFlagsOf("?townsfolk=lots&bridgemax=-3", true)).toMatchObject({
      townsfolk: undefined,
      bridgemax: undefined,
    })
    expect(devFlagsOf("?townsfolk=0", true).townsfolk).toBe(0)
  })
})
