import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { canonical, href, ROUTES, resolve } from "../src/shell/router.ts"

const at = (url: string, base = "/") => {
  const u = new URL(url, "http://x")
  const { screen, query } = resolve(u.pathname, u.search, base)
  return { screen, query: Object.fromEntries(query) }
}

describe("router", () => {
  test("every screen screens.ts registers has exactly one route", () => {
    const source = readFileSync(join(import.meta.dir, "../src/screens.ts"), "utf8")
    const files = [...source.matchAll(/from "\.\/([^"]+\/index\.tsx?|scenes\/scale\.ts)"/g)].map((m) => m[1])
    const ids = files.map((f) => {
      const text = readFileSync(join(import.meta.dir, "../src", f as string), "utf8")
      return /\bid: (?:"([^"]+)"|HOME_ID)/.exec(text)?.[1] ?? "home"
    })
    expect(ids.length).toBe(ROUTES.length)
    for (const id of ids) expect(ROUTES.filter((r) => r.screen === id).length).toBe(1)
  })

  test("paths resolve to their screen, the id folded into the query under the screen's key", () => {
    expect(at("/")).toEqual({ screen: "home", query: {} })
    expect(at("/pieces")).toEqual({ screen: "pieces", query: {} })
    expect(at("/pieces/kaykit-adventurers/barbarian?clip=Chopping")).toEqual({
      screen: "pieces",
      query: { clip: "Chopping", id: "kaykit-adventurers/barbarian" },
    })
    expect(at("/composer/houses/cottage?seed=3")).toEqual({
      screen: "composer",
      query: { seed: "3", recipe: "houses/cottage" },
    })
    expect(at("/npcs/guard")).toEqual({ screen: "npc", query: { recipe: "guard" } })
    expect(at("/grips?t=0.3,0.7")).toEqual({ screen: "grips", query: { t: "0.3,0.7" } })
    expect(at("/grips/editor")).toEqual({ screen: "grip", query: {} })
    expect(at("/grips/editor/kaykit-tools/axe")).toEqual({
      screen: "grip",
      query: { piece: "kaykit-tools/axe" },
    })
    expect(at("/lab/m0")).toEqual({ screen: "m0", query: {} })
    expect(at("/site/?hour=17.5")).toEqual({ screen: "site", query: { hour: "17.5" } })
  })

  test("a path no route matches, or with the wrong number of id segments, names no screen", () => {
    expect(at("/nope").screen).toBeNull()
    expect(at("/pieces/only-one").screen).toBeNull()
    expect(at("/npcs/a/b").screen).toBeNull()
    expect(at("/scale/extra").screen).toBeNull()
    expect(at("/lab").screen).toBeNull()
    expect(at("/pieces/%E0%A4%A/x").screen).toBeNull()
  })

  test("an old ?screen= link resolves to its screen, keeping every other parameter", () => {
    expect(at("/?screen=grips&t=0.3,0.7&bar=0")).toEqual({
      screen: "grips",
      query: { t: "0.3,0.7", bar: "0" },
    })
    expect(at("/?screen=nope").screen).toBeNull()
  })

  test("href moves an id of the route's shape into the path and keeps view state in the query", () => {
    expect(href("home")).toBe("/")
    expect(href("pieces", { id: "kaykit-adventurers/barbarian", clip: "Chopping" })).toBe(
      "/pieces/kaykit-adventurers/barbarian?clip=Chopping",
    )
    expect(href("npc", "?recipe=guard&seed=2&screen=npc")).toBe("/npcs/guard?seed=2")
    expect(href("grip", { piece: "kaykit-tools/axe" })).toBe("/grips/editor/kaykit-tools/axe")
    // Not the route's shape: the id stays a query parameter rather than making a path no route reads.
    expect(href("pieces", { id: "odd" })).toBe("/pieces?id=odd")
    expect(href("grips", { props: "kaykit-tools/axe,kaykit-tools/hammer" })).toBe(
      "/grips?props=kaykit-tools/axe,kaykit-tools/hammer",
    )
    expect(() => href("nowhere")).toThrow()
  })

  test("resolve and href round-trip", () => {
    for (const url of [
      "/",
      "/pieces/kaykit-adventurers/barbarian?clip=Chopping",
      "/composer/houses/cottage?seed=3&strip=1",
      "/npcs/guard?seed=1&strip=8&clip=work",
      "/grips/editor/kaykit-tools/axe?body=x",
      "/site?hour=17.5",
    ]) {
      const u = new URL(url, "http://x")
      const { screen, query } = resolve(u.pathname, u.search, "/")
      expect(href(screen as string, query, "/")).toBe(url)
    }
  })

  test("canonical takes a path, an old query with or without ?, and leaves an unknown URL as it was", () => {
    expect(canonical("/pieces?q=barrel")).toBe("/pieces?q=barrel")
    expect(canonical("?screen=pieces&id=kaykit-adventurers/barbarian")).toBe(
      "/pieces/kaykit-adventurers/barbarian",
    )
    expect(canonical("screen=grips&t=0.3")).toBe("/grips?t=0.3")
    expect(canonical("")).toBe("/")
    expect(canonical("?seed=2")).toBe("/?seed=2")
    expect(canonical("/?screen=composer&recipe=houses/demo&seed=1")).toBe("/composer/houses/demo?seed=1")
    expect(canonical("/pieces?id=kaykit-adventurers/barbarian")).toBe("/pieces/kaykit-adventurers/barbarian")
    expect(canonical("/nope?x=1")).toBe("/nope?x=1")
    expect(canonical("?screen=nope")).toBe("/?screen=nope")
  })

  test("under a base, paths carry it and app-relative paths gain it", () => {
    expect(resolve("/studio/pieces", "", "/studio/").screen).toBe("pieces")
    expect(resolve("/studio", "", "/studio/").screen).toBe("home")
    expect(resolve("/pieces", "", "/studio/").screen).toBeNull()
    expect(href("npc", { recipe: "guard" }, "/studio/")).toBe("/studio/npcs/guard")
    expect(canonical("/pieces", "/studio/")).toBe("/studio/pieces")
    expect(canonical("/studio/pieces", "/studio/")).toBe("/studio/pieces")
    expect(canonical("?screen=site&hour=6", "/studio/")).toBe("/studio/site?hour=6")
  })
})
