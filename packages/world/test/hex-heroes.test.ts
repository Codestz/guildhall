/**
 * The heroes' spot pool (heroes.ts, plan-hud-events.md W2): every place sets aside at least two spots
 * for the agents, reachable, clear of every solid, off the roads and out of the doorways, that no
 * townsfolk is ever given; the Guildhall's are a gathering before its great hall. The pool changes
 * nobody's day, is the same for the same island, and a place that stays as the island grows keeps it.
 * A hero walks to one on the walk graph (`heroRoute`), from a stay or from mid-walk (`heroFrom`).
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  BOARD_PIN,
  GATHER_PER_SPOT,
  guildhallZone,
  HERO_SPOTS_MIN,
  HEX_TILE_SIZE,
  heroFrom,
  heroRoute,
  hexAt,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  lifePose,
  type PlaceSpec,
  parseTilePrefabs,
  planFolk,
  workTiles,
} from "../src/index.ts"
import { heroReport } from "./hero-checks.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

const K = 3
/** The hex a point stands on. */
const qr = (at: readonly number[]): [number, number] => {
  const { q, r } = hexAt(at[0]! / HEX_TILE_SIZE, at[2]! / HEX_TILE_SIZE)
  return [q, r]
}
/** A small monorepo's units as places (hex-places.test.ts's). */
const spec = (id: string, files: number, extra: Partial<PlaceSpec> = {}): PlaceSpec => ({
  id,
  label: id.split("/").pop() ?? id,
  kind: "settlement",
  tier: files >= 1000 ? 3 : files >= 60 ? 2 : 1,
  files,
  ...extra,
})
const REPO: PlaceSpec[] = [
  spec("packages/hall", 2400, { capital: true }),
  spec("/", 20, { kind: "harbour" }),
  spec("test", 300, { kind: "camp" }),
  spec("docs", 120, { kind: "monastery" }),
  spec("scripts", 80, { kind: "mine" }),
  spec("packages/core", 400),
  spec("packages/world", 900),
  spec("packages/sim", 70),
  spec("packages/ui", 30),
]
const REPO_FILES = REPO.reduce((n, s) => n + s.files, 0)

const build = (seed: number, files = 4000, heroSpots = K, places?: PlaceSpec[]) => {
  const h = hexIsland({ seed, files })
  const z = hexZones(h, places ? { places } : {})
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  return { h, z, w, walk, places: lifePlaces(h, z, w, walk, { heroSpots }) }
}

describe("every place keeps hero spots", () => {
  for (const [seed, files] of [
    [1, 4000],
    [2, 4000],
    [3, 4000],
    [4, 1500],
    [5, 12000],
  ] as const)
    test(`seed ${seed}, ${files} files: two at least per place, each reachable, clear, off the roads, nobody else's`, () => {
      const { h, z, w, walk, places } = build(seed, files)
      const r = heroReport(h, z, w, walk, places)
      expect(r.notes).toEqual([])
      expect(r.places).toBeGreaterThan(15)
      expect(r.least).toBeGreaterThanOrEqual(HERO_SPOTS_MIN)
      // the Guildhall gathers up to twice as many, inside its curtain wall, as its courts have room for
      const home = guildhallZone(walk, z)
      const gather = places.heroSpots(home)
      expect(gather.length).toBeGreaterThanOrEqual(HERO_SPOTS_MIN)
      expect(gather.length).toBeLessThanOrEqual(K * GATHER_PER_SPOT)
      // (the notice board and its pinning spot may take one seat's room in a crowded court)
      if (files >= 4000) expect(gather.length).toBeGreaterThanOrEqual(K * GATHER_PER_SPOT - (w.board ? 1 : 0))
      for (const s of gather) expect(z.zones[home]!.tiles).toContain(h.grid.index(...qr(s.at)))
      for (const s of places.heroSpots(home)) expect([s.kind, s.pose]).toEqual(["gather", "gather"])
    }, 30000)
})

