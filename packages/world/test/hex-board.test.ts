/**
 * The Guildhall's notice board (board.ts), set up by the world: on most islands, of KayKit pieces in the
 * world's own list (so the batch draws it and the collision layer has it), standing clear of every other
 * solid and off the roads, before the gathering where the hall's opening view sees it, its pinning spot
 * reachable on the walk graph; the same board for the same island.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { roadStrips, StripGrid } from "../src/hex/roads.ts"
import {
  BOARD_TALL,
  boardPieces,
  guildhallZone,
  HALL_VIEW,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  parseTilePrefabs,
  pieceOutline,
  pieceSolids,
  type Solid,
  SolidGrid,
  solidDistance,
  solidKind,
  workTiles,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

const ISLANDS: [number, number][] = []
for (const seed of [1, 2, 3, 4, 5, 6]) for (const files of [500, 4000, 12000]) ISLANDS.push([seed, files])

const built = ISLANDS.map(([seed, files]) => {
  const h = hexIsland({ seed, files })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  return { seed, files, h, z, w }
})

/** How many of the hall's views (its azimuth and 25° either way) see a point: no building or wall across. */
function seen(w: (typeof built)[number]["w"], x: number, y: number, zz: number): number {
  const tall: (Solid & { top: number })[] = []
  for (const p of w.pieces) {
    const kind = solidKind(p.piece)
    const o = pieceOutline(p.piece)
    if ((kind !== "building" && kind !== "wall") || !o || Math.hypot(p.x - x, p.z - zz) > 60) continue
    for (const s of pieceSolids(p)) tall.push({ ...s, top: p.y + o.top * p.scale })
  }
  const grid = new SolidGrid(tall)
  const el = (HALL_VIEW.elevation * Math.PI) / 180
  let n = 0
  for (const d of [-25, 0, 25]) {
    const a = ((HALL_VIEW.azimuth + d) * Math.PI) / 180
    const [dx, dy, dz] = [Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)]
    let hidden = false
    for (let s = 0.6; s < 40 && !hidden; s += 0.25)
      hidden = (grid.near(x + dx * s, zz + dz * s, 0) as (Solid & { top: number })[]).some(
        (o) => y + dy * s < o.top && solidDistance(o, x + dx * s, zz + dz * s) <= 0,
      )
    if (!hidden) n++
  }
  return n
}

describe("the notice board", () => {
  test("on nearly every island, its pieces among the world's, the same for the same island", () => {
    const boards = built.filter((b) => b.w.board)
    expect(boards.length).toBeGreaterThanOrEqual(ISLANDS.length - 1)
    for (const { seed, files, w } of boards) {
      const parts = boardPieces(w.board!)
      for (const p of parts)
        expect([seed, files, w.pieces.some((q) => JSON.stringify(q) === JSON.stringify(p))]).toEqual([
          seed,
          files,
          true,
        ])
    }
    const again = hexWorld(built[4]!.h, built[4]!.z)
    expect(again.board).toEqual(built[4]!.w.board)
  })

  test("clear of every other solid and off the roads, its posts and panel on the collision layer", () => {
    for (const { seed, files, h, w } of built) {
      if (!w.board) continue
      const parts = boardPieces(w.board)
      const own = new Set(parts.map((p) => `${p.piece}@${p.x},${p.z}`))
      const others = w.pieces.filter(
        (p) =>
          !own.has(`${p.piece}@${p.x},${p.z}`) && Math.hypot(p.x - w.board!.at[0], p.z - w.board!.at[2]) < 8,
      )
      const grid = new SolidGrid(others.flatMap((p) => pieceSolids(p)))
      const strips = new StripGrid(roadStrips(h, w))
      const mine = parts.flatMap((p) => pieceSolids(p))
      // the posts and the panel are solid
      expect(mine.length).toBeGreaterThanOrEqual(3)
      for (const s of mine)
        for (let k = 0; k < s.pts.length; k += 2) {
          const x = s.pts[k]!
          const z = s.pts[k + 1]!
          const hit = grid.near(x, z, 0.05).filter((o) => !o.soft && solidDistance(o, x, z) < 0.05)
          expect([seed, files, s.piece, hit.map((o) => o.piece)]).toEqual([seed, files, s.piece, []])
          expect([seed, files, strips.on(x, z, 0)]).toEqual([seed, files, false])
        }
    }
  })

  test("seen from the hall's opening view, a little taller than a hero", () => {
    let seenAll = 0
    let seenAny = 0
    let boards = 0
    for (const { w } of built) {
      if (!w.board) continue
      boards++
      const [x, y, z] = w.board.at
      const n = seen(w, x, y + 1.3, z)
      if (n >= 1) seenAny++
      if (n === 3) seenAll++
    }
    // (a keep among tall wards may hide it from one view or all: rarely)
    expect(seenAny / boards).toBeGreaterThan(0.9)
    expect(seenAll / boards).toBeGreaterThan(0.7)
    expect(BOARD_TALL).toBeGreaterThan(1.6)
  })

  test("its pinning spot reachable from the Guildhall on the walk graph, before its face", () => {
    let pins = 0
    for (const { seed, files, h, z, w } of built.filter((b) => b.files === 4000)) {
      const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
      const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
      const board = places.heroSpots.board()
      if (!board) continue
      pins++
      const heart = walk.hearts[guildhallZone(walk, z)]!
      expect([seed, files, walk.route(heart, board.spot.node) !== null]).toEqual([seed, files, true])
      // before its face, facing it
      const [bx, , bz] = board.at
      const out =
        (board.spot.at[0] - bx) * Math.sin(board.facing) + (board.spot.at[2] - bz) * Math.cos(board.facing)
      expect(out).toBeGreaterThan(0.5)
      expect(
        Math.cos(board.spot.facing - Math.atan2(bx - board.spot.at[0], bz - board.spot.at[2])),
      ).toBeCloseTo(1, 6)
    }
    expect(pins).toBeGreaterThanOrEqual(5)
  }, 60_000)
})
