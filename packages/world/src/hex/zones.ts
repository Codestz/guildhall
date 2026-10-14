/**
 * Step 2 of the hex world: zones, the places that become buildings, and the roads between them, all on
 * the tiles (decisions.md "Clean restart on hex").
 *
 * Places: every land tile is scored for each kind of place (flat ground, how central, water near, the
 * coast, height, forest, rock) and the best tile of each kind is taken in order, each a few tiles from
 * the ones before: the town on its reserved square (island.ts), the harbour on the sheltered shore nearest
 * it where its quay fits, the castle composed on its reserved site (sites.ts composeCastle), then villages that suit the land (a farm village on open lowland, a fishing
 * village on a far beach, a mining camp at the foot of the rock, a lumber camp at a forest's edge). A
 * bigger island gets more of them.
 *
 * Each place grows over the easy tiles round its heart (flat, dry, on its own level or one step off) to
 * its size, nearest first. Roads join the places: a spanning tree plus one loop, each road the cheapest
 * tile path (a step up or down costs, a river tile is a bridge and costs more, rock and lakes are
 * closed), and later roads ride the earlier ones. A road reaches the castle through its gate, never over
 * its walls. Where no gentle way joins a place to the rest, its road climbs two or three levels at once by
 * a flight of stairs, so every place is on the one network.
 *
 * Then every tile of a place gets a job, so it reads when built: the heart is a square; a road tile is
 * a street; a tile beside a street is a building (thinned by the place's density, never a solid block);
 * the rest are yards and gardens. Round a farm village and the town's edge, open lowland becomes fields.
 */
import { hash2 } from "../geom/noise.ts"
import { type GraveyardSite, graveyardSite } from "./graveyard.ts"
import type { HexIsland, HexKind } from "./island.ts"
import { forestLine, kindOf } from "./island.ts"
import { CASTLE_TILES, type CastlePlan, castleFoot, composeCastle } from "./sites.ts"

export { CASTLE_TILES }

export const ZONE_KINDS = [
  "town",
  "harbour",
  "castle",
  "farm",
  "fishing",
  "mine",
  "lumber",
  "monastery",
  "camp",
  "hamlet",
  "market",
] as const
export type ZoneKind = (typeof ZONE_KINDS)[number]

/** What a tile is for. */
export const TILE_USES = [
  "none",
  "square",
  "building",
  "landmark",
  "yard",
  "road",
  "bridge",
  "field",
  "dock",
  // what fills a place between its buildings
  "garden",
  "market",
  "well",
  // the countryside: every land tile outside the places gets one of these (each a tile prefab later)
  "farmstead",
  "orchard",
  "pasture",
  "woods",
  "grove",
  "meadow",
  "hillside",
  "crag",
  "quarry",
  "beach",
  "bluff",
  "reeds",
  "windmill",
  "watermill",
  "lighthouse",
  "watchtower",
  "ruins",
  "shrine",
  "campsite",
  "sawmill",
  "hunter",
  "shepherd",
  "homestead",
  // a castle's paved ways, from its gate to its doors (sites.ts composeCastle)
  "court",
  // the island's graveyard near the town (graveyard.ts): its front tile and the one behind it
  "graveyard",
] as const
export type TileUse = (typeof TILE_USES)[number]

/**
 * A place the repo asks for (plan-hud-events.md E3 / W1: a unit of the Repo Chronicle, a top-level folder
 * or a workspace package, as sim's `placeSpecs` turns it into one). `hexZones` gives each its own zone,
 * sized by its share of the repo's files, in the order given: the capital first (the town on the
 * reserved square), then the rest, so a spec list that only grows keeps every earlier heart where it was.
 */
export interface PlaceSpec {
  /** The unit it stands for, as the chronicle names it ("packages/react-dom", "src", "/"). */
  id: string
  /** The name on its plate. */
  label: string
  /**
   * What it is built as. `settlement` is sized by `tier` (hamlet, village, town) and finds its heart by
   * one rule whatever the tier, so a unit that grows keeps its place and builds it up.
   */
  kind: ZoneKind | "settlement"
  /** The settlement's tier: 1 a hamlet, 2 a village (with fields), 3 a market town. */
  tier?: 1 | 2 | 3
  /** Files in the unit now: its size relative to the others. */
  files: number
  /** The capital: the town on the reserved square, the Guildhall's. One spec at most, the first. */
  capital?: true
  /** The units a pooled place stands for (several small ones as one hamlet). */
  pooled?: string[]
  /**
   * The land tiles the island had when the unit was born (`landTiles(filesAt(c, born))`): its heart is
   * ranked under this (island.ts growth order) wherever the land allows, so a history replay that reveals
   * the island in growth order shows the place from the unit's birth. Left out: no preference.
   */
  rankMax?: number
}

export interface HexZone {
  kind: ZoneKind
  /** The heart tile. */
  tile: number
  /** Tiles it holds. */
  tiles: number[]
  buildings: number
  /** The repo unit this place stands for (`hexZones` with `places`); none for the island's own places. */
  place?: PlaceSpec
}

export interface HexRoad {
  /** Zone indices it joins. */
  a: number
  b: number
  /** Tile path, a to b. */
  tiles: number[]
}

export interface HexZones {
  zones: HexZone[]
  roads: HexRoad[]
  /** Zone index + 1 per tile (0 none). */
  zoneOf: Int16Array
  /** TILE_USES index per tile. */
  use: Uint8Array
  /** The Guildhall castle's tier, 1–4 (`castleTier`): how big its zone grew and what is built on it. */
  tier: number
  /** The castle composed for its site (sites.ts `composeCastle`), null when the island has none. */
  castle: CastlePlan | null
  /** The graveyard (graveyard.ts `graveyardSite`): its tiles and the side its gate opens onto; null without one. */
  graveyard: GraveyardSite | null
  stats: { buildings: number; roadTiles: number; bridges: number; fields: number; ms: number }
}

