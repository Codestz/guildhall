/**
 * Step 1 of the hex world: the land and its water, generated on the hex grid itself.
 *
 * 1. Shape: noise over the tiles, domain-warped, minus a falloff from the middle (stretched and turned
 *    by seed), with a few lobes pushed out and coves bitten in; the largest piece of land is the island,
 *    inland sea holes are filled, tiny specks become rocks offshore.
 * 2. Height, in whole levels: rises with the distance from the coast, plus a hill massif off-centre
 *    whose tiles climb in steps; a peak or two of rock on top.
 * 3. Water: every land tile drains to its lowest neighbour (a priority flood from the sea, so every
 *    tile has a way down and closed hollows fill as lakes); rain, heavier on the hills, is summed
 *    downstream; a river starts where enough water gathers and runs tile to tile to the sea.
 * 4. Ground: sand on the low shore, cliffs where high land meets the sea, rock on the peaks, forest and
 *    meadow by a moisture field (wetter near water and on the hills).
 *
 * Pure and deterministic: every draw is a hash of the seed.
 */
import { fbm, hash2, ridged, smoothstep } from "../geom/noise.ts"
import { type HexGrid, hexCentre, hexGrid } from "./grid.ts"
import { castleFoot, type IslandSites, levelSites, reserveSites } from "./sites.ts"

export const HEX_KINDS = [
  "sea",
  "shallows",
  "sand",
  "grass",
  "meadow",
  "forest",
  "hill",
  "rock",
  "cliff",
  "lake",
  "river",
] as const
export type HexKind = (typeof HEX_KINDS)[number]

export interface HexIslandSpec {
  seed: number
  /** Files in the repo: the island's size follows them (decisions.md "Island size and growth"). */
  files?: number
  /** Coast irregularity. */
  coast?: number
  /** Hill massif height in levels. */
  hills?: number
  /** River density. */
  rain?: number
  /** Forest share of the green land, roughly. */
  forest?: number
}

export const HEX_ISLAND_DEFAULTS: Required<Omit<HexIslandSpec, "seed">> = {
  files: 1500,
  coast: 1,
  hills: 5,
  rain: 1,
  forest: 0.21,
}

/** How far under 1 the moisture a forest tile needs sits, for a forest share (zones' `wild` moves it). */
export const forestLine = (forest: number): number => forest * 2.2

/** The grid every island lives on: one size for all, so a tile's coordinates never change as it grows. */
export const HEX_MAP_RADIUS = 56

/** The nature lake is chosen among this many first-grown land tiles, so every bigger island keeps it. */
const LAKE_REF = 700

/** Land tiles for a repo of `files` files: 2 × V1's 40 + 13·√files, at most HEX_LAND_MAX. */
export const HEX_LAND_MAX = 2800
export const landTiles = (files: number): number =>
  Math.min(HEX_LAND_MAX, Math.round(2 * (40 + 13 * Math.sqrt(Math.max(0, files)))))

export interface HexRiver {
  /** Tile indices, source to mouth (the last one is sea or lake, or the river it joins). */
  tiles: number[]
  /** Upstream tiles drained at its end. */
  flow: number
}

export interface HexIsland {
  spec: Required<HexIslandSpec>
  grid: HexGrid
  kind: Uint8Array
  /** Height in levels (0 at the sea, -1 under it). */
  level: Int8Array
  /** Water gathered through each land tile (tiles' worth of rain). */
  flow: Float32Array
  /** Index of the tile each land tile drains into (-1 none). */
  down: Int32Array
  rivers: HexRiver[]
  /** Steps from the sea, per tile (0 on water). */
  coast: Int16Array
  /**
   * The moisture field that grows the woods, per tile the ground step judged (NaN elsewhere: water,
   * the shore, the peaks): a tile is forest where it is over `1 - forestLine(spec.forest)`.
   */
  moisture: Float32Array
  /** The nature lake's tiles (every island has one; a bigger island keeps it). */
  lake: number[]
  /** The reserved sites (sites.ts `reserveSites`): the town's core and the castle's site, dry and level, fixed as the island grows. */
  sites: IslandSites
  /**
   * Each grown tile's place in the growth order (-1 for sea, and for the few inland seas filled in after
   * the growth): the island of n tiles is the tiles ranked under n, so a history replay reveals tiles by rank.
   */
  rank: Int32Array
  stats: { land: number; rivers: number; lakes: number; ms: number }
}

