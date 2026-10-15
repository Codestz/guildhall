/**
 * The demos open in place (site/nav.ts): while the site holds an opener, a move to `/demos` opens the
 * picker over the page and the address stays; any other move goes on as before; with no opener (a direct
 * visit, the not-found page) `/demos` is a move like any other.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { openDemosWith, openUrl } from "../src/site/nav.ts"
import { destHref } from "../src/site/routes.ts"

const g = globalThis as unknown as Record<string, unknown>
let opened: string[] = []

beforeEach(() => {
  opened = []
  g.location = new URL("http://guildhall.test/hall/Codestz/mcpx")
  g.window = { guildhall: { open: (url: string) => opened.push(url) } }
})
afterEach(() => {
  openDemosWith(null)
  delete g.location
  delete g.window
})

describe("the demos in place", () => {
  test("a move to /demos opens the picker over the page, and nothing moves", () => {
    let shown = 0
    openDemosWith(() => shown++)
    openUrl(destHref("demos"))
    expect(shown).toBe(1)
    expect(opened).toEqual([])
  })

  test("a story, a hall, the island: moves as before", () => {
    openDemosWith(() => {
      throw new Error("not the demos")
    })
    for (const url of ["/?story=saga", "/hall/facebook/react", "/", "/harbour"]) openUrl(url)
    expect(opened).toEqual(["/?story=saga", "/hall/facebook/react", "/", "/harbour"])
  })

  test("with no opener, /demos is a move", () => {
    openUrl(destHref("demos"))
    expect(opened).toEqual(["/demos"])
  })
})