/**
 * The Guildhall's tier (decisions.md "Castle = the Guildhall"): a keep alone (1), a walled keep (2), a
 * castle with wards and its great hall (3), a citadel (4). It grows with the repo's files, a step up for
 * a big crew of agents and a step down for a lone one.
 */
export function castleTier(files: number, agents = 3): number {
  const base = files < 1000 ? 1 : files < 3000 ? 2 : files < 8000 ? 3 : 4
  return Math.min(4, Math.max(1, base + (agents >= 6 ? 1 : agents <= 1 ? -1 : 0)))
}

/** How big each kind grows (tiles, per 1,000 land tiles, at least `min`), how built up it is, and how far apart it keeps. */
const PLAN: Record<ZoneKind, { per1k: number; min: number; density: number; apart: number }> = {
  town: { per1k: 62, min: 30, density: 0.8, apart: 0 },
  harbour: { per1k: 9, min: 6, density: 0.55, apart: 6 },
  // its site is reserved on the island and composed by tier (sites.ts CASTLE_TILES, composeCastle), not grown
  castle: { per1k: 0, min: 1, density: 0.4, apart: 6 },
  farm: { per1k: 10, min: 6, density: 0.32, apart: 10 },
  fishing: { per1k: 7, min: 5, density: 0.4, apart: 10 },
  mine: { per1k: 5, min: 4, density: 0.4, apart: 9 },
  lumber: { per1k: 5, min: 4, density: 0.4, apart: 9 },
  monastery: { per1k: 4, min: 4, density: 0.45, apart: 10 },
  camp: { per1k: 4, min: 4, density: 0.5, apart: 9 },
  hamlet: { per1k: 4, min: 4, density: 0.55, apart: 8 },
  market: { per1k: 7, min: 6, density: 0.6, apart: 12 },
}

const U = Object.fromEntries(TILE_USES.map((k, i) => [k, i])) as Record<TileUse, number>

/** The share of the land tiles the repo's places take between them (the island's own kinds take about this). */
const PLACE_SHARE = 0.3
/** The capital's biggest size: the town's own (`PLAN.town.per1k`); no other place grows past this share of it. */
const CAPITAL_CAP = 0.6
/** How far a repo's settlement keeps from the places before it (its tier never moves it). */
const SETTLEMENT_APART = 8

/** What a settlement of `tier` is built as: a hamlet, a farm village with fields, a market town. */
export const settlementKind = (tier: PlaceSpec["tier"]): ZoneKind =>
  tier === 3 ? "market" : tier === 2 ? "farm" : "hamlet"

/**
 * The tiles each repo place grows to, by its share of the files: the capital at most the town's own
 * size, the others their share of what is left, never past CAPITAL_CAP of the capital, never under
 * their kind's least. The island's own places (none of `specs`) keep `PLAN`.
 */
export function placeSizes(specs: readonly PlaceSpec[], land: number): Map<string, number> {
  const out = new Map<string, number>()
  const budget = PLACE_SHARE * land
  const capital = specs.find((s) => s.capital)
  const total = specs.reduce((n, s) => n + Math.max(0, s.files), 0)
  const townMost = Math.max(PLAN.town.min, Math.round((PLAN.town.per1k * land) / 1000))
  const capitalTiles = capital
    ? Math.min(townMost, Math.max(PLAN.town.min, Math.round((budget * capital.files) / Math.max(1, total))))
    : 0
  if (capital) out.set(capital.id, capitalTiles)
  const rest = Math.max(0, budget - capitalTiles)
  const others = total - (capital?.files ?? 0)
  const cap = Math.max(PLAN.hamlet.min, Math.round((capitalTiles || townMost) * CAPITAL_CAP))
  for (const s of specs) {
    if (s.capital) continue
    const kind = s.kind === "settlement" ? settlementKind(s.tier) : s.kind
    const want = Math.round((rest * Math.max(0, s.files)) / Math.max(1, others))
    out.set(s.id, Math.min(cap, Math.max(PLAN[kind].min, want)))
  }
  return out
}

/** Cheapest tile path from `from` to any tile `goal` accepts; null if none. */
function path(
  h: HexIsland,
  from: number,
  goal: (i: number) => boolean,
  cost: (a: number, b: number) => number,
): number[] | null {
  const g = h.grid
  const dist = new Float64Array(g.size).fill(Infinity)
  const prev = new Int32Array(g.size).fill(-1)
  const heap: [number, number][] = []
  const push = (d: number, i: number) => {
    heap.push([d, i])
    let j = heap.length - 1
    while (j > 0) {
      const p = (j - 1) >> 1
      if (heap[p]![0] <= d) break
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
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r
        if (m === j) break
        ;[heap[m], heap[j]] = [heap[j]!, heap[m]!]
        j = m
      }
    }
    return top
  }
  push(0, from)
  dist[from] = 0
  while (heap.length) {
    const [d, i] = pop()
    if (d > dist[i]!) continue
    if (i !== from && goal(i)) {
      const out = [i]
      let k = i
      while (prev[k]! >= 0) {
        k = prev[k]!
        out.push(k)
      }
      return out.reverse()
    }
    for (const j of g.neighbours(i)) {
      if (j < 0) continue
      const c = cost(i, j)
      if (!Number.isFinite(c)) continue
      if (d + c < dist[j]!) {
        dist[j] = d + c
        prev[j] = i
        push(d + c, j)
      }
    }
  }
  return null
}

/**
 * `wild` (default 1, nature.ts `HexNature.wild`) moves the open country's woods line: the island's forest
 * share times `wild` decides which of the leftover country tiles (the ones no place, farm or work site took)
 * are woods, by the same moisture field that grew the island's forest. Places and roads never move.
 *
 * `places` (a repo's units, sim `placeSpecs`) replaces the island's own list of places: the capital is the
 * town on the reserved square, then each place in the order given takes the best tile for its kind (a
 * settlement by one rule whatever its tier, so growing never moves it), sized by its share of the files
 * (`placeSizes`); a kind the land has no site for (no shore, no rock) settles as a hamlet would. The
 * countryside's pockets fill as before. Without `places` nothing changes.
 */
