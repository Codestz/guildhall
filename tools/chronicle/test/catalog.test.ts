import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseCatalog } from "@guildhall/sim/catalog"
import { buildCatalog, catalogEntry } from "../src/catalog.ts"
import { type Chronicle, readChronicle } from "../src/format.ts"

/** V1's shipped chronicles and the index.json `index` wrote for them (2026-10-09). */
const SHIPPED = join(import.meta.dir, "fixtures/chronicles")
const files = readdirSync(SHIPPED).filter((name) => name.endsWith(".json.gz"))
const shipped = async (file: string): Promise<Chronicle> =>
  readChronicle(new Uint8Array(readFileSync(join(SHIPPED, file))))

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

  test("building lists every chronicle once, most stars first, the newest build winning", async () => {
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

  test("rebuilt from the same chronicles, the committed index.json comes out the same", async () => {
    const committed = JSON.parse(readFileSync(join(SHIPPED, "index.json"), "utf8"))
    const rebuilt = buildCatalog(await Promise.all(files.map(shipped)), committed.updated)
    expect(rebuilt).toEqual(committed)
    // and the site reads what the builder writes
    expect(parseCatalog(JSON.parse(JSON.stringify(rebuilt, null, 1)))).toEqual(rebuilt)
  })
})
