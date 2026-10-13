/**
 * The tile prefabs as data (data/tiles, the tile composer's files): every file valid, every spot's clip
 * on the rig and every held prop gripped, and the registry that puts them in place of the code fallback.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  blockedDoors,
  CLIP_SECONDS,
  DRILLS,
  doorWays,
  drillFrame,
  FRONT_SIDE,
  installTilePrefabs,
  parseTilePrefabs,
  sideDir,
  spotsInPieces,
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

describe("scene checks (checks.ts), on every tile in data/tiles", () => {
  test("nothing stands in a door's approach: the strip out from every closed building's front", () => {
    expect(tiles.flatMap((t) => blockedDoors(t))).toEqual([])
  })

  test("no spot stands inside a piece (a sitter in its seat aside; buildings and walls move spots out themselves)", () => {
    expect(tiles.flatMap((t) => spotsInPieces(t))).toEqual([])
  })

  test("the town hall's door is clear: no sign before it, nobody standing in a pot", () => {
    const plaza = files["town-hall-plaza"] as TilePrefab
    expect(doorWays(plaza).length).toBe(1)
    expect(plaza.pieces.map((q) => q.piece)).not.toContain("kenney-nature/pot-small")
    expect(plaza.pieces.map((q) => q.piece)).toContain("kaykit-tools/map-empty")
  })

  test("a duel's two sides face each other across a sword's reach", () => {
    let pairs = 0
    for (const t of tiles)
      for (const a of t.spots ?? []) {
        if (!a.pair) continue
        const b = t.spots!.find((s) => s !== a && s.pair === a.pair)!
        const toB = Math.atan2(b.x - a.x, b.z - a.z)
        const off = Math.abs(Math.atan2(Math.sin(a.facing - toB), Math.cos(a.facing - toB)))
        expect([t.id, a.pair, off < 0.2]).toEqual([t.id, a.pair, true])
        const gap = Math.hypot(b.x - a.x, b.z - a.z)
        expect([t.id, a.pair, gap > 0.8 && gap < 1.3]).toEqual([t.id, a.pair, true])
        pairs++
      }
    expect(pairs).toBeGreaterThanOrEqual(4)
  })
})

describe("drills (drills.ts)", () => {
  /** What side `side` of the duel plays `dt` seconds after its move `clip` starts. */
  const at = (side: number, t: number) => drillFrame("duel", side, t).clip

  test("a duel interlocks: when a blow lands the other side parries, takes it or is dodging", () => {
    const duel = DRILLS.duel!
    // contact: how far into each attack its blade (or shield) arrives (rig-medium, read off the clips)
    const CONTACT: Record<string, number> = {
      Melee_1H_Attack_Chop: 0.57,
      Melee_1H_Attack_Slice_Diagonal: 0.42,
      Melee_1H_Attack_Slice_Horizontal: 0.27,
      Melee_1H_Attack_Stab: 0.45,
      Melee_Block_Attack: 0.47,
    }
    const DEFEND = new Set(["Melee_Block_Hit", "Melee_Blocking", "Hit_A", "Hit_B", "Dodge_Backward"])
    let blows = 0
    for (const [side, moves] of duel.sides.entries())
      for (const m of moves) {
        const hit = CONTACT[m.clip]
        if (hit === undefined) continue
        blows++
        expect(at(side, m.at + hit)).toBe(m.clip)
        expect([m.clip, DEFEND.has(at(1 - side, m.at + hit))]).toEqual([m.clip, true])
        // and the other side's answer starts at the blow, give or take a crossfade
        const answer = duel.sides[1 - side]!.find((o) => o.at > m.at - 0.01 && o.at <= m.at + hit + 0.01)
        if (answer) expect(Math.abs(answer.at - (m.at + hit))).toBeLessThan(0.6)
      }
    expect(blows).toBeGreaterThanOrEqual(6)
    // both sides attack and both defend
    for (const moves of duel.sides) expect(moves.some((m) => CONTACT[m.clip] !== undefined)).toBe(true)
  })

  test("a move plays once and is held to its end, then the rest; the loop wraps", () => {
    const f = drillFrame("duel", 0, 0.5)
    expect(f.clip).toBe("Melee_1H_Attack_Chop")
    expect(f.phase).toBeCloseTo(0.5 / CLIP_SECONDS.Melee_1H_Attack_Chop!, 5)
    expect(drillFrame("duel", 0, 1.2).clip).toBe(DRILLS.duel!.rest)
    expect(drillFrame("duel", 0, DRILLS.duel!.period + 0.5)).toEqual(f)
    // a drill line moves as one: the same frame for everyone on its clock
    expect(drillFrame("drill", 0, 3)).toEqual(drillFrame("drill", 0, 3))
  })

  test.skipIf(!existsSync(join(import.meta.dir, "../../../library/catalog/index.json")))(
    "the clip lengths drills use are rig-medium's (when the library is imported)",
    () => {
      const rigs = (
        JSON.parse(readFileSync(join(import.meta.dir, "../../../library/catalog/index.json"), "utf8")) as {
          rigs: { id: string; clips: { name: string; seconds: number }[] }[]
        }
      ).rigs
      const clips = new Map(rigs.find((r) => r.id === "rig-medium")?.clips.map((c) => [c.name, c.seconds]))
      for (const [name, s] of Object.entries(CLIP_SECONDS)) expect([name, clips.get(name)]).toEqual([name, s])
    },
  )
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
