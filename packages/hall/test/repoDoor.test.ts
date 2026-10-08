import { describe, expect, test } from "bun:test"
import { addToArchipelago, islandLink, shareLink } from "../src/hud/repoLinks.ts"
import { DEFAULT_ARCHIPELAGO, MAX_ISLANDS } from "../src/world/archipelago.ts"
import { GitHubError } from "../src/world/gen/fetch.ts"
import { failureOf } from "../src/world/gen/load.ts"

describe("the repo door's links", () => {
  test("an island link keeps the page's params, drops its places, and reads plainly", () => {
    expect(islandLink("Codestz/mcpx", "")).toBe("?repo=Codestz/mcpx")
    expect(islandLink("Codestz/mcpx", "?showcase&t=6:00&look=quarry&select=Guildmaster&repo=a/b")).toBe(
      "?showcase&t=6:00&repo=Codestz/mcpx",
    )
  })

  test("a share link is just the island (and the showcase, if this page is it)", () => {
    expect(shareLink("facebook/react", "?story=rush&hour=23")).toBe("?repo=facebook/react")
    expect(shareLink("facebook/react", "?showcase&hour=23")).toBe("?showcase&repo=facebook/react")
  })

  test("adding to the archipelago appends to ?repos= and starts on the new island", () => {
    expect(addToArchipelago("Codestz/mcpx", "")).toEqual({
      ok: true,
      already: false,
      search: "?repos=Codestz/mcpx&island=Codestz/mcpx",
    })
    const added = addToArchipelago("facebook/react", "?archipelago&island=map")
    expect(added).toEqual({
      ok: true,
      already: false,
      search: `?repos=${[...DEFAULT_ARCHIPELAGO, "facebook/react"].join(",")}&island=facebook/react`,
    })
  })

  test("a repo already there is flown to, not added twice; the home repo is home", () => {
    expect(addToArchipelago("codestz/MCPX", "?repos=Codestz/mcpx")).toEqual({
      ok: true,
      already: true,
      search: "?repos=Codestz/mcpx&island=codestz/MCPX",
    })
    expect(addToArchipelago("Codestz/guildhall", "?repos=Codestz/mcpx")).toMatchObject({
      ok: true,
      already: true,
      search: "?repos=Codestz/mcpx&island=home",
    })
  })

  test("a full archipelago says so", () => {
    const full = Array.from({ length: MAX_ISLANDS }, (_, i) => `acme/r${i}`).join(",")
    expect(addToArchipelago("acme/one-more", `?repos=${full}`)).toEqual({ ok: false, reason: "full" })
  })
})

describe("repo failures, by kind", () => {
  test("missing, rate limited (with its reset), other answers and no network", () => {
    expect(failureOf(new GitHubError("x", 404), "acme/tool").kind).toBe("missing")
    const limited = failureOf(
      new GitHubError(
        "GitHub's rate limit for unauthenticated calls (60 an hour) is used up (resets at 2026-10-08T10:14:00.000Z)",
        403,
      ),
      "acme/tool",
    )
    expect(limited.kind).toBe("rate")
    expect(limited.resetAt?.toISOString()).toBe("2026-10-08T10:14:00.000Z")
    expect(failureOf(new GitHubError("x", 500), "acme/tool").kind).toBe("github")
    const offline = failureOf(new TypeError("fetch failed"), "acme/tool")
    expect(offline.kind).toBe("network")
    expect(offline.message).toBe("couldn't reach GitHub for acme/tool")
  })
})
