import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { STYLE_PACKS } from "@guildhall/assets"
import { CASTLE_TILES, HEX_LAND_MAX, landTiles } from "@guildhall/world"
import { BUILT } from "../src/site/built.ts"

const ROOT = join(import.meta.dir, "../../..")
/** Everything the page says, as one string. */
const page = JSON.stringify(BUILT)

/** The authored tile prefabs, read the way the page counts them. */
function tiles(): { n: number; spots: number; blockers: number } {
  const dir = join(ROOT, "data/tiles")
  let n = 0
  let spots = 0
  let blockers = 0
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue
    const tile = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      spots?: unknown[]
      blockers?: unknown[]
    }
    n += 1
    spots += tile.spots?.length ?? 0
    blockers += tile.blockers?.length ?? 0
  }
  return { n, spots, blockers }
}

const fmt = (n: number) => n.toLocaleString("en-US")

describe("How it's built states the repo's own numbers", () => {
  test("the tile prefabs, their spots and blockers match data/tiles", () => {
    const t = tiles()
    expect(page).toContain(`"n":"${t.n}","unit":"tiles"`)
    expect(page).toContain(`with ${t.spots} spots for people`)
    expect(page).toContain(
      `${t.spots} spots and ${t.blockers} blockers are authored as data on ${t.n} tile prefabs`,
    )
  })

  test("the land cap and where it is reached match the island's rule", () => {
    expect(page).toContain(`"n":"${fmt(HEX_LAND_MAX)}","unit":"tiles"`)
    expect(page).toContain(`capped at ${fmt(HEX_LAND_MAX)}`)
    // "reached at about 11k files"
    expect(landTiles(10_000)).toBeLessThan(HEX_LAND_MAX)
    expect(landTiles(11_000)).toBe(HEX_LAND_MAX)
  })

  test("the castle has the four tiers the page names", () => {
    // a keep, a walled keep, wards and the great hall, a citadel (world sites.ts)
    expect(CASTLE_TILES.length).toBe(4)
    expect(page).toContain("four tiers")
  })

  test("the piece count matches the house-style library, when it is on this machine", () => {
    const dir = join(ROOT, "library/catalog")
    if (!existsSync(dir)) return
    let pieces = 0
    let packs = 0
    for (const pack of STYLE_PACKS) {
      const list = JSON.parse(readFileSync(join(dir, `${pack}.json`), "utf8")) as unknown[]
      pieces += list.length
      if (list.length > 0) packs += 1
    }
    expect(page).toContain(`${fmt(pieces)} pieces from ${packs} asset packs`)
  })
})
