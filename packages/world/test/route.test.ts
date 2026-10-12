import { describe, expect, test } from "bun:test"
import { roll } from "@guildhall/core"
import type { Vec2 } from "../src/geom/index.ts"
import {
  type CostGrid,
  cellAt,
  cellCentre,
  gridAStar,
  lineCost,
  smoothRoute,
  stringPull,
} from "../src/geom/route.ts"
import { COSTS, costField, OCCUPANTS, type Occupancy } from "../src/island/cost.ts"
import { GROUND_KINDS, type GroundGrid, type RoadNetwork } from "../src/island/types.ts"

/** world route + island cost: the A* router, its string-pull and smoothing, and the cost tables (ADR 012). */

const INF = Number.POSITIVE_INFINITY
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

function grid(w: number, h: number, fill = 1): CostGrid {
  return { w, h, cost: new Float32Array(w * h).fill(fill) }
}

/** The path's cost by gridAStar's own rule: length times the mean of the two cells, plus `step`. */
function pathCost(g: CostGrid, path: readonly number[]): number {
  let sum = 0
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!
    const b = path[k]!
    const diagonal = a % g.w !== b % g.w && Math.floor(a / g.w) !== Math.floor(b / g.w)
    sum += ((diagonal ? Math.SQRT2 : 1) * (g.cost[a]! + g.cost[b]!)) / 2 + (g.step ? g.step(a, b) : 0)
  }
  return sum
}

/** A plain O(n²) Dijkstra with the same moves: the reference the A* must match. */
function dijkstra(g: CostGrid, from: number, to: number): number {
  const n = g.w * g.h
  const best = new Array<number>(n).fill(INF)
  const done = new Array<boolean>(n).fill(false)
  best[from] = 0
  const open = (i: number) => Number.isFinite(g.cost[i]!)
  for (;;) {
    let i = -1
    for (let k = 0; k < n; k++) if (!done[k] && best[k]! < INF && (i < 0 || best[k]! < best[i]!)) i = k
    if (i < 0) return INF
    if (i === to) return best[i]!
    done[i] = true
    const x = i % g.w
    const z = Math.floor(i / g.w)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const nz = z + dz
        if ((dx === 0 && dz === 0) || nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) continue
        const j = nz * g.w + nx
        if (!open(j) || (dx !== 0 && dz !== 0 && (!open(z * g.w + nx) || !open(nz * g.w + x)))) continue
        const d = best[i]! + (Math.hypot(dx, dz) * (g.cost[i]! + g.cost[j]!)) / 2
        if (d < best[j]!) best[j] = d
      }
  }
}

/** A grid of cost 1–4 with scattered walls, from a seed. */
function noisy(seed: number, w: number, h: number, walls = 0.2): CostGrid {
  const g = grid(w, h)
  for (let i = 0; i < w * h; i++) {
    const r = roll(seed, `${i}:cell`)
    g.cost[i] = r < walls ? INF : 1 + 3 * roll(seed, `${i}:cost`)
  }
  return g
}

const adjacent = (g: CostGrid, a: number, b: number) =>
  Math.abs((a % g.w) - (b % g.w)) <= 1 && Math.abs(Math.floor(a / g.w) - Math.floor(b / g.w)) <= 1 && a !== b

/** Every segment of a world polyline crosses only passable cells. */
const clear = (g: CostGrid, line: readonly Vec2[]) => {
  const c = g.cell ?? 1
  const o = g.origin ?? [0, 0]
  const toGrid = (p: Vec2): Vec2 => [(p[0] - o[0]) / c, (p[1] - o[1]) / c]
  return line.every((p, i) => i === 0 || Number.isFinite(lineCost(g, toGrid(line[i - 1]!), toGrid(p))))
}

/** Whether an impassable cell lies within `r` cells of p (world metres). */
function nearWall(g: CostGrid, p: Vec2, r: number): boolean {
  const c = cellAt(g, p)
  const x = c % g.w
  const z = Math.floor(c / g.w)
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) if (!Number.isFinite(g.cost[(z + dz) * g.w + x + dx] ?? INF)) return true
  return false
}

/** The turn at each interior point, degrees. */
function turns(line: readonly Vec2[]): number[] {
  const out: number[] = []
  for (let i = 1; i + 1 < line.length; i++) {
    const [a, b, c] = [line[i - 1]!, line[i]!, line[i + 1]!]
    const u = Math.atan2(b[1] - a[1], b[0] - a[0])
    const v = Math.atan2(c[1] - b[1], c[0] - b[0])
    let d = Math.abs(v - u) * (180 / Math.PI)
    if (d > 180) d = 360 - d
    out.push(d)
  }
  return out
}

