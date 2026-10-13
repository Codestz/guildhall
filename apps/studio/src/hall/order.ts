/**
 * The reveal order of a hex island's tiles for a history replay (replay/index.ts): the growth rank
 * (world `HexIsland.rank`), with its holes filled and its unranked land placed last.
 */
import type { HexIsland } from "@guildhall/world"

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
