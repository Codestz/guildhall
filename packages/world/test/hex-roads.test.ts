/**
 * Roads are sacred (decisions.md, user 10-12: a road into seed 1's camp ran under its archery ranges):
 * the strips' geometry, and the islands the Studio opens (the chosen nature, 4000 files) kept clear of
 * them. The fuzz sweep over the knob extremes is hex-sites.test.ts.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { boxSolid } from "../src/hex/collide.ts"
import { roadReport, type Strip, stripIntrusion } from "../src/hex/roads.ts"
import {
  hexIsland,
  hexWorld,
  hexZones,
  installTilePrefabs,
  NATURE_CHOSEN,
  parseTilePrefabs,
  useOf,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

const strip: Strip = { ax: 0, az: 0, bx: 4, bz: 0, half: 0.85, tile: 0, into: -1, kind: "road" }

describe("a strip's intrusion", () => {
  test("is how far a solid reaches in from the strip's nearer edge", () => {
    // a 1 m box whose near face is 0.3 m inside the strip's edge (z from 0.55 to 1.55)
    expect(stripIntrusion(strip, boxSolid("prop", 2, 1.05, 1, 0, 1, 1, 0))).toBeCloseTo(0.3, 5)
    // one across the middle covers it all
    expect(stripIntrusion(strip, boxSolid("prop", 2, 0, 1, 0, 1, 1, 0))).toBeCloseTo(0.85, 5)
    // one beside it, clear
    expect(stripIntrusion(strip, boxSolid("prop", 2, 1.5, 1, 0, 1, 1, 0))).toBe(0)
    // past its end, clear; within its doorstep, left to the door
    expect(stripIntrusion(strip, boxSolid("prop", 4.7, 0, 1, 0, 1, 1, 0))).toBe(0)
    expect(stripIntrusion(strip, boxSolid("prop", 3.8, 0, 1, 0, 1, 1, 0), 0.9)).toBe(0)
  })
})

describe("the islands the Studio opens", () => {
  const worlds = [1, 2, 3, 4, 5, 6].map((seed) => {
    const h = hexIsland({ seed, files: 4000 })
    const z = hexZones(h, { wild: NATURE_CHOSEN.wild })
    const w = hexWorld(h, z, { nature: NATURE_CHOSEN })
    return { seed, h, z, w }
  })

  test("keep every road clear, its ends open and its width (trees grown to their edges too)", () => {
    for (const { h, z, w } of worlds) {
      const r = roadReport(h, z, w)
      expect(r.notes.filter((n) => !n.startsWith("court")).slice(0, 5)).toEqual([])
      expect([r.covered, r.ends, r.narrow, r.through]).toEqual([0, 0, 0, 0])
    }
  })

  test("a place's heart the roads come to is an open square, paved to each of them", () => {
    for (const { z, w } of worlds) {
      const byTile = new Map(w.tiles.map((t) => [t.i, t]))
      for (const zone of z.zones) {
        if (zone.kind === "castle" || !zone.tiles.length) continue
        const reached = z.roads.some((r) => r.tiles.includes(zone.tile))
        const heart = byTile.get(zone.tile)!
        if (!reached) continue
        expect(heart.prefab).toBeNull()
        expect(heart.paths?.length).toBeGreaterThan(0)
      }
    }
  })

  test("seed 1's camps: one archery range each, its heart open, its landmark beside it", () => {
    const { z, w } = worlds[0]!
    const prefab = new Map(w.tiles.map((t) => [t.i, t.prefab]))
    const camps = z.zones.filter((zone) => zone.kind === "camp")
    expect(camps.length).toBeGreaterThan(0)
    for (const camp of camps) {
      const ranges = camp.tiles.filter(
        (i) => prefab.get(i) === "archery-range" || prefab.get(i) === "archery",
      )
      expect(ranges.length).toBe(1)
      expect(useOf(z, camp.tile)).toBe("square")
      expect(prefab.get(camp.tile)).toBeNull()
    }
  })
})