describe("gridAStar", () => {
  test("finds the octile shortest path on an open grid", () => {
    const g = grid(30, 20)
    const path = gridAStar(g, 0, 19 * 30 + 29)!
    expect(path[0]).toBe(0)
    expect(path.at(-1)).toBe(19 * 30 + 29)
    expect(path.slice(1).every((c, k) => adjacent(g, path[k]!, c))).toBe(true)
    expect(pathCost(g, path)).toBeCloseTo(19 * Math.SQRT2 + 10, 9)
  })

  test("matches a reference Dijkstra's cost on random costed grids with walls", () => {
    for (const seed of SEEDS) {
      const g = noisy(seed, 24, 18)
      const from = 0
      const to = 24 * 18 - 1
      g.cost[from] = 1
      g.cost[to] = 1
      const path = gridAStar(g, from, to)
      const want = dijkstra(g, from, to)
      if (want === INF) expect(path).toBeNull()
      else expect(pathCost(g, path!)).toBeCloseTo(want, 6)
    }
  })

  test("goes through the one gap in a wall, and gives null with the gap shut", () => {
    const g = grid(20, 20)
    for (let z = 0; z < 20; z++) g.cost[z * 20 + 10] = INF
    g.cost[17 * 20 + 10] = 1
    const path = gridAStar(g, 2 * 20 + 2, 2 * 20 + 18)!
    expect(path).toContain(17 * 20 + 10)
    g.cost[17 * 20 + 10] = INF
    expect(gridAStar(g, 2 * 20 + 2, 2 * 20 + 18)).toBeNull()
  })

  test("never slips diagonally between two impassable cells", () => {
    // Two walls meet only at a corner, (4,5) and (5,4) shut: the one way out of the corner is diagonal.
    const g = grid(10, 10)
    for (let z = 0; z < 5; z++) g.cost[z * 10 + 5] = INF
    for (let x = 0; x < 5; x++) g.cost[5 * 10 + x] = INF
    expect(gridAStar(g, 0, 9 * 10 + 9)).toBeNull()
    g.cost[5 * 10 + 4] = 1
    expect(gridAStar(g, 0, 9 * 10 + 9)).not.toBeNull()
  })

  test("a predicate goal finds the nearest accepted cell", () => {
    const g = grid(20, 1)
    const path = gridAStar(g, 10, (i) => i === 2 || i === 15)!
    expect(path.at(-1)).toBe(15)
  })

  test("gives null for an impassable or off-grid end", () => {
    const g = grid(5, 5)
    g.cost[24] = INF
    expect(gridAStar(g, 0, 24)).toBeNull()
    expect(gridAStar(g, 24, 0)).toBeNull()
    expect(gridAStar(g, -1, 3)).toBeNull()
    expect(gridAStar(g, 0, 25)).toBeNull()
  })

  test("is deterministic: same grid, same path, whatever the equal-cost alternatives", () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const g = noisy(seed, 40, 40, 0.1)
      g.cost.fill(1) // all ties: the tie-break alone decides
      const a = gridAStar(g, 0, 40 * 40 - 1)
      const b = gridAStar({ ...g, cost: Float32Array.from(g.cost) }, 0, 40 * 40 - 1)
      expect(a).toEqual(b)
    }
    const n = noisy(3, 50, 50)
    n.cost[0] = 1
    n.cost[2499] = 1
    expect(gridAStar(n, 0, 2499)).toEqual(gridAStar(n, 0, 2499))
  })

  test("the step hook (M4 grade) makes a straight climb dear, so the route zig-zags and the pull keeps it", () => {
    // Height rises one per row; a grade² penalty makes a diagonal cheaper per unit climbed.
    const g: CostGrid = {
      ...grid(9, 20),
      step: (a, b) => {
        const rise = Math.floor(b / 9) - Math.floor(a / 9)
        return (4 * rise * rise) / (a % 9 === b % 9 ? 1 : Math.SQRT2)
      },
    }
    const from = 4
    const to = 19 * 9 + 4
    const path = gridAStar(g, from, to)!
    const diagonals = path.slice(1).filter((c, k) => c % 9 !== path[k]! % 9).length
    expect(diagonals).toBeGreaterThan(15)
    expect(stringPull(path, g).length).toBeGreaterThan(2)
  })
})