describe("the pool", () => {
  const a = build(1)

  test("each place's spots are its own work, by what stands there; the Guildhall's face its hall", () => {
    const { z, walk, places } = a
    const home = guildhallZone(walk, z)
    const poses = new Map<string, Set<string>>()
    for (const zi of z.zones.keys()) {
      for (const s of places.heroSpots(zi)) {
        expect(s.zone).toBe(zi)
        expect(s.kind).toBe(zi === home ? "gather" : "work")
        expect(s.ground).toBe(true)
        expect(Number.isFinite(s.facing)).toBe(true)
        const kind = z.zones[zi]!.kind
        if (!poses.has(kind)) poses.set(kind, new Set())
        poses.get(kind)!.add(s.pose)
      }
    }
    expect(poses.get("town")?.has("anvil")).toBe(true)
    expect(poses.get("harbour")?.has("dock")).toBe(true)
    expect(poses.get("camp")?.has("drill")).toBe(true)
    expect(poses.get("lumber")?.has("chop")).toBe(true)
    expect(poses.get("farm")?.has("field")).toBe(true)
  })

  test("the same island gives the same pool; none asked for, none set aside", () => {
    const b = build(1)
    for (const zi of a.z.zones.keys()) expect(b.places.heroSpots(zi)).toEqual(a.places.heroSpots(zi))
    const none = build(1, 4000, 0)
    for (const zi of a.z.zones.keys()) expect(none.places.heroSpots(zi)).toEqual([])
  })

  test("the townsfolk's days are the same with the pool, and nobody's stay is at a hero's spot", () => {
    const { h, z, w, walk, places } = a
    const spots = [...z.zones.keys()].flatMap((zi) => places.heroSpots(zi))
    const withPool = planFolk(h, z, w, walk, { seed: 1, pace: 144, places })
    const plain = build(1, 4000, 0)
    const without = planFolk(plain.h, plain.z, plain.w, plain.walk, {
      seed: 1,
      pace: 144,
      places: plain.places,
    })
    expect(withPool).toEqual(without)
    let stays = 0
    for (const f of withPool)
      for (const s of f.day) {
        if (s.kind !== "stay" || s.indoors) continue
        stays++
        for (const hs of spots)
          expect(Math.hypot(s.at[0] - hs.at[0], s.at[2] - hs.at[2])).toBeGreaterThan(0.5)
      }
    expect(stays).toBeGreaterThan(500)
  }, 30000)

  test("a place that stays as the island grows keeps its spots", () => {
    /** The places of `b` built like `a`'s (same kind, heart and tiles, the ground round them alike) keep `a`'s spots. */
    const kept = (a: ReturnType<typeof build>, b: ReturnType<typeof build>): number => {
      const look = (w: typeof a.w, i: number) => {
        const t = w.tiles.find((tt) => tt.i === i)
        return t ? `${t.prefab}:${t.rot}:${t.door}:${t.top}:${t.paths?.join("")}` : "-"
      }
      let same = 0
      for (const [zi, zone] of a.z.zones.entries()) {
        const zj = b.z.zones.findIndex((o) => o.tile === zone.tile && o.kind === zone.kind)
        const other = b.z.zones[zj]
        if (!other || other.tiles.join() !== zone.tiles.join() || !zone.tiles.length) continue
        const round = new Set<number>()
        for (const i of zone.tiles) for (const j of [i, ...a.h.grid.neighbours(i)]) if (j >= 0) round.add(j)
        if ([...round].some((i) => look(a.w, i) !== look(b.w, i))) continue
        same++
        const at = (s: { at: number[]; pose: string }) =>
          `${s.at[0]!.toFixed(3)},${s.at[2]!.toFixed(3)},${s.pose}`
        expect([zi, a.places.heroSpots(zi).map(at)]).toEqual([zi, b.places.heroSpots(zj).map(at)])
      }
      return same
    }
    // the island grows (the castle stays where it is: sites.ts reserves it)
    let same = kept(build(1), build(1, 4400))
    // a repo's unit grows a tier on the same island: every other place stays
    for (const seed of [1, 2]) {
      const grown = REPO.map((s) => (s.id === "packages/sim" ? spec(s.id, 300) : s))
      same += kept(build(seed, REPO_FILES, K, REPO), build(seed, REPO_FILES, K, grown))
    }
    expect(same).toBeGreaterThan(8)
  }, 30000)
})

