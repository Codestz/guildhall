/**
 * The reveal order of a hex island for a history replay (history.ts): every tile's place is its growth
 * rank (world `HexIsland.rank`) with its holes filled and its unranked land placed last (`tilePlaces`);
 * everything drawn takes its place from where it stands (`placer`); and a skirt walls the frontier where
 * the ground has no side of its own (`skirt`). Pure.
 */
import { type PlaceAt, srgbToLinear, type VertexMeshData } from "@guildhall/render"
import { HEX_TILE_SIZE, type HexIsland, hexAt } from "@guildhall/world"

/** Every tile's place in the reveal order (-1: the sea), and how many places there are. */
export interface TilePlaces {
  place: Int32Array
  /** The places: the island is whole once the count is past this (plus the frontier's span). */
  ranked: number
}

/**
 * Every tile's place in the reveal order: its growth rank, with the holes filled. A tile ranked later
 * than all the land round it (a lake behind its banks) would show as a hole in the island, sea and foam
 * inside the coast, until its turn; so a tile comes in as soon as the land not yet in round it no
 * longer reaches the sea. Found backwards: the land is taken away in reverse rank order and joined to
 * what is already away (union-find, the sea in it from the start); a tile whose company is cut off
 * from the sea is placed at the rank that first joins it to the sea. A land tile without a rank (an
 * inland sea filled in after the growth) is placed right after the ranked land.
 */
export function tilePlaces(h: HexIsland): TilePlaces {
  const g = h.grid
  const N = g.size
  let ranked = 0
  for (let i = 0; i < N; i++) if ((h.rank[i] as number) >= ranked) ranked = (h.rank[i] as number) + 1
  const place = new Int32Array(N)
  for (let i = 0; i < N; i++) {
    const rk = h.rank[i] as number
    place[i] = rk >= 0 ? rk : h.coast[i] === 0 ? -1 : ranked
  }
  // union-find over what is away: every sea tile is the outside
  const parent = new Int32Array(N)
  for (let i = 0; i < N; i++) parent[i] = i
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    while (parent[i] !== r) {
      const next = parent[i] as number
      parent[i] = r
      i = next
    }
    return r
  }
  const members = new Map<number, number[]>()
  const away = new Uint8Array(N)
  let outside = -1
  for (let i = 0; i < N; i++)
    if ((place[i] as number) < 0) {
      away[i] = 1
      if (outside < 0) outside = i
      else parent[i] = outside
    }
  if (outside < 0) return { place, ranked }
  const out = new Int32Array(place)
  const join = (a: number, b: number, at: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    const outA = ra === find(outside)
    const outB = rb === find(outside)
    if (outA || outB) {
      // joined to the sea: everyone in the other company is placed here
      const inner = outA ? rb : ra
      for (const m of members.get(inner) ?? []) out[m] = at
      members.delete(inner)
      parent[inner] = outA ? ra : rb
      return
    }
    const ma = members.get(ra) ?? []
    const mb = members.get(rb) ?? []
    if (ma.length < mb.length) {
      parent[ra] = rb
      members.set(rb, mb.concat(ma))
      members.delete(ra)
    } else {
      parent[rb] = ra
      members.set(ra, ma.concat(mb))
      members.delete(rb)
    }
  }
  const order: number[] = []
  for (let i = 0; i < N; i++) if ((place[i] as number) >= 0) order.push(i)
  order.sort((a, b) => (place[b] as number) - (place[a] as number) || b - a)
  for (const j of order) {
    away[j] = 1
    members.set(j, [j])
    for (const n of g.neighbours(j)) if (n >= 0 && away[n]) join(j, n, place[j] as number)
    if (find(j) === find(outside)) out[j] = Math.min(out[j] as number, place[j] as number)
  }
  return { place: out, ranked }
}

/** The island's base, where the skirt and a sunk tile end (job.ts' ground base). */
const BASE = -2.5
/** The skirt's colour: the ground's land side (job.ts SIDE_LAND), sRGB. */
const SKIRT_RGB: readonly [number, number, number] = [122, 90, 60]

/**
 * Where everything stands in the reveal order: its tile's place. What stands on the sea (a dock, a
 * beach slope, a bridge's end) takes its coast tile's (the earliest of the tiles round it). A triangle
 * on a wall is pushed a little against its normal first: a wall belongs to the tile it stands on, a
 * beach slope to the tile it runs down from.
 */
