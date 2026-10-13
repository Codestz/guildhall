/**
 * Every authored spot can be walked to (seed 1, the authored tiles installed), and drinking places keep
 * apart. "Walked to": from the walk node life sends its user from (`nodeOf`), over open ground (on the
 * collision layer, collide.ts: never through a building, a wall or a fence, a body's core clear of their
 * real outlines; not over water), to within reach of the spot (a body and a step; a seat sits in its
 * bench, which a body steps round but is not walled in by).
 *
 * Excluded, each for a stated reason:
 *   unoffered    the spot's tile is not on or beside a place, nor a tile a place works (workTiles):
 *                life never offers it to anyone;
 *   off-graph    open country (a country or ground prefab) no road, door or spur comes within two tiles
 *                of (nodeOf −1): a field or a wood edge nobody farms or cuts; life leaves it out;
 *   walled       the collision layer (collide.ts, the pieces' real outlines) finds it walled in: no gap a
 *                body passes in the buildings, walls and fences round it (life leaves it out: `walled`).
 *                These are the tiles' to fix (WALLED lists the ones known), and stay few.
 * Nothing else in a town, a landmark or a scene may be excluded.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { HEX_TILE_SIZE } from "../src/hex/tiles.ts"
import {
  HARD,
  hexAt,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  kindOf,
  lifePlaces,
  parseTilePrefabs,
  solidDistance,
  tilePrefab,
  tileVariant,
  useOf,
  workTiles,
  worldSide,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

/**
 * Tiles with spots the collision layer finds walled in (reported to their authors). None today: the
 * pasture's ring has a gate and a walk round it, the monastery's garth opens toward its graveyard, and
 * the market's, the building site's and the castle ward's posts stand in the open.
 */
const WALLED = new Set<string>([])

const build = (seed: number) => {
  const h = hexIsland({ seed, files: 4000 })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  return { h, z, w, walk, places: lifePlaces(h, z, w, walk) }
}

/** Half a walker's width, metres; the grid the floor is flooded on. */
const BODY = 0.2
/** A body's core: how near a wall a body squeezes through a gap (walk.ts's tight ways). */
const CORE = 0.12
const CELL = 0.1
const WATER = new Set(["sea", "shallows", "lake", "river"])