describe("stringPull and lineCost", () => {
  test("an open grid's path pulls to its two ends, at cell centres", () => {
    const g: CostGrid = { ...grid(30, 20), cell: 4, origin: [-60, -40] }
    const path = gridAStar(g, cellAt(g, [-58, -38]), cellAt(g, [58, 38]))!
    expect(stringPull(path, g)).toEqual([cellCentre(g, path[0]!), cellCentre(g, path.at(-1)!)])
    expect(cellCentre(g, path[0]!)).toEqual([-58, -38])
  })

  test("keeps a bend at an obstacle and never cuts across it", () => {
    for (const seed of SEEDS) {
      const g = noisy(seed, 40, 30, 0.12)
      g.cost[0] = 1
      g.cost[40 * 30 - 1] = 1
      const path = gridAStar(g, 0, 40 * 30 - 1)
      if (!path) continue
      const pulled = stringPull(path, g)
      expect(pulled.length).toBeGreaterThanOrEqual(2)
      expect(clear(g, pulled)).toBe(true)
    }
  })

  test("lineCost sums cost by length inside each cell, and refuses a corner squeeze", () => {
    const g = grid(4, 4)
    g.cost[1] = 3
    expect(lineCost(g, [0.5, 0.5], [2.5, 0.5])).toBeCloseTo(0.5 + 3 + 0.5, 9)
    g.cost[1] = INF
    expect(lineCost(g, [0.5, 0.5], [2.5, 0.5])).toBe(INF)
    const h = grid(4, 4)
    h.cost[1] = INF
    h.cost[4] = INF
    expect(lineCost(h, [0.5, 0.5], [1.5, 1.5])).toBe(INF)
    expect(lineCost(h, [0.5, 0.5], [5, 0.5])).toBe(INF)
  })
})

// A synthetic island: a round coast, an elliptical lake, a rock field, patchy woods, and a town frame.
const CELL = 4
const SIZE = 200
const ORIGIN: Vec2 = [-400, -400]
const kindIndex = (k: (typeof GROUND_KINDS)[number]) => GROUND_KINDS.indexOf(k)

/** Forest cover 0..1: value noise on a 60 m lattice (the varying part of each salt first), thresholded. */
function woodCover(seed: number, p: Vec2): number {
  const x = p[0] / 60
  const z = p[1] / 60
  const i = Math.floor(x)
  const j = Math.floor(z)
  const v = (a: number, b: number) => roll(seed, `${a}:${b}:wood`)
  const fx = x - i
  const fz = z - j
  const top = v(i, j) + (v(i + 1, j) - v(i, j)) * fx
  const bottom = v(i, j + 1) + (v(i + 1, j + 1) - v(i, j + 1)) * fx
  return Math.min(1, Math.max(0, (top + (bottom - top) * fz - 0.5) * 4))
}

function island(seed: number): { ground: GroundGrid; occupancy: Occupancy } {
  const n = SIZE * SIZE
  const kind = new Uint8Array(n)
  const use = new Uint8Array(n)
  const wood = new Float32Array(n)
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x
      const p: Vec2 = [ORIGIN[0] + (x + 0.5) * CELL, ORIGIN[1] + (z + 0.5) * CELL]
      const r = Math.hypot(p[0], p[1])
      const lake = Math.hypot((p[0] + 60) / 90, (p[1] + 40) / 55)
      kind[i] =
        r > 360
          ? kindIndex("sea")
          : lake < 1
            ? kindIndex("lake")
            : r > 340
              ? kindIndex("shore")
              : Math.hypot(p[0] - 170, p[1] - 120) < 60
                ? kindIndex("rough")
                : kindIndex("land")
      wood[i] = woodCover(seed, p)
      if (Math.hypot(p[0], p[1] - 260) < 60 && kind[i] !== kindIndex("sea"))
        use[i] = OCCUPANTS.indexOf("frame")
    }
  const ground: GroundGrid = {
    cell: CELL,
    origin: ORIGIN,
    w: SIZE,
    h: SIZE,
    kind,
    coastDist: new Float32Array(n),
    lakeDist: new Float32Array(n),
  }
  return { ground, occupancy: { use, wood } }
}

const EXIT: Vec2 = [2, 198]
const net = (edges: Vec2[][] = []): RoadNetwork => ({
  nodes: [{ id: 0, at: EXIT, kind: "exit" }],
  edges: edges.map((points, id) => ({
    id,
    a: 0,
    b: 0,
    cls: "road",
    points,
    width: 4,
    walk: "road",
    grown: 1,
  })),
})

function road(seed: number, from: Vec2, to: Vec2, network = net()) {
  const { ground, occupancy } = island(seed)
  const g: CostGrid = {
    w: ground.w,
    h: ground.h,
    cost: costField(ground, "road", occupancy, network),
    cell: CELL,
    origin: ORIGIN,
  }
  const cells = gridAStar(g, cellAt(g, from), cellAt(g, to))
  const pulled = cells ? stringPull(cells, g) : []
  return { ground, g, cells, pulled, line: cells ? smoothRoute(pulled, g) : [] }
}