const K = Object.fromEntries(HEX_KINDS.map((k, i) => [k, i])) as Record<HexKind, number>

/** Breadth-first steps from every tile `src` accepts. */
function steps(g: HexGrid, src: (i: number) => boolean): Int16Array {
  const d = new Int16Array(g.size).fill(32767)
  const queue: number[] = []
  for (let i = 0; i < g.size; i++)
    if (src(i)) {
      d[i] = 0
      queue.push(i)
    }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!
    for (const j of g.neighbours(i))
      if (j >= 0 && d[j]! > d[i]! + 1) {
        d[j] = d[i]! + 1
        queue.push(j)
      }
  }
  return d
}

/** Connected pieces of the tiles `inside` accepts: a label per tile (0 none) and each label's size. */
function pieces(g: HexGrid, inside: (i: number) => boolean): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(g.size)
  const sizes = [0]
  for (let s = 0; s < g.size; s++) {
    if (!inside(s) || label[s]) continue
    const id = sizes.length
    let n = 0
    const stack = [s]
    label[s] = id
    while (stack.length) {
      const i = stack.pop()!
      n++
      for (const j of g.neighbours(i))
        if (j >= 0 && !label[j] && inside(j)) {
          label[j] = id
          stack.push(j)
        }
    }
    sizes.push(n)
  }
  return { label, sizes }
}

/**
 * Where the seed's two hill massifs stand, in tile units (hexCentre's): the main one a fixed walk from
 * the centre (a small island reaches its foot, a big one climbs it), a second, lower range further out
 * on another side. The same at every island size.
 */
export function hexMassifs(seed: number): [[number, number], [number, number]] {
  const rnd = (k: number) => hash2(seed, k, 4111)
  const massifAng = rnd(5) * Math.PI * 2
  const ang2 = massifAng + (rnd(6) < 0.5 ? 1 : -1) * (1.9 + 0.8 * rnd(7))
  return [
    [Math.cos(massifAng) * 12, Math.sin(massifAng) * 12],
    [Math.cos(ang2) * 24, Math.sin(ang2) * 24],
  ]
}