export function hexZones(
  h: HexIsland,
  opts: { agents?: number; wild?: number; places?: readonly PlaceSpec[] } = {},
): HexZones {
  const t0 = performance.now()
  const tier = castleTier(h.spec.files, opts.agents)
  const g = h.grid
  const N = g.size
  const seed = h.spec.seed
  const kind = (i: number) => kindOf(h, i)
  const wild = opts.wild ?? 1
  const wildLine = 1 - forestLine(h.spec.forest * wild)
  /** A leftover country tile's ground once `wild` has moved the woods line (its own kind at wild 1). */
  const wildKind = (i: number): HexKind => {
    const k = kind(i)
    const m = h.moisture[i]!
    if (wild === 1 || Number.isNaN(m) || (k !== "forest" && k !== "hill" && k !== "grass" && k !== "meadow"))
      return k
    if (m > wildLine) return "forest"
    if (k !== "forest") return k
    return h.level[i]! >= 3 ? "hill" : "meadow"
  }
  const dry = (i: number) => {
    const k = kind(i)
    return k !== "sea" && k !== "shallows" && k !== "lake" && k !== "river" && k !== "rock"
  }
  const flatness = (i: number) => {
    let n = 0
    for (const j of g.neighbours(i)) if (j >= 0 && dry(j) && h.level[j] === h.level[i]) n++
    return n / 6
  }
  // steps from water (river, lake) and from forest and rock, for scoring
  const stepsFrom = (src: (i: number) => boolean): Int16Array => {
    const d = new Int16Array(N).fill(999)
    const q: number[] = []
    for (let i = 0; i < N; i++)
      if (src(i)) {
        d[i] = 0
        q.push(i)
      }
    for (let k = 0; k < q.length; k++) {
      const i = q[k]!
      for (const j of g.neighbours(i))
        if (j >= 0 && d[j]! > d[i]! + 1) {
          d[j] = d[i]! + 1
          q.push(j)
        }
    }
    return d
  }
  const toWater = stepsFrom((i) => kind(i) === "river" || kind(i) === "lake")
  const toForest = stepsFrom((i) => kind(i) === "forest")
  const toRock = stepsFrom((i) => kind(i) === "rock")
  let land = 0
  let topLevel = 1
  for (let i = 0; i < N; i++)
    if (dry(i)) {
      land++
      topLevel = Math.max(topLevel, h.level[i]!)
    }
  const ring = (i: number) => g.ring(i)

  const zones: HexZone[] = []
  const far = (i: number, apart: number) =>
    zones.every((z) => {
      const dq = g.q[i]! - g.q[z.tile]!
      const dr = g.r[i]! - g.r[z.tile]!
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 >= apart
    })
  const dist = (i: number, j: number) => {
    const dq = g.q[i]! - g.q[j]!
    const dr = g.r[i]! - g.r[j]!
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
  }
  // the castle's reserved site (island.ts): no other place is put or grows on it, at any tier
  const site = new Set(h.sites.castle)
  // and its foot (sites.ts castleFoot): the notches of its outline, open ground its curtain may stand out over
  const foot = new Set(castleFoot(g, h.sites.castle))
  /**
   * Whether a dry tile at sea level, facing its street through side `front`, has the two shallows its
   * quay stands out over: straight behind it and one beside that (world.ts harbour-quay, as authored or mirrored).
   */
  const quaySite = (t: number, front: number): boolean => {
    if (!dry(t) || h.level[t] !== 0) return false
    const nb = g.neighbours(t)
    const sh = (e: number) => nb[(front + e) % 6]! >= 0 && kind(nb[(front + e) % 6]!) === "shallows"
    return sh(3) && (sh(2) || sh(4))
  }
  const score = (k: ZoneKind, i: number): number => {
    if (!dry(i) || site.has(i)) return -1
    const f = flatness(i)
    const L = h.level[i]!
    const town = zones[0]?.tile
    switch (k) {
      case "town":
        return f >= 0.8 && L <= 3 ? f * 2 - ring(i) / 12 - Math.abs(toWater[i]! - 2) * 0.15 : -1
      case "harbour": {
        if (kind(i) !== "sand" || town === undefined) return -1
        let land = 0
        for (const j of g.neighbours(i)) if (j >= 0 && dry(j)) land++
        // a site for its quay (world.ts harbour-quay): a shore tile beside the square, facing it, with the
        // shallows behind it, so the quay's warehouse fronts a street with its deck out over the water
        const quay = [...g.neighbours(i)].some((t, d) => t >= 0 && quaySite(t, (d + 3) % 6))
        return land / 6 - dist(i, town) / 15 + (quay ? 0.8 : 0)
      }
      case "castle":
        return town !== undefined && L >= 3 && dist(i, town) >= 4 && dist(i, town) <= 14
          ? L + f - dist(i, town) / 8
          : -1
      case "farm":
        return f >= 0.8 && L <= 2 && toForest[i]! >= 2 && kind(i) !== "sand"
          ? f + (town === undefined ? 0 : dist(i, town) / 40)
          : -1
      case "fishing":
        return kind(i) === "sand" && town !== undefined ? dist(i, town) / 20 + flatness(i) : -1
      case "mine":
        return toRock[i]! >= 1 && toRock[i]! <= 2 && f >= 0.5 ? 2 - toRock[i]! * 0.3 + f : -1
      case "lumber":
        return kind(i) !== "forest" && toForest[i]! === 1 && f >= 0.6
          ? f + (town === undefined ? 0 : dist(i, town) / 40)
          : -1
      // a quiet hill, far from the town
      case "monastery":
        return L >= 2 && f >= 0.6 && town !== undefined ? L * 0.5 + dist(i, town) / 15 + h1z(1, i) : -1
      // a fort on open ground between the town and the far coast
      case "camp":
        return f >= 0.8 && L <= 3 && town !== undefined && dist(i, town) >= 10 ? f + h1z(2, i) * 1.5 : -1
      // small clusters scattered in the open country, away from everything
      case "hamlet":
        return f >= 0.7 && L <= 3 && kind(i) !== "sand"
          ? Math.min(...zones.map((zz) => dist(i, zz.tile))) / 10 + h1z(3, i)
          : -1
      // a crossroads market village, halfway out
      case "market":
        return f >= 0.85 && L <= 2 && town !== undefined ? -Math.abs(dist(i, town) - 16) / 6 + h1z(4, i) : -1
    }
  }
  const h1z = (k: number, i: number) => hash2(seed + 600 + k, g.q[i]!, g.r[i]!)
  /** A place to put: its kind, and the repo unit it stands for when the repo asked for it. */
  interface Slot {
    kind: ZoneKind
    spec?: PlaceSpec
  }
  const slots: Slot[] = []
  if (opts.places) {
    // the repo's places: the capital on the square, the castle, then each unit in the order given
    const capital = opts.places.find((s) => s.capital)
    slots.push({ kind: "town", ...(capital ? { spec: capital } : {}) }, { kind: "castle" })
    for (const s of opts.places)
      if (!s.capital) slots.push({ kind: s.kind === "settlement" ? settlementKind(s.tier) : s.kind, spec: s })
  } else {
    const order: ZoneKind[] = [
      "town",
      "harbour",
      "castle",
      "market",
      "farm",
      "fishing",
      "mine",
      "lumber",
      "monastery",
      "camp",
    ]
    // hamlets fill the open country: more of them the bigger the island
    for (let k = 0; k < Math.round(land / 450); k++) order.push("hamlet")
    // a bigger island gets a second farm and fishing village
    if (land > 1400) order.push("farm", "fishing")
    if (land > 2200) order.push("farm", "lumber")
    for (const kind of order) slots.push({ kind })
  }
  /** The best tile for a place of kind `rule`, at least `apart` steps from every place so far (-1: none). */
  // (a repo's place never settles on a cliff or the castle's foot: its heart could not grow there)
  const grows = (i: number) => !opts.places || (!foot.has(i) && kind(i) !== "cliff")
  /**
   * A repo's settlement: flat low ground, not the shore, as near the capital as the places before it
   * allow (decisions.md "centre-out growth": the units come oldest first, so the oldest settle round the
   * capital and the newer ones ring outward); nothing of its size in the rule, so growing never moves it.
   */
  const settlementScore = (i: number): number => {
    if (!dry(i) || site.has(i) || kind(i) === "sand" || h.level[i]! > 3) return -1
    const f = flatness(i)
    if (f < 0.7) return -1
    const town = zones[0]?.tile
    return f + (town === undefined ? 0 : -dist(i, town) / 10) + h1z(3, i) * 0.5
  }
  /** With `budget`, only tiles grown before it (island.ts `rank`): the land the island had when the unit was born. */
  const pickTile = (rule: ZoneKind | "settlement" | "any", apart: number, budget = Infinity): number => {
    let best = -1
    let bs = -1e9
    for (let i = 0; i < N; i++) {
      if (h.rank[i]! < 0 || h.rank[i]! >= budget) continue
      // any: open dry ground, when no rule's site is left for a repo's place
      const s =
        rule === "any"
          ? dry(i) && !site.has(i) && !foot.has(i) && kind(i) !== "cliff"
            ? flatness(i) + h1z(5, i) * 0.3
            : -1
          : rule === "settlement"
            ? settlementScore(i)
            : score(rule, i)
      if (s < -0.5 || s <= bs || !far(i, apart) || !grows(i)) continue
      best = i
      bs = s
    }
    return best
  }
  // the town's square and the castle are the reserved sites (island.ts), the castle composed for its own
  let plan: CastlePlan | null = null
  for (const { kind: k, spec } of slots) {
    const square = h.sites.town[0]
    if (k === "town" && square !== undefined && dry(square)) {
      zones.push({ kind: k, tile: square, tiles: [], buildings: 0, ...(spec ? { place: spec } : {}) })
      continue
    }
    if (k === "castle") {
      const town = zones[0]?.tile ?? 0
      plan = composeCastle(g, h.sites.castle, tier, {
        town,
        seed,
        usable: (i) => dry(i) && kind(i) !== "cliff",
        open: (from, to) => {
          const kk = kind(to)
          if (kk === "sea" || kk === "shallows" || kk === "lake" || kk === "rock" || kk === "cliff")
            return false
          if (Math.abs(h.level[to]! - h.level[from]!) > 1) return false
          // a river at the gate is the moat: the road bridges it from the land beyond
          if (kk === "river")
            return [...g.neighbours(to)].some((j) => j >= 0 && j !== from && dry(j) && !site.has(j))
          return true
        },
        foot: (j) =>
          (site.has(j) || foot.has(j)) &&
          dry(j) &&
          kind(j) !== "cliff" &&
          h.level[j] === h.level[h.sites.castle[0]!],
      })
      if (plan) zones.push({ kind: k, tile: plan.heart, tiles: [...plan.tiles], buildings: 0 })
      continue
    }
    let best: number
    if (spec) {
      // a repo's place: its kind's best site; a settlement by one rule whatever its tier (so a unit that
      // grows keeps its heart); and a kind the land has no site for (no shore for a harbour, no rock for
      // a mine) settles as a settlement would, nearer the others when it must
      // (first on the land the island had when the unit was born, so a replay shows it from its birth;
      // a kind that land has no site for, a harbour before the shore grew, takes the best site there is)
      const settlement = spec.kind === "settlement"
      best = -1
      // (a place that had to settle off its kind's site is built as a settlement: no harbour without a shore)
      let settled = settlement
      for (const budget of spec.rankMax !== undefined ? [spec.rankMax, Infinity] : [Infinity]) {
        best = pickTile(
          settlement ? "settlement" : k,
          settlement ? SETTLEMENT_APART : PLAN[k].apart || 6,
          budget,
        )
        if (best >= 0) break
        for (const apart of [SETTLEMENT_APART, 5, 4, 3])
          if (best < 0) best = pickTile("settlement", apart, budget)
        if (best < 0) best = pickTile("any", 2, budget)
        if (best >= 0) {
          settled = true
          break
        }
      }
      if (best >= 0)
        zones.push({
          kind: settled && !settlement ? settlementKind(spec.tier) : k,
          tile: best,
          tiles: [],
          buildings: 0,
          place: spec,
        })
      continue
    }
    best = pickTile(k, PLAN[k].apart || 6)
    if (best >= 0) zones.push({ kind: k, tile: best, tiles: [], buildings: 0 })
  }
  // coverage: no stretch of land is left far from every place. The tile furthest from all of them gets
  // a new one, of the kind its ground suits, until every dry tile is within POCKET steps of a place.
  const POCKET = 7
  for (let n = 0; n < Math.round(land / 90); n++) {
    let best = -1
    let bd = 0
    for (let i = 0; i < N; i++) {
      if (!dry(i) || kind(i) === "cliff" || flatness(i) < 0.5 || site.has(i) || foot.has(i)) continue
      let d = 1e9
      for (const zz of zones) d = Math.min(d, dist(i, zz.tile))
      // a little seeded preference so pockets don't fill in a grid
      const sc = d + hash2(seed + 700, g.q[i]!, g.r[i]!) * 1.5
      if (d >= POCKET && sc > bd) {
        bd = sc
        best = i
      }
    }
    if (best < 0) break
    const k = kind(best)
    const u = hash2(seed + 701, g.q[best]!, g.r[best]!)
    // (a repo's island fills its pockets with hamlets, a fishing one on the shore: a camp or a monastery
    // there would read as a unit of the repo)
    const pick: ZoneKind = opts.places
      ? k === "sand"
        ? "fishing"
        : "hamlet"
      : k === "forest"
        ? u < 0.6
          ? "lumber"
          : "hamlet"
        : k === "sand"
          ? "fishing"
          : toRock[best]! <= 2
            ? "mine"
            : k === "hill" || h.level[best]! >= 3
              ? u < 0.35
                ? "monastery"
                : "hamlet"
              : u < 0.5
                ? "farm"
                : u < 0.8
                  ? "hamlet"
                  : "camp"
    zones.push({ kind: pick, tile: best, tiles: [], buildings: 0 })
  }

  // ---- each place grows over easy tiles round its heart ----
  const zoneOf = new Int16Array(N)
  // (a place never grows over another's heart: that place would be left with no tiles of its own)
  const hearts = new Set(zones.map((zz) => zz.tile))
  const ci = zones.findIndex((zz) => zz.kind === "castle")
  if (ci >= 0) for (const i of zones[ci]!.tiles) zoneOf[i] = ci + 1
  // a repo's places are sized by their share of its files; the island's own by their kind
  const sizes = placeSizes(opts.places ?? [], land)
  for (const [zi, z] of zones.entries()) {
    if (zi === ci) continue
    // (on a repo's island the pockets stay hamlet-sized, so no unnamed place outgrows a named one)
    const own = opts.places ? PLAN.hamlet : PLAN[z.kind]
    const want =
      (z.place && sizes.get(z.place.id)) ?? Math.max(own.min, Math.round((own.per1k * land) / 1000))
    const lvl = h.level[z.tile]!
    const queue = [z.tile]
    const seen = new Set(queue)
    for (let k = 0; k < queue.length && z.tiles.length < want; k++) {
      const i = queue[k]!
      if (zoneOf[i] || !dry(i) || kind(i) === "cliff" || site.has(i) || foot.has(i)) continue
      if (i !== z.tile && hearts.has(i)) continue
      // a place keeps to its own level or one step off it
      if (Math.abs(h.level[i]! - lvl) > 1) continue
      zoneOf[i] = zi + 1
      z.tiles.push(i)
      const nb = [...g.neighbours(i)].filter((j) => j >= 0 && !seen.has(j))
      // grow round, not in a line: nearer the heart first, with a little noise
      // (a repo's place grows first over the land its unit was born on, so a replay shows it whole sooner)
      const late = (i: number) => (z.place?.rankMax !== undefined && h.rank[i]! >= z.place.rankMax ? 3 : 0)
      nb.sort(
        (a, b) =>
          dist(a, z.tile) +
          hash2(seed + 3, a, zi) * 0.9 +
          late(a) -
          dist(b, z.tile) -
          hash2(seed + 3, b, zi) * 0.9 -
          late(b),
      )
      for (const j of nb) {
        seen.add(j)
        queue.push(j)
      }
    }
  }

  // ---- roads: spanning tree + one loop, cheapest tile paths ----
  const use = new Uint8Array(N)
  const routeEnds: [number, number] = [-1, -1]
  const walled = new Set(plan?.tiles ?? [])
  const footed = new Set(plan?.foot ?? [])
  // a road comes to the castle at its gate: from the tile outside it (over the moat's bridge), never over its walls
  const entryOk = !!plan && plan.entry >= 0 && plan.entry !== plan.gate && !walled.has(plan.entry)
  const endOf = (zi: number) => (zi === ci && plan ? (entryOk ? plan.entry : plan.gate) : zones[zi]!.tile)
  /** A road's step from tile a to b, climbing at most `climbMax` levels (more than one: by a flight of stairs, world.ts). */
  const roadStep = (a: number, b: number, climbMax: number): number => {
    const k = kind(b)
    if (k === "sea" || k === "shallows" || k === "rock" || k === "lake") return Infinity
    if (walled.has(b) && b !== routeEnds[0] && b !== routeEnds[1]) return Infinity
    // nor over the castle's foot where its curtain stands out over it
    if (footed.has(b) && b !== routeEnds[0] && b !== routeEnds[1]) return Infinity
    // never through another place's heart: its square holds its well, market or chapel
    if (hearts.has(b) && b !== routeEnds[0] && b !== routeEnds[1]) return Infinity
    const climb = Math.abs(h.level[b]! - h.level[a]!)
    if (climb > (k !== "river" && kind(a) !== "river" ? climbMax : 1)) return Infinity
    let c = 1 + climb * 2.5 + (climb > 1 ? 8 : 0)
    if (k === "river") c += 2.5
    if (k === "forest") c += 1.2
    if (k === "cliff" || k === "sand") c += 0.8
    if (use[b] === U.road || use[b] === U.bridge) c *= 0.35
    return c
  }
  const roadCost = (a: number, b: number) => roadStep(a, b, 1)
  /** The cheapest road from `from` to a tile `goal` accepts: by gentle steps, else up a flight of stairs where it must. */
  const route = (from: number, goal: (i: number) => boolean) =>
    path(h, from, goal, roadCost) ??
    path(h, from, goal, (a, b) => roadStep(a, b, 2)) ??
    path(h, from, goal, (a, b) => roadStep(a, b, 3))
  const pairs: [number, number, number][] = []
  for (let a = 0; a < zones.length; a++)
    for (let b = a + 1; b < zones.length; b++) pairs.push([a, b, dist(zones[a]!.tile, zones[b]!.tile)])
  pairs.sort((p, q) => p[2] - q[2])
  const parent = zones.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r]!
    return r
  }
  const links: [number, number][] = []
  const spare: [number, number][] = []
  for (const [a, b] of pairs) {
    if (find(a) !== find(b)) {
      parent[find(a)] = find(b)
      links.push([a, b])
    } else spare.push([a, b])
  }
  if (spare[0]) links.push(spare[0])
  links.sort((p, q) => Number(p[0] !== 0) - Number(q[0] !== 0))
  const roads: HexRoad[] = []
  // which places the roads built so far join (union-find)
  const joined = zones.map((_, i) => i)
  const find2 = (i: number): number => {
    let r = i
    while (joined[r] !== r) r = joined[r]!
    return r
  }
  for (const [a, b] of links) {
    const target = endOf(b)
    routeEnds[0] = endOf(a)
    routeEnds[1] = target
    const tiles = routeEnds[0] === target ? [target] : route(routeEnds[0], (i) => i === target)
    if (!tiles) continue
    // in through the gate
    if (plan && a === ci && tiles[0] !== plan.gate) tiles.unshift(plan.gate)
    if (plan && b === ci && tiles[tiles.length - 1] !== plan.gate) tiles.push(plan.gate)
    if (tiles.length < 2) continue
    roads.push({ a, b, tiles })
    for (const i of tiles) if (use[i] !== U.square) use[i] = kind(i) === "river" ? U.bridge : U.road
    joined[find2(a)] = find2(b)
  }
  // every place on the one network: a place the tree's roads left apart gets a road to the nearest tile of it
  const gaveUp = new Set<number>()
  for (;;) {
    const main = find2(0)
    const apart = zones.findIndex((_, zi) => find2(zi) !== main && !gaveUp.has(find2(zi)))
    if (apart < 0) break
    const net = new Set<number>()
    for (const r of roads) if (find2(r.a) === main) for (const i of r.tiles) if (!walled.has(i)) net.add(i)
    for (const [zi] of zones.entries()) if (find2(zi) === main) net.add(endOf(zi))
    routeEnds[0] = endOf(apart)
    routeEnds[1] = -1
    const tiles = route(routeEnds[0], (i) => net.has(i))
    if (!tiles) {
      // none can be built: leave it apart (counted by the site checks) and try the others
      gaveUp.add(find2(apart))
      continue
    }
    if (plan && apart === ci && tiles[0] !== plan.gate) tiles.unshift(plan.gate)
    roads.push({ a: apart, b: 0, tiles })
    for (const i of tiles) if (use[i] !== U.square) use[i] = kind(i) === "river" ? U.bridge : U.road
    joined[find2(apart)] = main
  }
  // town streets: from the square out through the town, a spoke each way the town reaches
  const town = zones.find((z) => z.kind === "town")
  if (town) {
    const ti = zones.indexOf(town) + 1
    for (const d of [0, 2, 3, 5]) {
      let i: number = town.tile
      const street = [i]
      for (let k = 0; k < 12; k++) {
        const j = g.neighbours(i)[(d + (hash2(seed + 9, k, d) < 0.25 ? 1 : 0)) % 6]!
        if (j < 0 || zoneOf[j] !== ti || kind(j) === "river") break
        if (use[j] !== U.bridge) use[j] = U.road
        street.push(j)
        i = j
      }
      if (street.length > 1) roads.push({ a: ti - 1, b: ti - 1, tiles: street })
    }
    // a ring street round the square, three tiles out: the spokes meet it, so the town is a web of
    // streets and every inner tile fronts one
    const ringR = 3
    let cur = -1
    for (const i of town.tiles) if (dist(i, town.tile) === ringR && (cur < 0 || i < cur)) cur = i
    if (cur >= 0) {
      const ring = [cur]
      const seen = new Set(ring)
      for (;;) {
        const next = [...g.neighbours(cur)].find(
          (j) =>
            j >= 0 && !seen.has(j) && dist(j, town.tile) === ringR && zoneOf[j] === ti && kind(j) !== "river",
        )
        if (next === undefined) break
        seen.add(next)
        ring.push(next)
        cur = next
      }
      // (a stretch of two is a street like any, joined on below; a lone tile is no street: it is left
      // to what the town builds, unless a spoke already runs over it)
      if (ring.length >= 2) {
        for (const i of ring) if (use[i] !== U.bridge) use[i] = U.road
        roads.push({ a: ti - 1, b: ti - 1, tiles: ring })
      }
    }
    // a street the spokes never meet (a broken ring) gets a lane to the nearest street that is joined
    for (let n = 0; n < 8; n++) {
      const on = new Map<number, number[]>()
      for (const [k, r] of roads.entries()) for (const i of r.tiles) on.set(i, [...(on.get(i) ?? []), k])
      const joinedRoad = new Set<number>()
      const queue = on.get(town.tile) ?? []
      for (const k of queue) joinedRoad.add(k)
      for (let q = 0; q < queue.length; q++)
        for (const i of roads[queue[q]!]!.tiles)
          for (const k of on.get(i) ?? [])
            if (!joinedRoad.has(k)) {
              joinedRoad.add(k)
              queue.push(k)
            }
      const loose = roads.findIndex((_, k) => !joinedRoad.has(k))
      if (loose < 0) break
      const net = new Set<number>()
      for (const k of joinedRoad) for (const i of roads[k]!.tiles) if (!walled.has(i)) net.add(i)
      const from = roads[loose]!.tiles[0]!
      routeEnds[0] = from
      routeEnds[1] = -1
      const lane = route(from, (i) => net.has(i))
      if (!lane) break
      roads.push({ a: ti - 1, b: ti - 1, tiles: lane })
      for (const i of lane) if (!use[i]) use[i] = kind(i) === "river" ? U.bridge : U.road
    }
  }

  // the castle's ways: from its gate to its heart and to each door, paved
  if (plan) for (const way of plan.ways) roads.push({ a: ci, b: ci, tiles: way })

  // ---- every tile of a place gets a job ----
  for (const [zi, z] of zones.entries()) {
    if (zi === ci && plan) {
      // the castle's, as composed: the keep and the great hall its landmarks, towers and barracks its
      // buildings, the ways paved courts, the rest its yard
      for (const i of z.tiles) {
        const r = plan.role.get(i)
        use[i] =
          r === "keep" || r === "hall"
            ? U.landmark
            : r === "tower" || r === "barracks"
              ? U.building
              : r === "court"
                ? U.court
                : U.yard
      }
      z.buildings = z.tiles.filter((i) => use[i] === U.building || use[i] === U.landmark).length
      continue
    }
    use[z.tile] = U.square
    // the harbour keeps its quay's site: the shore tile beside its square with the shallows behind it builds
    if (z.kind === "harbour") {
      const nb = g.neighbours(z.tile)
      const d = [0, 1, 2, 3, 4, 5].find(
        (e) => nb[e]! >= 0 && !use[nb[e]!] && zoneOf[nb[e]!] === zi + 1 && quaySite(nb[e]!, (e + 3) % 6),
      )
      if (d !== undefined) use[nb[d]!] = U.building
    }
    const P = PLAN[z.kind]
    for (const i of z.tiles) {
      if (use[i]) continue
      const byRoad = [...g.neighbours(i)].some((j) => j >= 0 && (use[j] === U.road || use[j] === U.square))
      const built = [...g.neighbours(i)].filter((j) => j >= 0 && use[j] === U.building).length
      // a building fronts a street; never a solid block (at most two built neighbours, three in town)
      const cap = z.kind === "town" ? 3 : 2
      if (byRoad && built <= cap && hash2(seed + 21, i, zi) < P.density + 0.25) use[i] = U.building
      else if (!byRoad && built <= cap - 1 && hash2(seed + 23, i, zi) < P.density * 0.45) use[i] = U.building
      else use[i] = U.yard
    }
    // what stands between the buildings: market stalls round the town square, a well in each place,
    // gardens and allotments in the rest
    let well = false
    for (const i of z.tiles) {
      if (use[i] !== U.yard) continue
      const bySquare = [...g.neighbours(i)].some((j) => j === z.tile)
      if (z.kind === "town" && bySquare) use[i] = U.market
      else if (!well && dist(i, z.tile) <= 2) {
        use[i] = U.well
        well = true
      } else use[i] = U.garden
    }
    // docks: the harbour's and the fishing village's sea side
    if (z.kind === "harbour" || z.kind === "fishing")
      for (const i of z.tiles)
        for (const j of g.neighbours(i))
          if (j >= 0 && kind(j) === "shallows" && !use[j] && hash2(seed + 27, j, zi) < 0.5) use[j] = U.dock
    z.buildings = z.tiles.filter((i) => use[i] === U.building).length
  }
  // the castle's ground its next tiers take: open meadow until then
  // (and its foot, open)
  for (const i of [...site, ...foot]) if (!use[i] && !zoneOf[i] && dry(i)) use[i] = U.meadow
  // fields round the farm villages and the town's edge
  for (const z of zones) {
    if (z.kind !== "farm" && z.kind !== "town") continue
    const R = z.kind === "farm" ? 5 : 7
    for (let i = 0; i < N; i++) {
      if (use[i] || zoneOf[i] || !dry(i)) continue
      const k = kind(i)
      if (k !== "grass" && k !== "meadow") continue
      const d = dist(i, z.tile)
      if (d > R || d < 2) continue
      if (hash2(seed + 31, g.q[i]!, g.r[i]!) < (z.kind === "farm" ? 0.85 : 0.5)) use[i] = U.field
    }
  }
  // ---- the countryside: every land tile gets content, so nothing is bare ----
  const toRoad = stepsFrom((i) => use[i] === U.road || use[i] === U.bridge)
  const toZone = stepsFrom((i) => zoneOf[i]! > 0)
  const free = (i: number) => !use[i] && !zoneOf[i]
  const h1 = (k: number, i: number) => hash2(seed + 100 + k, g.q[i]!, g.r[i]!)
  // landmarks first, one each where it suits best
  const pick = (u: TileUse, score: (i: number) => number) => {
    let best = -1
    let bs = -1e9
    for (let i = 0; i < N; i++) {
      if (!free(i) || !dry(i)) continue
      const sc = score(i)
      if (sc > bs && zones.every((zz) => dist(i, zz.tile) >= 3)) {
        bs = sc
        best = i
      }
    }
    if (best >= 0 && bs > -1e8) use[best] = U[u]
  }
  const townTile = zones[0]?.tile ?? 0
  pick("lighthouse", (i) => (kind(i) === "cliff" ? dist(i, townTile) + h1(1, i) : -1e9))
  pick("watchtower", (i) => (kind(i) === "hill" ? h.level[i]! * 2 - dist(i, townTile) / 6 + h1(2, i) : -1e9))
  pick("ruins", (i) => (kind(i) === "forest" ? toZone[i]! + toRoad[i]! * 0.5 + h1(3, i) : -1e9))
  pick("shrine", (i) =>
    kind(i) === "meadow" || kind(i) === "grass" ? toZone[i]! * 0.6 + h1(4, i) * 3 - toRoad[i]! * 0.3 : -1e9,
  )
  // the campsite and its fishing spot on the nature lake's shore, near a road (any lake if it has none)
  const natureLake = new Set(h.lake)
  pick("campsite", (i) => {
    let lake = 0
    let nature = 0
    for (const j of g.neighbours(i))
      if (j >= 0 && kind(j) === "lake") {
        lake++
        if (natureLake.has(j)) nature++
      }
    return lake ? lake + (nature ? 6 : 0) - Math.min(4, toRoad[i]!) * 0.8 + h1(5, i) : -1e9
  })
  for (let n = 0; n < Math.max(1, Math.round(land / 900)); n++)
    pick("windmill", (i) => {
      let fields = 0
      for (const j of g.neighbours(i)) if (j >= 0 && use[j] === U.field) fields++
      return fields ? fields + h.level[i]! * 0.5 + h1(6 + n, i) : -1e9
    })
  // a watermill where the land meets a river: its race runs off the tile's edge into the water
  pick("watermill", (i) => {
    if (kind(i) !== "grass" && kind(i) !== "meadow") return -1e9
    let river = 0
    for (const j of g.neighbours(i)) if (j >= 0 && kind(j) === "river") river++
    return river ? 4 - Math.min(5, toRoad[i]!) * 0.8 + h1(7, i) : -1e9
  })
  const lumber = zones.find((zz) => zz.kind === "lumber")
  if (lumber) pick("sawmill", (i) => (toWater[i]! <= 1 ? -dist(i, lumber.tile) : -1e9))
  // farmsteads along the roads in the open country, a few tiles apart
  const farms: number[] = []
  for (let i = 0; i < N; i++) {
    if (!free(i) || toRoad[i] !== 1 || toZone[i]! < 3) continue
    const k = kind(i)
    if (k !== "grass" && k !== "meadow") continue
    if (farms.some((f) => dist(f, i) < 3) || h1(10, i) > 0.8) continue
    use[i] = U.farmstead
    farms.push(i)
  }
  // fields and orchards round each farmstead
  for (const f of farms)
    for (const j of g.neighbours(f))
      if (j >= 0 && free(j) && (kind(j) === "grass" || kind(j) === "meadow"))
        use[j] = h1(11, j) < 0.65 ? U.field : U.orchard
  // the rest, by the ground under it
  for (let i = 0; i < N; i++) {
    if (!free(i) || !dry(i)) {
      if (free(i) && kind(i) === "rock") use[i] = toZone[i]! <= 2 ? U.quarry : U.crag
      continue
    }
    const k = wildKind(i)
    const near = toZone[i]! <= 3 || toRoad[i]! <= 1
    let u: TileUse = "meadow"
    // lone dwellings scattered over the country: a hunter at the wood's edge, a shepherd on the hills
    const edge = toForest[i] === 1 && k !== "forest"
    // (a lone dwelling keeps a tile clear of every place: its door is its own, not a neighbour's yard)
    const lone = toZone[i]! >= 2
    if (edge && lone && toRoad[i]! <= 3 && h1(30, i) < 0.08) u = "hunter"
    else if (k === "hill" && lone && h1(31, i) < 0.06) u = "shepherd"
    else if (!near && toRoad[i]! <= 3 && (k === "grass" || k === "meadow") && h1(32, i) < 0.06)
      u = "homestead"
    else if (k === "forest") u = h1(20, i) < 0.82 ? "woods" : "grove"
    else if (k === "sand") u = "beach"
    else if (k === "cliff") u = "bluff"
    else if (k === "hill") u = h1(21, i) < 0.55 ? "hillside" : h1(22, i) < 0.6 ? "pasture" : "grove"
    else if (toWater[i] === 1 && h1(23, i) < 0.45) u = "reeds"
    else if (near) u = h1(24, i) < 0.4 ? "field" : h1(25, i) < 0.55 ? "pasture" : "orchard"
    else
      u =
        h1(26, i) < 0.3
          ? "meadow"
          : h1(27, i) < 0.4
            ? "grove"
            : h1(28, i) < 0.55
              ? "pasture"
              : h1(29, i) < 0.5
                ? "field"
                : "orchard"
    use[i] = U[u]
  }
  // the graveyard last, over open country near the Guildhall (graveyard.ts), where heroes rest and
  // slump, so the one who mends a grave has a short way to it (the town's heart with no castle):
  // nothing else moves for it
  const castleZone = zones.findIndex((zz) => zz.kind === "castle") + 1
  const graveGround = new Set<number>([U.meadow, U.grove, U.pasture, U.orchard, U.field, U.hillside])
  const graveyard = graveyardSite({
    grid: g,
    seed,
    level: h.level,
    open: (i) =>
      !zoneOf[i] &&
      graveGround.has(use[i]!) &&
      !site.has(i) &&
      !foot.has(i) &&
      (kind(i) === "grass" || kind(i) === "meadow" || kind(i) === "hill"),
    road: (i) => use[i] === U.road,
    near: plan?.heart ?? (zones.find((zz) => zz.kind === "town") ?? zones[0])?.tile,
    way: (i) =>
      use[i] === U.road ||
      use[i] === U.bridge ||
      use[i] === U.square ||
      (castleZone > 0 && zoneOf[i] === castleZone),
  })
  if (graveyard) for (const i of [graveyard.tile, ...graveyard.cover]) use[i] = U.graveyard

  let buildings = 0
  let roadTiles = 0
  let bridges = 0
  let fields = 0
  for (let i = 0; i < N; i++) {
    if (use[i] === U.building || use[i] === U.farmstead) buildings++
    if (use[i] === U.road) roadTiles++
    if (use[i] === U.bridge) bridges++
    if (use[i] === U.field) fields++
  }
  return {
    zones,
    roads,
    zoneOf,
    use,
    tier,
    castle: plan,
    graveyard,
    stats: { buildings, roadTiles, bridges, fields, ms: Math.round(performance.now() - t0) },
  }
}

/** The use name of tile i. */
export const useOf = (z: HexZones, i: number): TileUse => TILE_USES[z.use[i]!]!
