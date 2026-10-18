/**
 * A sketch hall says so (hall/hud/sketch.ts, SketchNotice.tsx): no notice where there is a chronicle;
 * where there is none, a notice whose one action is the chronicles repo's issue form, prefilled.
 */
import { describe, expect, test } from "bun:test"
import type { Chronicle, ChronicleResult } from "@guildhall/sim"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SketchNotice } from "../src/hall/hud/SketchNotice.tsx"
import {
  cardGuild,
  dismiss,
  noticeWords,
  SAME_LINK,
  sketchNoticeOf,
  wasDismissed,
} from "../src/hall/hud/sketch.ts"

const OK: ChronicleResult = {
  status: "ok",
  chronicle: {} as Chronicle,
  source: "cdn",
  generatedAt: "2026-10-01T00:00:00Z",
}
const NONE: ChronicleResult = { status: "not-chronicled", repo: "vercel/next.js" }
const DOWN: ChronicleResult = { status: "unavailable", repo: "vercel/next.js", reason: "offline" }

describe("sketchNoticeOf: has a chronicle, or not", () => {
  test("a chronicled hall has no notice", () => {
    expect(sketchNoticeOf(OK, "facebook/react")).toBeNull()
  })

  test("no chronicle: the notice, its action the issue form prefilled for the repo", () => {
    const notice = sketchNoticeOf(NONE, "vercel/next.js")
    expect(notice?.kind).toBe("not-chronicled")
    if (notice?.kind !== "not-chronicled") throw new Error("not a sketch")
    const url = new URL(notice.request)
    expect(url.origin + url.pathname).toBe("https://github.com/Codestz/guildhall-chronicles/issues/new")
    expect(url.searchParams.get("template")).toBe("chronicle.yml")
    expect(url.searchParams.get("repo")).toBe("vercel/next.js")
  })

  test("a chronicle that could not be read: a sketch too, its action a retry", () => {
    const notice = sketchNoticeOf(DOWN, "vercel/next.js")
    expect(notice).toEqual({ kind: "unavailable", slug: "vercel/next.js" })
    if (!notice) throw new Error("no notice")
    expect(noticeWords(notice).action).toEqual({ label: "Try again", retry: true })
  })
})

describe("noticeWords", () => {
  const notice = sketchNoticeOf(NONE, "vercel/next.js")
  if (!notice) throw new Error("no notice")

  test("a sketch: says so, offers to chronicle it, and that the link stays", () => {
    const words = noticeWords(notice)
    expect(words.title).toBe("A sketch island")
    expect(words.body).toContain("not yet grown from vercel/next.js's history")
    expect(words.action).toEqual({
      label: "Chronicle this repo",
      href: (notice as { request: string }).request,
    })
    expect(words.foot).toBe(SAME_LINK)
  })

  test("a request open: being chronicled, its action the request", () => {
    const url = "https://github.com/Codestz/guildhall-chronicles/issues/42"
    const words = noticeWords(notice, { status: "open", url, queued: false })
    expect(words.title).toBe("Being chronicled")
    expect(words.body).toContain("Check back soon")
    expect(words.action).toEqual({ label: "See the request", href: url })
    expect(noticeWords(notice, { status: "open", url, queued: true }).body).toContain("waiting its turn")
  })

  test("no request, or a search that failed: the plain sketch notice", () => {
    expect(noticeWords(notice, { status: "none" }).title).toBe("A sketch island")
    expect(noticeWords(notice, { status: "unavailable", reason: "HTTP 403" }).action.label).toBe(
      "Chronicle this repo",
    )
  })
})

describe("SketchNotice", () => {
  test("draws the notice with the issue form as its one link, opening in a new tab", () => {
    const notice = sketchNoticeOf(NONE, "vercel/next.js")
    if (!notice) throw new Error("no notice")
    const html = renderToStaticMarkup(createElement(SketchNotice, { notice, away: false }))
    expect(html).toContain("A sketch island")
    expect(html).toContain("Chronicle this repo")
    expect(html).toContain('target="_blank"')
    expect(html).toContain("template=chronicle.yml")
    expect(html).toContain('aria-label="Dismiss"')
  })

  test("out of the way while a panel is open", () => {
    const notice = sketchNoticeOf(NONE, "vercel/next.js")
    if (!notice) throw new Error("no notice")
    expect(renderToStaticMarkup(createElement(SketchNotice, { notice, away: true }))).toBe("")
  })
})

describe("cardGuild: the Share card on a sketch", () => {
  test("names the sketch island, never the repo's record alone", () => {
    expect(cardGuild("vercel/next.js", true)).toBe("vercel/next.js, a sketch island")
    expect(cardGuild("facebook/react", false)).toBe("facebook/react")
  })
})

describe("dismissal", () => {
  test("blocked or missing storage: never throws, never dismissed", () => {
    expect(() => dismiss("vercel/next.js")).not.toThrow()
    if (typeof localStorage === "undefined") expect(wasDismissed("vercel/next.js")).toBe(false)
  })
})
