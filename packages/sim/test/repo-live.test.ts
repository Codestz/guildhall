import { describe, expect, test } from "bun:test"
import { chronicleFor, loadCatalog, requestChronicleUrl } from "../src/index.ts"

/**
 * The real backend (jsDelivr, Codestz/guildhall-chronicles): every listed repo's chronicle decodes,
 * and the catalog parses with nothing dropped. Network: it runs only with LIVE=1, so `bun run check`
 * stays offline and deterministic.
 *
 *   LIVE=1 bun test packages/sim/test/repo-live.test.ts
 */
const live = process.env.LIVE ? describe : describe.skip

live("the live chronicles backend", () => {
  test("the catalog parses whole and every listed chronicle decodes", async () => {
    const result = await loadCatalog()
    if (result.status !== "ok") throw new Error(`catalog: ${result.reason}`)
    const { catalog } = result
    expect(catalog.repos.length).toBeGreaterThan(0)
    console.log(`catalog ${catalog.updated}: ${catalog.repos.map((r) => r.repo).join(", ")}`)

    for (const entry of catalog.repos) {
      const [owner, name] = entry.repo.split("/") as [string, string]
      const got = await chronicleFor(owner, name, { localBase: "http://127.0.0.1:1/" })
      if (got.status !== "ok") throw new Error(`${entry.repo}: ${got.status}`)
      expect(got.source).toBe("cdn")
      expect(got.chronicle.repo.name.toLowerCase()).toBe(entry.repo.toLowerCase())
      expect(got.generatedAt.slice(0, 10)).toBe(entry.built)
      expect(got.chronicle.repo.files).toBe(entry.files)
      expect(got.chronicle.units.length).toBeGreaterThan(0)
    }
  }, 120_000)

  test("an unchronicled repo is not-chronicled, and the request link is built", async () => {
    const got = await chronicleFor("codestz", "no-such-repo-here")
    expect(got.status).toBe("not-chronicled")
    expect(requestChronicleUrl("codestz", "no-such-repo-here")).toContain("issues/new")
  })
})