describe("a hero's walk to its spot", () => {
  const { h, z, walk, places } = build(2)
  const home = guildhallZone(walk, z)
  const hall = places.heroSpots(home)[0]!

  test("from the Guildhall to every place's first spot and back, on the walk graph, arriving at the spot", () => {
    let walks = 0
    for (const zi of z.zones.keys()) {
      const spot = places.heroSpots(zi)[0]
      if (!spot || zi === home) continue
      const go = heroRoute(walk, hall, spot, { leave: 10, mps: 1, near: places.walkNear })
      expect(go).not.toBeNull()
      expect(go!.from).toBe(10)
      expect(go!.pts[0]).toEqual(hall.at)
      expect(go!.pts.at(-1)).toEqual(spot.at)
      for (let k = 1; k < go!.times.length; k++)
        expect(go!.times[k]!).toBeGreaterThanOrEqual(go!.times[k - 1]!)
      // sampled as a step, the walk ends at the spot
      const end = lifePose([go!], go!.to - 1e-6, 1e9)
      expect(Math.hypot(end.at[0] - spot.at[0], end.at[2] - spot.at[2])).toBeLessThan(0.05)
      const back = heroRoute(walk, spot, hall, { leave: go!.to + 30 })
      expect(back?.pts.at(-1)).toEqual(hall.at)
      walks++
    }
    expect(walks).toBeGreaterThan(15)
    // already there: no walk
    expect(heroRoute(walk, hall, hall)).toBeNull()
  })

  test("sent elsewhere mid-walk, a hero starts from the node nearest where it is", () => {
    const zi = z.zones.findIndex((zone, i) => i !== home && zone.kind === "harbour")
    const spot = places.heroSpots(zi)[0]!
    const go = heroRoute(walk, hall, spot, { mps: 1 })!
    const mid = lifePose([go], (go.from + go.to) / 2, 1e9)
    const from = heroFrom(walk, h, mid.at, mid.facing)
    expect(from.node).toBeGreaterThanOrEqual(0)
    const n = walk.nodes[from.node]!
    expect(Math.hypot(n.x - mid.at[0], n.z - mid.at[2])).toBeLessThan(12)
    const other = places.heroSpots(
      z.zones.findIndex((zone, i) => i !== home && i !== zi && zone.kind === "camp"),
    )[0]!
    const turn = heroRoute(walk, from, other, { leave: (go.from + go.to) / 2 })
    expect(turn?.pts[0]).toEqual(mid.at)
    expect(turn?.pts.at(-1)).toEqual(other.at)
  })
})

describe("the gathering two by two, and the notice board", () => {
  const islands = [1, 2, 3, 5].map((seed) => ({ seed, ...build(seed) }))

  test("heroes at rest pair off: most gathering spots face a partner 1.25 m across", () => {
    let paired = 0
    let all = 0
    for (const { z, walk, places } of islands) {
      const gather = places.heroSpots(guildhallZone(walk, z))
      all += gather.length
      for (const s of gather) {
        const mate = gather.find(
          (o) => o !== s && Math.abs(Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]) - 1.25) < 1e-6,
        )
        if (!mate) continue
        // facing each other
        expect(Math.cos(s.facing - Math.atan2(mate.at[0] - s.at[0], mate.at[2] - s.at[2]))).toBeCloseTo(1, 6)
        paired++
      }
    }
    expect(paired / all).toBeGreaterThan(0.5)
  })

  test("the board is the world's (board.ts): a pinning spot before it and briefing spots, clear of the gathering", () => {
    let boards = 0
    for (const { seed, h, z, w, walk, places } of islands) {
      const home = guildhallZone(walk, z)
      const board = places.heroSpots.board()
      if (!board) continue
      boards++
      const [bx, , bz] = board.at
      expect([board.at, board.facing]).toEqual([w.board!.at, w.board!.facing])
      // on the Guildhall's ground, or the open ground beside it no other place has
      const tile = h.grid.index(...qr(board.at))
      const beside = z.zones[home]!.tiles.some((i) => h.grid.neighbours(i).includes(tile)) && !z.zoneOf[tile]
      expect([seed, z.zones[home]!.tiles.includes(tile) || beside]).toEqual([seed, true])
      const spot = board.spot
      expect([spot.kind, spot.pose, spot.zone]).toEqual(["work", "board", home])
      expect(spot.node).toBeGreaterThanOrEqual(0)
      expect(places.furniture.blocked(spot.at[0], spot.at[2], 0.3)).toBe(false)
      // the pinning spot faces the board, BOARD_PIN before it (a little further or to one side at most)
      const d = Math.hypot(spot.at[0] - bx, spot.at[2] - bz)
      expect(d).toBeGreaterThanOrEqual(BOARD_PIN - 1e-6)
      expect(d).toBeLessThan(BOARD_PIN + 0.8)
      expect(Math.cos(spot.facing - Math.atan2(bx - spot.at[0], bz - spot.at[2]))).toBeCloseTo(1, 6)
      expect(board.brief.length).toBeGreaterThan(0)
      for (const b of [spot, ...board.brief])
        for (const g of places.heroSpots(home))
          expect(Math.hypot(g.at[0] - b.at[0], g.at[2] - b.at[2])).toBeGreaterThan(0.85)
      // the same island, the same board
      expect(build(seed).places.heroSpots.board()).toEqual(board)
    }
    expect(boards).toBeGreaterThanOrEqual(3)
    expect(build(1, 4000, 0).places.heroSpots.board()).toBeNull()
  }, 30000)
})