export function hexIsland(input: HexIslandSpec): HexIsland {
  const t0 = performance.now()
  const spec = { ...HEX_ISLAND_DEFAULTS, ...input }
  const { seed } = spec
  const radius = HEX_MAP_RADIUS
  const g = hexGrid(radius)
  const N = g.size
  const rnd = (k: number) => hash2(seed, k, 4111)
  const at = (i: number) => hexCentre({ q: g.q[i]!, r: g.r[i]! })
  // the shape field is laid out at the largest island's scale, in fixed tile units: every island is
  // the same field grown to a different size
  const R = Math.sqrt(HEX_LAND_MAX / 2.6) * 1.5

  // ---- 1. shape ----
  const rot = rnd(1) * Math.PI * 2
  const stretch = 1 + 0.45 * rnd(2)
  const lobes: [number, number, number][] = []
  for (let k = 0; k < 3 + Math.floor(rnd(3) * 3); k++)
    lobes.push([
      rnd(10 + k) * Math.PI * 2,
      0.22 + 0.25 * rnd(20 + k),
      (0.18 + 0.14 * rnd(25 + k)) * spec.coast,
    ])
  for (let k = 0; k < 2 + Math.floor(rnd(4) * 3); k++)
    lobes.push([
      rnd(30 + k) * Math.PI * 2,
      0.1 + 0.1 * rnd(40 + k),
      -(0.18 + 0.14 * rnd(45 + k)) * spec.coast,
    ])
  const [massif, massif2] = hexMassifs(seed)
  const landness = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const [x, y] = at(i)
    const s = 1 / (R * 0.55)
    const wx = x + fbm(seed + 11, x * s, y * s, 3) * R * 0.22 * spec.coast
    const wy = y + fbm(seed + 13, x * s, y * s, 3) * R * 0.22 * spec.coast
    const u = (wx * Math.cos(rot) + wy * Math.sin(rot)) / (R * Math.sqrt(stretch))
    const v = (-wx * Math.sin(rot) + wy * Math.cos(rot)) / (R / Math.sqrt(stretch))
    let L = 1 - Math.hypot(u, v)
    L += 0.18 * spec.coast * fbm(seed + 17, wx * s * 1.7, wy * s * 1.7, 3)
    // small bays and points at the coast's own scale, so big islands keep a ragged shore
    L += 0.14 * spec.coast * fbm(seed + 19, x / 6, y / 6, 2)
    const ang = Math.atan2(y, x)
    for (const [a, wdt, h] of lobes) {
      const d = Math.atan2(Math.sin(ang - a), Math.cos(ang - a))
      L += h * Math.exp(-(d * d) / (2 * wdt * wdt)) * Math.min(1, Math.hypot(x, y) / (R * 0.4))
    }
    // the massif keeps its land
    L += 0.25 * (1 - smoothstep(0, R * 0.4, Math.hypot(x - massif[0], y - massif[1])))
    landness[i] = L
  }
  const kind = new Uint8Array(N).fill(K.sea)
  // each land tile's place in the growth order (-1 for sea): what stays fixed as the island grows
  const rank = new Int32Array(N).fill(-1)
  // grow the island from the centre, the most land-like tile on its edge first: one fixed order for the
  // seed, so an island of n tiles is the first n tiles of every bigger one (stable growth)
  const target = landTiles(spec.files)
  {
    const grown = new Uint8Array(N)
    const heap: [number, number][] = []
    const push = (p: number, i: number) => {
      heap.push([p, i])
      let j = heap.length - 1
      while (j > 0) {
        const up = (j - 1) >> 1
        if (heap[up]![0] > p || (heap[up]![0] === p && heap[up]![1] < i)) break
        ;[heap[up], heap[j]] = [heap[j]!, heap[up]!]
        j = up
      }
    }
    const pop = (): number => {
      const top = heap[0]![1]
      const last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        let j = 0
        for (;;) {
          const l = 2 * j + 1
          const r = l + 1
          let m = j
          const more = (a: number, b: number) =>
            heap[a]![0] > heap[b]![0] || (heap[a]![0] === heap[b]![0] && heap[a]![1] < heap[b]![1])
          if (l < heap.length && more(l, m)) m = l
          if (r < heap.length && more(r, m)) m = r
          if (m === j) break
          ;[heap[m], heap[j]] = [heap[j]!, heap[m]!]
          j = m
        }
      }
      return top
    }
    const origin = g.index(0, 0)
    grown[origin] = 1
    push(landness[origin]!, origin)
    let n = 0
    while (heap.length && n < target) {
      const i = pop()
      if (g.ring(i) >= radius - 3) continue
      kind[i] = K.grass
      rank[i] = n
      n++
      for (const j of g.neighbours(i))
        if (j >= 0 && !grown[j]) {
          grown[j] = 1
          push(landness[j]!, j)
        }
    }
    // fill inland seas
    const sea = pieces(g, (i) => kind[i] === K.sea)
    const outer = sea.label[g.index(radius, 0)]!
    for (let i = 0; i < N; i++) if (kind[i] === K.sea && sea.label[i] !== outer) kind[i] = K.grass
  }
  // land, fixed here: later stages repaint kinds (rock peaks, lakes) but the coast stays
  const land = new Uint8Array(N)
  for (let i = 0; i < N; i++) land[i] = kind[i] === K.grass ? 1 : 0
  const isSea = (i: number) => !land[i]
  const coast = steps(g, isSea)

  // ---- 2. height in levels ----
  // the massifs' pull at a tile, 0–1: the same at every island size
  const hillAt = (i: number): number => {
    const [x, y] = at(i)
    const m =
      1 -
      smoothstep(
        0,
        R * 0.42,
        Math.hypot(x - massif[0], y - massif[1]) * (1 + 0.35 * fbm(seed + 29, x / 7, y / 7, 2)),
      )
    const m2 =
      0.65 *
      (1 -
        smoothstep(
          0,
          R * 0.3,
          Math.hypot(x - massif2[0], y - massif2[1]) * (1 + 0.35 * fbm(seed + 33, x / 7, y / 7, 2)),
        ))
    return Math.max(m, m2)
  }
  const level = new Int8Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    if (isSea(i)) continue
    const [x, y] = at(i)
    const D = coast[i]!
    const low = Math.min(2, Math.floor(D / 3)) + (fbm(seed + 23, x / 9, y / 9, 2) > 0.25 ? 1 : 0)
    const mm = hillAt(i)
    const hill = Math.round(
      mm * spec.hills * (0.75 + 0.5 * ridged(seed + 31, x / 8, y / 8, 2)) * Math.min(1, D / 2),
    )
    // bluffs: stretches of the coast stand high (more of them near the hills)
    const bluff = D <= 2 && fbm(seed + 37, x / 9, y / 9, 2) + 0.6 * mm > 0.32 ? 2 : 0
    level[i] = Math.max(D <= 1 ? 0 : 1, Math.min(low, D)) + hill + bluff
  }
  // ---- 2b. the reserved sites (sites.ts): the town's core and the castle's site, levelled ----
  const sites = reserveSites(g, rank, seed, hillAt, (i) => {
    // the level a tile has once it is well inland (the coast's pull gone): the same at every size
    const [x, y] = at(i)
    const bump = fbm(seed + 23, x / 9, y / 9, 2) > 0.25 ? 1 : 0
    return 2 + bump + Math.round(hillAt(i) * spec.hills * (0.75 + 0.5 * ridged(seed + 31, x / 8, y / 8, 2)))
  })
  // (and the castle's foot: the notches of its outline, open ground at its level the water runs round)
  const foot = castleFoot(g, sites.castle)
  const reserved = new Uint8Array(N)
  for (const list of [sites.town, sites.castle, foot]) for (const i of list) if (!isSea(i)) reserved[i] = 1
  levelSites(g, level, [sites.town, sites.castle], isSea, foot)

  // ---- 3. water: drain every tile to the sea (priority flood), fill hollows as lakes ----
  const down = new Int32Array(N).fill(-1)
  const filled = new Float32Array(N)
  const order: number[] = []
  {
    const seen = new Uint8Array(N)
    const heap: [number, number][] = []
    const push = (h: number, i: number) => {
      heap.push([h, i])
      let j = heap.length - 1
      while (j > 0) {
        const p = (j - 1) >> 1
        if (heap[p]![0] < h || (heap[p]![0] === h && heap[p]![1] < i)) break
        ;[heap[p], heap[j]] = [heap[j]!, heap[p]!]
        j = p
      }
    }
    const pop = (): [number, number] => {
      const top = heap[0]!
      const last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        let j = 0
        for (;;) {
          const l = 2 * j + 1
          const r = l + 1
          let m = j
          const less = (a: number, b: number) =>
            heap[a]![0] < heap[b]![0] || (heap[a]![0] === heap[b]![0] && heap[a]![1] < heap[b]![1])
          if (l < heap.length && less(l, m)) m = l
          if (r < heap.length && less(r, m)) m = r
          if (m === j) break
          ;[heap[m], heap[j]] = [heap[j]!, heap[m]!]
          j = m
        }
      }
      return top
    }
    for (let i = 0; i < N; i++)
      if (!isSea(i) && [...g.neighbours(i)].some((j) => j >= 0 && isSea(j))) {
        filled[i] = level[i]!
        seen[i] = 1
        down[i] = [...g.neighbours(i)].find((j) => j >= 0 && isSea(j))!
        push(filled[i]!, i)
      }
    // the reserved sites drain last: water runs round them, through them only where it has no other way
    for (;;) {
      if (!heap.length) {
        // the flood is held at the sites: let in the reserved tile it reached at its lowest
        let lo = -1
        let from = -1
        for (let k = 0; k < N; k++)
          if (reserved[k] && !seen[k])
            for (const j of g.neighbours(k))
              if (j >= 0 && seen[j] && (from < 0 || filled[j]! < filled[from]!)) {
                lo = k
                from = j
              }
        if (lo < 0) break
        seen[lo] = 1
        down[lo] = from
        filled[lo] = Math.max(level[lo]!, filled[from]! + 0.001)
        push(filled[lo]!, lo)
        continue
      }
      const [, i] = pop()
      order.push(i)
      for (const j of g.neighbours(i)) {
        if (j < 0 || seen[j] || isSea(j)) continue
        if (reserved[j] && !reserved[i]) continue
        seen[j] = 1
        filled[j] = Math.max(level[j]!, filled[i]! + 0.001)
        down[j] = i
        push(filled[j]! + 0.9 * hash2(seed + 53, g.q[j]!, g.r[j]!), j)
      }
    }
  }
  // lakes: hollows the flood filled at least a level deep, two tiles or more
  let lakes = 0
  {
    const { label, sizes } = pieces(g, (i) => !isSea(i) && !reserved[i] && filled[i]! - level[i]! >= 0.999)
    for (let i = 0; i < N; i++)
      if (label[i] && sizes[label[i]!]! >= 2) {
        kind[i] = K.lake
        level[i] = Math.floor(filled[i]!)
      }
    for (let k = 1; k < sizes.length; k++) if (sizes[k]! >= 2) lakes++
  }
  // rain, heavier on the hills, summed downstream
  const flow = new Float32Array(N)
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!
    flow[i] = flow[i]! + 0.3 + 0.6 * Math.max(0, level[i]! - 2)
    const d = down[i]!
    if (d >= 0 && !isSea(d)) flow[d] = flow[d]! + flow[i]!
  }
  let landCount = 0
  for (let i = 0; i < N; i++) if (!isSea(i)) landCount++
  const thr = Math.max(6, (landCount * 0.03) / spec.rain)
  const wet = (i: number) => !isSea(i) && !reserved[i] && kind[i] !== K.lake && flow[i]! >= thr
  const fed = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (wet(i) && down[i]! >= 0) fed[down[i]!] = 1
  const heads = [...Array(N).keys()]
    .filter((i) => wet(i) && !fed[i])
    .sort((a, b) => level[b]! - level[a]! || a - b)
  const rivers: HexRiver[] = []
  const taken = new Uint8Array(N)
  for (const head of heads) {
    const tiles: number[] = []
    let i = head
    // a river meets a reserved site at its edge and ends there (the castle's moat): it never runs through
    while (i >= 0 && !reserved[i]) {
      tiles.push(i)
      if (isSea(i) || kind[i] === K.lake || (taken[i] && i !== head)) break
      taken[i] = 1
      i = down[i]!
    }
    if (tiles.length < 6 || rivers.length >= Math.round(4 * spec.rain)) continue
    rivers.push({ tiles, flow: flow[tiles[tiles.length - 2] ?? head]! })
    for (const t of tiles) if (!isSea(t) && kind[t] !== K.lake) kind[t] = K.river
  }

  // still water: a spring pond at the head of each long river, and a lake on the longest one's lowland
  const pond = (centre: number, n: number) => {
    const lvl = level[centre]!
    const queue = [centre]
    const seen = new Set([centre])
    let made = 0
    while (queue.length && made < n) {
      const i = queue.shift()!
      if (isSea(i) || reserved[i] || Math.abs(level[i]! - lvl) > 0) continue
      kind[i] = K.lake
      made++
      for (const j of g.neighbours(i))
        if (j >= 0 && !seen.has(j) && hash2(seed + 61, j, made) < 0.8) {
          seen.add(j)
          queue.push(j)
        }
    }
    if (made) lakes++
  }
  for (const rv of rivers)
    if (rv.tiles.length >= 7 && level[rv.tiles[0]!]! >= 3)
      pond(rv.tiles[0]!, 2 + Math.floor(rnd(70 + (rv.tiles[0]! % 13)) * 2))
  const longest = rivers.reduce<HexRiver | null>(
    (m, r) => (!m || r.tiles.length > m.tiles.length ? r : m),
    null,
  )
  if (longest && longest.tiles.length >= 10) {
    const mid = longest.tiles.slice(
      Math.floor(longest.tiles.length * 0.4),
      Math.floor(longest.tiles.length * 0.8),
    )
    const spot = mid.find((i) => level[i]! <= 2 && coast[i]! >= 4)
    if (spot !== undefined) pond(spot, 5 + Math.floor(rnd(80) * 4))
  }

  // ---- 4. ground ----
  const water = steps(g, (i) => kind[i] === K.river || kind[i] === K.lake)
  let maxLevel = 0
  for (let i = 0; i < N; i++) maxLevel = Math.max(maxLevel, level[i]!)
  const moisture = new Float32Array(N).fill(Number.NaN)
  for (let i = 0; i < N; i++) {
    const k = kind[i]!
    if (isSea(i)) {
      if (kind[i] !== K.rock)
        kind[i] = [...g.neighbours(i)].some((j) => j >= 0 && !isSea(j)) ? K.shallows : K.sea
      continue
    }
    if (k === K.river || k === K.lake) continue
    const [x, y] = at(i)
    const L = level[i]!
    // a reserved site is open ground to build on: no wood, no bare rock, no shore
    if (reserved[i]) {
      kind[i] = L >= 3 ? K.hill : K.grass
      continue
    }
    const nearSea = coast[i]! <= 1
    if (nearSea) {
      kind[i] = L >= 2 ? K.cliff : K.sand
      continue
    }
    if (L >= maxLevel - 1 && L >= 4 && ![...g.neighbours(i)].some((j) => j >= 0 && reserved[j])) {
      kind[i] = K.rock
      continue
    }
    const moist = fbm(seed + 41, x / 13, y / 13, 2) + 0.2 * (1 - Math.min(1, water[i]! / 4)) + 0.06 * L
    moisture[i] = moist
    if (moist > 1 - forestLine(spec.forest)) kind[i] = K.forest
    else if (L >= 3) kind[i] = K.hill
    else kind[i] = fbm(seed + 43, x / 6, y / 6, 2) > 0.2 ? K.meadow : K.grass
  }
  // ---- 5. the nature lake: every island has one, in the thick of its biggest stretch of woods and meadow ----
  // Chosen among the first tiles of the growth order only (at most LAKE_REF of them), by size-independent
  // fields, so a bigger island keeps the same lake (decisions.md "Island size and growth").
  const natureLake: number[] = []
  {
    const ref = Math.min(landCount, LAKE_REF)
    // nature by the moisture field that grows the woods (step 4), read raw: a tile's coast and height
    // change as the island grows, this does not
    const moist = (i: number) => {
      const [x, y] = at(i)
      return fbm(seed + 41, x / 13, y / 13, 2)
    }
    // never on a reserved site, nor crowding the town's core (two steps clear)
    const crowd = new Set<number>(sites.town)
    for (let k = 0; k < 2; k++)
      for (const i of [...crowd]) for (const j of g.neighbours(i)) if (j >= 0) crowd.add(j)
    const fit = (i: number) =>
      rank[i]! >= 0 && rank[i]! < ref * 0.8 && g.ring(i) >= 6 && !reserved[i] && !crowd.has(i)
    let site = -1
    let best = -1e9
    for (let i = 0; i < N; i++) {
      if (!fit(i)) continue
      // the wettest stretch, two rings round
      let wild = moist(i)
      for (const j of g.neighbours(i))
        if (j >= 0) for (const k of g.neighbours(j)) if (k >= 0) wild += moist(k)
      const score = wild + hash2(seed + 67, g.q[i]!, g.r[i]!) * 0.5
      if (score > best) {
        best = score
        site = i
      }
    }
    if (site >= 0) {
      const size = 6 + Math.floor(rnd(90) * 4)
      const lake = [site]
      const seen = new Set(lake)
      for (let k = 0; k < lake.length && lake.length < size; k++)
        for (const j of g.neighbours(lake[k]!))
          if (j >= 0 && !seen.has(j) && lake.length < size) {
            seen.add(j)
            if (fit(j)) if (hash2(seed + 71, g.q[j]!, g.r[j]!) < 0.85 || k === 0) lake.push(j)
          }
      // one flat surface, at the lowest of its tiles
      let lvl = 127
      for (const i of lake) lvl = Math.min(lvl, level[i]!)
      for (const i of lake) {
        kind[i] = K.lake
        level[i] = lvl
      }
      natureLake.push(...lake)
      lakes++
    }
  }
  // shallows reach a second ring where the sea is calm (round sand)
  const shore = steps(g, (i) => !isSea(i))
  for (let i = 0; i < N; i++)
    if (
      kind[i] === K.sea &&
      shore[i] === 2 &&
      [...g.neighbours(i)].some((j) => j >= 0 && kind[j] === K.sand) &&
      hash2(seed + 47, g.q[i]!, g.r[i]!) < 0.6
    )
      kind[i] = K.shallows

  return {
    spec,
    grid: g,
    kind,
    level,
    flow,
    down,
    rivers,
    coast,
    moisture,
    lake: natureLake,
    sites,
    rank,
    stats: { land: landCount, rivers: rivers.length, lakes, ms: Math.round(performance.now() - t0) },
  }
}

/** The kind name of tile i. */
export const kindOf = (h: HexIsland, i: number): HexKind => HEX_KINDS[h.kind[i]!]!