describe("every authored spot on seed 1 can be walked to", () => {
  const { h, z, w, walk, places } = build(1)
  const g = h.grid
  const f = places.furniture
  const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
  const offered = new Set(workTiles(h, z))
  for (const zone of z.zones)
    for (const i of zone.tiles) {
      offered.add(i)
      for (const j of g.neighbours(i)) if (j >= 0) offered.add(j)
    }
  const overWater = (x: number, zz: number) => {
    const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
    const i = g.index(q, r)
    if (i < 0) return true
    const u = useOf(z, i)
    // a quay's stone deck out over the shallows is walked (world.ts `decks`)
    return WATER.has(kindOf(h, i)) && u !== "dock" && u !== "bridge" && w.stairAt(x, zz) === null
  }
  /** Why spot k cannot be walked to (null: it can), looking `room` metres round its node and itself. */
  const stuck = (k: number): string | null => stuckIn(k, 4) && stuckIn(k, 10)
  const stuckIn = (k: number, room: number): string | null => {
    const s = f.spots[k]!
    const n = places.nodeOf(k)
    if (n < 0) return "no walk node within two tiles"
    const node = walk.nodes[n]!
    const depth = Math.max(
      0,
      ...f.solidsNear(s.x, s.z, 0).flatMap((o) => (HARD(o.kind) ? [-solidDistance(o, s.x, s.z)] : [])),
    )
    if (depth > 0) return `inside a building, a wall or a fence by ${depth.toFixed(2)} m`
    // on the world's own grid, as walk.ts looks for ways
    const x0 = Math.floor((Math.min(node.x, s.x) - room) / CELL) * CELL
    const z0 = Math.floor((Math.min(node.z, s.z) - room) / CELL) * CELL
    const nx = Math.ceil((Math.max(node.x, s.x) + room - x0) / CELL)
    const nz = Math.ceil((Math.max(node.z, s.z) + room - z0) / CELL)
    const at = (a: number, b: number): [number, number] => [x0 + (a + 0.5) * CELL, z0 + (b + 0.5) * CELL]
    const open = new Uint8Array(nx * nz)
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < nz; b++) {
        const [x, zz] = at(a, b)
        open[a * nz + b] = f.blocked(x, zz, CORE, HARD) || overWater(x, zz) ? 0 : 1
      }
    // from the open ground round the node (a node under a well or a hall is moved out of it: walk.ts)
    const out = 1.6
    const seen = new Uint8Array(nx * nz)
    const queue: number[] = []
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < nz; b++) {
        const [x, zz] = at(a, b)
        if (open[a * nz + b] && Math.hypot(x - node.x, zz - node.z) <= out) {
          seen[a * nz + b] = 1
          queue.push(a * nz + b)
        }
      }
    const reach = depth + BODY + 0.25
    while (queue.length) {
      const c = queue.pop()!
      const a = Math.floor(c / nz)
      const b = c % nz
      const [x, zz] = at(a, b)
      if (Math.hypot(x - s.x, zz - s.z) <= reach) return null
      for (const [A, B] of [
        [a + 1, b],
        [a - 1, b],
        [a, b + 1],
        [a, b - 1],
      ] as const) {
        if (A < 0 || B < 0 || A >= nx || B >= nz) continue
        const id = A * nz + B
        if (seen[id] || !open[id]) continue
        seen[id] = 1
        queue.push(id)
      }
    }
    return "walled in: no way over open ground from its walk node"
  }

  const authored = [...f.spots.keys()].filter((k) => {
    const t = tileOf.get(f.spots[k]!.tile)
    return t?.prefab ? tileVariant(tilePrefab(t.prefab)!, t.i).spots !== undefined : false
  })
  const prefabOf = (k: number) => {
    const t = tileOf.get(f.spots[k]!.tile)!
    return tileVariant(tilePrefab(t.prefab!)!, t.i)
  }

  test("each is reachable, or excluded for a reason this file states", () => {
    const failures: string[] = []
    const excluded = { unoffered: 0, offGraph: 0, walled: 0 }
    let walked = 0
    for (const k of authored) {
      const s = f.spots[k]!
      const p = prefabOf(k)
      if (!offered.has(s.tile)) {
        excluded.unoffered++
        continue
      }
      if (places.walled(k)) {
        excluded.walled++
        expect([p.id, WALLED.has(p.id)]).toEqual([p.id, true])
        continue
      }
      const why = stuck(k)
      if (why === "no walk node within two tiles" && (p.group === "country" || p.group === "ground")) {
        excluded.offGraph++
        continue
      }
      walked++
      if (why)
        failures.push(`${p.id} (tile ${s.tile}) ${s.kind} at ${s.x.toFixed(1)},${s.z.toFixed(1)}: ${why}`)
    }
    expect(failures).toEqual([])
    expect(walked).toBeGreaterThan(1000)
    // the exclusions stay the exception
    expect(excluded.offGraph).toBeLessThan(walked / 20)
    expect(excluded.walled).toBeLessThan(walked / 25)
  }, 30000)

  test("the harbour's quay, the monastery's compound, a farmstead and the town hall's plaza stand here, every spot of theirs walked to", () => {
    for (const id of ["harbour-quay", "monastery-compound", "farmstead-yard", "town-hall-plaza"]) {
      const at = w.tiles.filter((t) => t.prefab === id)
      expect([id, at.length > 0]).toEqual([id, true])
      for (const t of at) {
        const mine = f.on(t.i)
        const dropped = f.dropped.filter((s) => s.tile === t.i).length
        expect(mine.length + dropped).toBe(tilePrefab(id)!.spots!.length)
        for (const k of mine) if (!places.walled(k)) expect([id, k, stuck(k)]).toEqual([id, k, null])
      }
    }
  })

  test("the quay's fishers stand on its deck, over the water, at the deck's height", () => {
    const quay = w.tiles.find((t) => t.prefab === "harbour-quay")!
    const fishers = f.on(quay.i).filter((k) => f.spots[k]!.roles?.includes("fisher"))
    expect(fishers.length).toBeGreaterThanOrEqual(3)
    for (const k of fishers) {
      const s = f.spots[k]!
      const { q, r } = hexAt(s.x / HEX_TILE_SIZE, s.z / HEX_TILE_SIZE)
      expect(kindOf(h, g.index(q, r))).toBe("shallows")
      expect(w.stairAt(s.x, s.z)).toBeCloseTo(quay.top, 5)
    }
  })

  test("all fourteen garden seats of the town's canteen are reachable, and open at its hours", () => {
    const town = z.zones.findIndex((zone) => zone.kind === "town")
    const canteen = w.tiles.find((t) => t.prefab === "tavern-garden" && z.zoneOf[t.i] === town + 1)
    expect(canteen).toBeDefined()
    const seats = f.on(canteen!.i).filter((k) => f.spots[k]!.kind === "sit" || f.spots[k]!.kind === "talk")
    expect(seats).toHaveLength(14)
    for (const k of seats) expect(stuck(k)).toBeNull()
    // the free list life picks from offers every one of them
    const offer = new Set(places.free(town, null, ["sit", "talk"]))
    for (const k of seats) expect(offer.has(k)).toBe(true)
  })
})

describe("drinking places keep apart", () => {
  const DRINKS = new Set(["tavern", "tavern-yard", "tavern-garden"])
  test("no two taverns or canteens (a canteen's garden included) stand within two tiles of each other", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { h, w } = build(seed)
      const g = h.grid
      const steps = (a: number, b: number) => {
        const dq = g.q[a]! - g.q[b]!
        const dr = g.r[a]! - g.r[b]!
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
      }
      const drinks = w.tiles
        .filter((t) => t.prefab && DRINKS.has(t.prefab))
        .map((t) => {
          const p = tilePrefab(t.prefab!)!
          const nb = g.neighbours(t.i)
          return [t.i, ...(p.footprint ?? []).map((k) => nb[worldSide(k, t.door!)]!)]
        })
      expect(drinks.length).toBeGreaterThan(1)
      for (let a = 0; a < drinks.length; a++)
        for (let b = a + 1; b < drinks.length; b++)
          for (const i of drinks[a]!) for (const j of drinks[b]!) expect(steps(i, j)).toBeGreaterThan(2)
    }
  })
})