describe("costField", () => {
  const { ground, occupancy } = island(1)
  const at = (p: Vec2) =>
    cellAt({ w: SIZE, h: SIZE, cost: new Float32Array(0), cell: CELL, origin: ORIGIN }, p)

  test("water and frames are impassable, and the classes differ only by their table", () => {
    for (const cls of ["road", "track", "trail", "path"] as const) {
      const cost = costField(ground, cls, { use: occupancy.use }, net())
      const t = COSTS[cls]
      expect(cost[at([-390, -390])]).toBe(INF) // sea
      expect(cost[at([-60, -40])]).toBe(INF) // lake
      expect(cost[at([0, 260])]).toBe(INF) // the town frame
      expect(cost[at(EXIT)]).toBe(1) // its exit
      expect(cost[at([170, 120])]).toBeCloseTo(t.rough, 6)
      expect(cost[at([0, -350])]).toBeCloseTo(t.shore, 6)
      expect(cost[at([-60 - 92, -40])]).toBeCloseTo(t.shore, 6) // touching the lake
      expect(cost[at([100, -100])]).toBe(1)
    }
  })

  test("woods and fields cost more, the built network less; piers never open the water", () => {
    const use = Uint8Array.from(occupancy.use)
    use[at([100, -100])] = OCCUPANTS.indexOf("field")
    const wood = new Float32Array(SIZE * SIZE)
    wood[at([100, -60])] = 0.5
    const network = net([
      [
        [-100, 100],
        [-20, 100],
      ],
    ])
    network.edges.push({
      ...network.edges[0]!,
      id: 1,
      walk: "pier",
      points: [
        [0, -360],
        [0, -390],
      ],
    })
    const cost = costField(ground, "road", { use, wood }, network)
    expect(cost[at([100, -100])]).toBeCloseTo(COSTS.road.field, 6)
    expect(cost[at([100, -60])]).toBeCloseTo(1 + COSTS.road.wood * 0.5, 6)
    for (let x = -100; x <= -20; x += 2) expect(cost[at([x, 100])]).toBeCloseTo(COSTS.road.road, 6)
    expect(cost[at([0, -390])]).toBe(INF)
  })
})

describe("routing a road over the island", () => {
  test("never crosses water: a road round the lake stays on land, cells and smoothed line alike", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const { ground, g, cells, line } = road(seed, [-220, -40], [120, -40])
      expect(cells).not.toBeNull()
      const water = (i: number) => ground.kind[i] === kindIndex("sea") || ground.kind[i] === kindIndex("lake")
      expect(cells!.some(water)).toBe(false)
      // Against water alone (the other costs set to 1): the smoothed line touches no water cell.
      const wet: CostGrid = { ...g, cost: g.cost.map((_, i) => (water(i) ? INF : 1)) }
      expect(clear(wet, line)).toBe(true)
    }
  })

  test("a smoothed road is curves, not a staircase: 1 m points about 6 m apart, gentle turns", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const { g, line } = road(seed, EXIT, [-300, -150])
      expect(clear(g, line)).toBe(true)
      // On the 1 m grid, except where a snap would touch the impassable (next to the town's frame).
      for (const p of line.slice(1, -1))
        if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) expect(nearWall(g, p, 2)).toBe(true)
      const gaps = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i]![0], p[1] - line[i]![1]))
      expect(Math.max(...gaps)).toBeLessThan(8)
      // No staircase: no sharp step anywhere, and over 12 m chords the road mostly runs straight on.
      const t = turns(line)
      const wide = turns(line.filter((_, i) => i % 2 === 0))
      expect(Math.max(...t)).toBeLessThan(35)
      expect(wide.filter((d) => d > 10).length / wide.length).toBeLessThan(0.2)
    }
  })

  test("prefers the existing road: a later road runs along an earlier one and branches off it", () => {
    const first = road(1, EXIT, [-250, -200])
    const second = road(1, EXIT, [-300, 50], net([first.line]))
    const onFirst = second.cells!.filter((c) => second.g.cost[c] === Math.fround(COSTS.road.road)).length
    expect(onFirst).toBeGreaterThan(20)
    const alone = road(1, EXIT, [-300, 50])
    expect(alone.cells!.filter((c) => second.g.cost[c] === Math.fround(COSTS.road.road)).length).toBeLessThan(
      onFirst,
    )
  })

  test("is deterministic end to end", () => {
    const a = road(5, EXIT, [250, -150])
    const b = road(5, EXIT, [250, -150])
    expect(a.cells).toEqual(b.cells)
    expect(a.line).toEqual(b.line)
  })

  test("a 200×200 grid route takes at most 5 ms", () => {
    const { g } = road(2, EXIT, [-300, -150])
    const from = cellAt(g, [300, 60])
    const to = cellAt(g, [-300, -150])
    for (let k = 0; k < 3; k++) gridAStar(g, from, to) // warm the JIT
    const ms: number[] = []
    for (let k = 0; k < 9; k++) {
      const t0 = performance.now()
      const path = gridAStar(g, from, to)
      ms.push(performance.now() - t0)
      expect(path).not.toBeNull()
    }
    ms.sort((a, b) => a - b)
    expect(ms[4]!).toBeLessThan(5)
  })
})
