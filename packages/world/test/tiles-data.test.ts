/**
 * The tile prefabs as data (data/tiles, the tile composer's files): every file valid, every spot's clip
 * on the rig and every held prop gripped, and the registry that puts them in place of the code fallback.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  FRONT_SIDE,
  installTilePrefabs,
  parseTilePrefabs,
  sideDir,
  TILE_PREFABS,
  type TilePrefab,
  tilePrefab,
  tilePrefabs,
  validateTilePrefab,
  worldSide,
} from "../src/index.ts"

const DATA = join(import.meta.dir, "../../../data")
const DIR = join(DATA, "tiles")
const files = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
const tiles = Object.values(files) as TilePrefab[]

afterEach(() => installTilePrefabs(null))

describe("data/tiles", () => {
  test("every file is a valid prefab named after its file", () => {
    for (const [id, json] of Object.entries(files))
      expect([id, validateTilePrefab(json, id)]).toEqual([id, []])
  })

  test("every prefab the world builds from code has its file", () => {
    for (const t of TILE_PREFABS) expect(files[t.id] === undefined ? t.id : "").toBe("")
  })

  test("variants name tiles that exist", () => {
    for (const t of tiles)
      for (const v of t.variants ?? []) expect(files[v] === undefined ? `${t.id} → ${v}` : "").toBe("")
  })

  test("the places people go have somewhere to be: spots on every building and work tile", () => {
    for (const id of [
      "tavern",
      "tavern-yard",
      "market",
      "market-stalls",
      "smithy",
      "archery",
      "field",
      "dock",
      "well-square",
    ])
      expect([id, (files[id] as TilePrefab).spots?.length ?? 0]).not.toEqual([id, 0])
  })

  test("every held prop has a grip in data/mounts.json", () => {
    const mounts = (
      JSON.parse(readFileSync(join(DATA, "mounts.json"), "utf8")) as { mounts: Record<string, unknown> }
    ).mounts
    for (const t of tiles)
      for (const s of t.spots ?? []) if (s.prop) expect(mounts[s.prop] ? "" : `${t.id}: ${s.prop}`).toBe("")
  })

  const index = join(import.meta.dir, "../../../library/catalog/index.json")
  test.skipIf(!existsSync(index))("every spot's clip is on rig-medium (when the library is imported)", () => {
    const rigs = (
      JSON.parse(readFileSync(index, "utf8")) as { rigs: { id: string; clips: { name: string }[] }[] }
    ).rigs
    const clips = new Set(rigs.find((r) => r.id === "rig-medium")?.clips.map((c) => c.name))
    for (const t of tiles)
      for (const s of t.spots ?? [])
        if (s.clip) expect(clips.has(s.clip) ? "" : `${t.id}: ${s.clip}`).toBe("")
  })
})

describe("the tile registry", () => {
  test("installed data reads before the code fallback, and null puts the fallback back", () => {
    const fallback = tilePrefab("tavern")
    const mine: TilePrefab = { id: "tavern", name: "Mine", ground: "dirt", pieces: [] }
    installTilePrefabs([mine])
    expect(tilePrefab("tavern")).toBe(mine)
    // what the data leaves out still reads the fallback
    expect(tilePrefab("woods")).toBe(TILE_PREFABS.find((t) => t.id === "woods"))
    expect(tilePrefabs().filter((t) => t.id === "tavern")).toEqual([mine])
    installTilePrefabs(null)
    expect(tilePrefab("tavern")).toBe(fallback)
  })

  test("parse keeps the valid files and says what is wrong with the rest", () => {
    const { prefabs, problems } = parseTilePrefabs({
      a: { id: "a", name: "A", ground: "grass", pieces: [] },
      b: { id: "b", name: "B", ground: "lava", pieces: [] },
    })
    expect(prefabs.map((t) => t.id)).toEqual(["a"])
    expect(problems.join()).toContain("tiles/b.json ground")
  })
})

describe("validateTilePrefab", () => {
  const ok: TilePrefab = {
    id: "x",
    name: "X",
    ground: "grass",
    pieces: [{ piece: "a/b", x: 0, z: 0, rot: 0, scale: 1 }],
  }
  test("a plain prefab passes", () => expect(validateTilePrefab(ok)).toEqual([]))
  test("refuses what the world cannot place", () => {
    const bad = (patch: Record<string, unknown>) => validateTilePrefab({ ...ok, ...patch }).join("; ")
    expect(bad({ id: "Not An Id" })).toContain("id")
    expect(bad({ pieces: [{ piece: "a/b", x: 9, z: 0, rot: 0, scale: 1 }] })).toContain("past the tile")
    expect(bad({ spots: [{ kind: "dance", x: 0, z: 0, facing: 0 }] })).toContain("kind")
    expect(bad({ spots: [{ kind: "sit", x: 0, z: 0, facing: 0, hours: [3] }] })).toContain("hours")
    expect(bad({ blockers: [{ x: 0, z: 0, r: 0 }] })).toContain("radius")
    expect(bad({ footprint: [6] })).toContain("footprint")
    expect(bad({ tier: 5 })).toContain("tier")
    expect(validateTilePrefab(ok, "y").join()).toContain("file's name")
  })
  test("a footprint lets pieces stand on the neighbour it claims", () => {
    const far = { piece: "a/b", x: 4.6, z: 0, rot: 0, scale: 1 }
    expect(validateTilePrefab({ ...ok, pieces: [far] }).length).toBeGreaterThan(0)
    expect(validateTilePrefab({ ...ok, pieces: [far], footprint: [0] })).toEqual([])
  })
})

describe("tile sides", () => {
  test("the front faces +z, and lands on the side the world turns it toward", () => {
    const [x, z] = sideDir(FRONT_SIDE)
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(1)
    for (let d = 0; d < 6; d++) expect(worldSide(FRONT_SIDE, d)).toBe(d)
  })
  test("turning a tile keeps its sides in order round it", () => {
    for (let d = 0; d < 6; d++) {
      const sides = [0, 1, 2, 3, 4, 5].map((k) => worldSide(k, d))
      expect(new Set(sides).size).toBe(6)
      expect(sides.map((w, k) => (w - sides[0]! - k + 12) % 6)).toEqual([0, 0, 0, 0, 0, 0])
    }
  })
})