export function placer(h: HexIsland, { place, ranked }: TilePlaces): PlaceAt {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const tileAt = (x: number, z: number): number => {
    const { q, r } = hexAt(x / R, z / R)
    return g.index(q, r)
  }
  const placeAt = (x: number, z: number): number => {
    const i = tileAt(x, z)
    return i < 0 ? -1 : (place[i] as number)
  }
  const earliestRound = (x: number, z: number): number => {
    const i = tileAt(x, z)
    if (i < 0) return -1
    let best = -1
    for (const j of g.neighbours(i)) {
      if (j < 0) continue
      const p = place[j] as number
      if (p >= 0 && (best < 0 || p < best)) best = p
    }
    return best
  }
  return (x, z, nx, nz) => {
    const len = Math.hypot(nx, nz)
    // a wall or a slope: a little against its outward normal is the tile it belongs to
    if (len > 1e-3) {
      const px = x - (nx / len) * 0.35
      const pz = z - (nz / len) * 0.35
      const p = placeAt(px, pz)
      if (p >= 0) return p
      // a beach slope reaches well out: its tile is further back
      const p2 = placeAt(x - (nx / len) * R * 0.9, z - (nz / len) * R * 0.9)
      if (p2 >= 0) return p2
    }
    const p = placeAt(x, z)
    if (p >= 0) return p
    // on the sea: the earliest coast tile round it, else last of all
    const near = earliestRound(x, z)
    return near >= 0 ? near : ranked
  }
}

/**
 * The frontier's skirt: a wall down to the island's base on every tile edge whose neighbour comes
 * later and whose ground has no wall of its own there (the neighbour's top is level or higher). Each
 * wall carries its tile's place and leaves at the neighbour's (`until`), so a revealed island always
 * ends in a side, never an open cut.
 */
export function skirt(
  h: HexIsland,
  groundAt: (x: number, z: number) => number,
  { place }: TilePlaces,
): { data: VertexMeshData; until: Float32Array } {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const corners: [number, number][] = []
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30)
    corners.push([Math.cos(a) * R, Math.sin(a) * R])
  }
  const placeOf = (i: number) => place[i] as number
  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  const until: number[] = []
  const rgb = SKIRT_RGB.map((c) => srgbToLinear(c / 255)) as [number, number, number]
  const SEGMENTS = 3
  const put = (x: number, y: number, z: number, nx: number, nz: number, shade: number) => {
    pos.push(x, y, z)
    nor.push(nx, 0, nz)
    col.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade)
  }
  for (let i = 0; i < g.size; i++) {
    if (placeOf(i) < 0) continue
    const mine = placeOf(i)
    const [cx, cz] = [g.q[i] as number, g.r[i] as number]
    const x0 = R * Math.sqrt(3) * (cx + cz / 2)
    const z0 = R * 1.5 * cz
    const nb = g.neighbours(i)
    for (let k = 0; k < 6; k++) {
      // edge k (corners k, k+1) faces direction 60°·k, neighbour d = (6 - k) % 6 (world ground.ts)
      const j = nb[(6 - k) % 6] as number
      if (j < 0 || placeOf(j) < 0) continue
      const theirs = placeOf(j)
      if (theirs <= mine) continue
      const ang = (Math.PI / 180) * (60 * k)
      const nx = Math.cos(ang)
      const nz = Math.sin(ang)
      const a = corners[k] as [number, number]
      const b = corners[(k + 1) % 6] as [number, number]
      for (let s = 0; s < SEGMENTS; s++) {
        const f0 = s / SEGMENTS
        const f1 = (s + 1) / SEGMENTS
        const ax = x0 + a[0] + (b[0] - a[0]) * f0
        const az = z0 + a[1] + (b[1] - a[1]) * f0
        const bx = x0 + a[0] + (b[0] - a[0]) * f1
        const bz = z0 + a[1] + (b[1] - a[1]) * f1
        const mx = (ax + bx) / 2
        const mz = (az + bz) / 2
        // the ground just inside and just beyond the edge: a lower neighbour has a wall there already
        const ht = groundAt(mx - nx * 0.2, mz - nz * 0.2)
        const hn = groundAt(mx + nx * 0.2, mz + nz * 0.2)
        if (hn < ht - 0.05) continue
        const top = Math.max(
          ht,
          groundAt(ax - nx * 0.2, az - nz * 0.2),
          groundAt(bx - nx * 0.2, bz - nz * 0.2),
        )
        // facing out (counter-clockwise seen from above with +z down the screen)
        put(ax, top, az, nx, nz, 0.9)
        put(ax, BASE, az, nx, nz, 0.7)
        put(bx, top, bz, nx, nz, 0.9)
        put(bx, top, bz, nx, nz, 0.9)
        put(ax, BASE, az, nx, nz, 0.7)
        put(bx, BASE, bz, nx, nz, 0.7)
        until.push(theirs, theirs)
      }
    }
  }
  return {
    data: { position: new Float32Array(pos), normal: new Float32Array(nor), color: new Float32Array(col) },
    until: new Float32Array(until),
  }
}
