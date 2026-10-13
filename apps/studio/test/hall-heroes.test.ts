/**
 * The heroes' spots in a repo's hall (world heroes.ts on the places sim `placeSpecs` makes from a
 * chronicle, plan-hud-events.md W2): guildhall's and react's halls, built as `/hall/<owner>/<repo>`
 * builds them (its seed, the chronicle's size and places), keep at least two reachable hero spots at
 * every place, clear of every solid, off the roads, that no townsfolk is ever given; and every unit
 * `bindPlaces` sends a path to has its place's spots.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readChronicle } from "@guildhall/sim"
import {
  guildhallZone,
  HERO_SPOTS_MIN,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  parseTilePrefabs,
  planFolk,
  workTiles,
} from "@guildhall/world"
import { heroReport } from "../../../packages/world/test/hero-checks.ts"
import { hallBinding, hallBuild, repoOf } from "../src/hexworld/hall.ts"
import { hallSeed } from "../src/site/routes.ts"

const TILES = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(TILES)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(TILES, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

const REPO_DIR = join(import.meta.dir, "../public/lab/repo")
const read = async (name: string) =>
  readChronicle(new Uint8Array(await Bun.file(join(REPO_DIR, `${name}.json.gz`)).arrayBuffer()))

describe("hero spots in a repo's hall", () => {
  for (const [name, slug] of [
    ["guildhall", "codestz/guildhall"],
    ["react", "facebook/react"],
  ] as const)
    test(`${slug}: every place keeps two at least, reachable, clear, nobody else's; every unit's place has them`, async () => {
      const repo = repoOf(await read(name), "local")
      const built = hallBuild(repo, 4000)
      const seed = hallSeed(slug)
      const h = hexIsland({ seed, files: built.files })
      const z = hexZones(h, built.places ? { places: built.places } : {})
      const w = hexWorld(h, z)
      const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
      const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
      const r = heroReport(h, z, w, walk, places)
      expect(r.notes).toEqual([])
      expect(r.least).toBeGreaterThanOrEqual(HERO_SPOTS_MIN)
      // every unit a path binds to is a place with spots of its own; the capital's too
      const binding = hallBinding(repo, z)
      expect(binding).not.toBeNull()
      for (const p of built.places ?? []) {
        const zi = binding!.zoneOfUnit(p.id)
        if (zi === undefined || !z.zones[zi]!.tiles.length) continue
        expect([p.id, places.heroSpots(zi).length >= HERO_SPOTS_MIN]).toEqual([p.id, true])
      }
      expect(places.heroSpots(binding!.capital).length).toBeGreaterThanOrEqual(HERO_SPOTS_MIN)
      expect(places.heroSpots(guildhallZone(walk, z)).every((s) => s.kind === "gather")).toBe(true)
      // the townsfolk never stand at one
      const spots = [...z.zones.keys()].flatMap((zi) => places.heroSpots(zi))
      const folk = planFolk(h, z, w, walk, { seed, pace: 144, places })
      let near = 0
      for (const f of folk)
        for (const s of f.day)
          if (s.kind === "stay" && !s.indoors)
            for (const hs of spots) if (Math.hypot(s.at[0] - hs.at[0], s.at[2] - hs.at[2]) < 0.5) near++
      expect(near).toBe(0)
    }, 60000)
})
