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
  /** Rings of tiles round the middle (the map, sea included). */
  radius?: number
  /** Share of the map that is land, roughly. */
  land?: number
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
  radius: 30,
  land: 0.34,
  coast: 1,
  hills: 5,
  rain: 1,
  forest: 0.26,
}

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

export function hexIsland(input: HexIslandSpec): HexIsland {
  const t0 = performance.now()
  const spec = { ...HEX_ISLAND_DEFAULTS, ...input }
  const { seed, radius } = spec
  const g = hexGrid(radius)
  const N = g.size
  const rnd = (k: number) => hash2(seed, k, 4111)
  const at = (i: number) => hexCentre({ q: g.q[i]!, r: g.r[i]! })
  const R = radius * 1.5 // the map's radius in tile units, roughly

  // ---- 1. shape ----
  const rot = rnd(1) * Math.PI * 2
  const stretch = 1 + 0.45 * rnd(2)
  const lobes: [number, number, number][] = []
  for (let k = 0; k < 2 + Math.floor(rnd(3) * 2); k++)
    lobes.push([rnd(10 + k) * Math.PI * 2, 0.35 + 0.25 * rnd(20 + k), 0.22 * spec.coast])
  for (let k = 0; k < 1 + Math.floor(rnd(4) * 2); k++)
    lobes.push([rnd(30 + k) * Math.PI * 2, 0.18 + 0.1 * rnd(40 + k), -0.2 * spec.coast])
  const massifAng = rnd(5) * Math.PI * 2
  const massif: [number, number] = [Math.cos(massifAng) * R * 0.32, Math.sin(massifAng) * R * 0.32]
  const landness = new Float32Array(N)
  const cut = 1 - spec.land * 1.55
  for (let i = 0; i < N; i++) {
    const [x, y] = at(i)
    const s = 1 / (R * 0.55)
    const wx = x + fbm(seed + 11, x * s, y * s, 3) * R * 0.22 * spec.coast
    const wy = y + fbm(seed + 13, x * s, y * s, 3) * R * 0.22 * spec.coast
    const u = (wx * Math.cos(rot) + wy * Math.sin(rot)) / (R * Math.sqrt(stretch))
    const v = (-wx * Math.sin(rot) + wy * Math.cos(rot)) / (R / Math.sqrt(stretch))
    let L = 1 - Math.hypot(u, v) - cut
    L += 0.18 * spec.coast * fbm(seed + 17, wx * s * 1.7, wy * s * 1.7, 3)
    const ang = Math.atan2(y, x)
    for (const [a, wdt, h] of lobes) {
      const d = Math.atan2(Math.sin(ang - a), Math.cos(ang - a))
      L += h * Math.exp(-(d * d) / (2 * wdt * wdt)) * Math.min(1, Math.hypot(x, y) / (R * 0.4))
    }
    // the massif keeps its land
    L += 0.25 * (1 - smoothstep(0, R * 0.4, Math.hypot(x - massif[0], y - massif[1])))
    // the map's edge is always sea
    L -= smoothstep(R * 0.72, R * 0.9, Math.hypot(x, y)) * 2
    landness[i] = L
  }
  const kind = new Uint8Array(N).fill(K.sea)
  {
    const { label, sizes } = pieces(g, (i) => landness[i]! > 0)
    let big = 1
    for (let k = 1; k < sizes.length; k++) if (sizes[k]! > sizes[big]!) big = k
    for (let i = 0; i < N; i++) {
      if (label[i] === big) kind[i] = K.grass
      else if (label[i] && sizes[label[i]!]! <= 3) kind[i] = K.rock // a sea stack
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
  const level = new Int8Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    if (isSea(i)) continue
    const [x, y] = at(i)
    const D = coast[i]!
    const low = Math.min(2, Math.floor(D / 3)) + (fbm(seed + 23, x / 9, y / 9, 2) > 0.25 ? 1 : 0)
    const m =
      1 -
      smoothstep(
        0,
        R * 0.42,
        Math.hypot(x - massif[0], y - massif[1]) * (1 + 0.35 * fbm(seed + 29, x / 7, y / 7, 2)),
      )
    const hill = Math.round(
      m * spec.hills * (0.75 + 0.5 * ridged(seed + 31, x / 8, y / 8, 2)) * Math.min(1, D / 2),
    )
    level[i] = Math.max(D <= 1 ? 0 : 1, Math.min(low, D)) + hill
  }

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
    while (heap.length) {
      const [, i] = pop()
      order.push(i)
      for (const j of g.neighbours(i)) {
        if (j < 0 || seen[j] || isSea(j)) continue
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
    const { label, sizes } = pieces(g, (i) => !isSea(i) && filled[i]! - level[i]! >= 0.999)
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
  let landTiles = 0
  for (let i = 0; i < N; i++) if (!isSea(i)) landTiles++
  const thr = Math.max(6, (landTiles * 0.03) / spec.rain)
  const wet = (i: number) => !isSea(i) && kind[i] !== K.lake && flow[i]! >= thr
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
    while (i >= 0) {
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
      if (isSea(i) || Math.abs(level[i]! - lvl) > 0) continue
      kind[i] = K.lake
      made++
      for (const j of g.neighbours(i))
        if (j >= 0 && !seen.has(j) && hash2(seed + 61, j, made) < 0.8) seen.add(j), queue.push(j)
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
    const nearSea = coast[i]! <= 1
    if (nearSea) {
      kind[i] = L >= 2 ? K.cliff : K.sand
      continue
    }
    if (L >= maxLevel - 1 && L >= 4) {
      kind[i] = K.rock
      continue
    }
    const moist = fbm(seed + 41, x / 13, y / 13, 2) + 0.2 * (1 - Math.min(1, water[i]! / 4)) + 0.06 * L
    if (moist > 1 - spec.forest * 2.2) kind[i] = K.forest
    else if (L >= 3) kind[i] = K.hill
    else kind[i] = fbm(seed + 43, x / 6, y / 6, 2) > 0.2 ? K.meadow : K.grass
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
    stats: { land: landTiles, rivers: rivers.length, lakes, ms: Math.round(performance.now() - t0) },
  }
}

/** The kind name of tile i. */
export const kindOf = (h: HexIsland, i: number): HexKind => HEX_KINDS[h.kind[i]!]!
