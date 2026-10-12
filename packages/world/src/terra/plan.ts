/**
 * Step 2 of the terrain-first island (decisions.md "Target island + terrain-first pipeline"): where
 * people settle, and the roads between them, read from the land alone.
 *
 * Anchors: every land cell is scored for each kind of place (flat ground, how central, water near,
 * a sheltered shore, height), and the best cell of each kind is taken in order, each kept well apart
 * from those before it: the town's crossroads on the broad flat heart, the harbour in the most
 * sheltered low shore, a river crossing on flat banks of a narrow stretch, an outpost on a high tread,
 * then a fishing hamlet and a farm hamlet where they fit.
 *
 * Roads: a spanning tree over the anchors plus the shortest edge that closes a loop, each edge routed
 * by A* over the terrain: steep ground and risers cost dearly (so roads take the gentle line and wind
 * up the hill), water is crossed only as a bridge (dear, so a narrow stretch is sought), and every road
 * already built is cheap, so later roads join it. Lines are string-pulled and rounded.
 */
import { type CostGrid, gridAStar, smoothRoute, stringPull } from "../geom/route.ts"
import type { Vec2 } from "../geom/vec.ts"
import { TERRA_CRAG, TERRA_WATER, type Terra } from "./island.ts"
import { smoothstep } from "./noise.ts"

export type AnchorKind = "town" | "harbour" | "crossing" | "outpost" | "fishing" | "farm"

export interface TerraAnchor {
  kind: AnchorKind
  at: Vec2
  /** The terrace it stands on (0 lowland). */
  level: number
  score: number
}

export interface TerraRoad {
  /** Anchor indices it joins. */
  a: number
  b: number
  line: Vec2[]
  /** Where it crosses a river or lake: the bridges. */
  bridges: Vec2[]
  kind: "main" | "track"
}

export interface TerraPlan {
  anchors: TerraAnchor[]
  roads: TerraRoad[]
  ms: number
}

/** The order anchors are placed in, and how far each keeps from those before it (metres). */
const ORDER: { kind: AnchorKind; apart: number }[] = [
  { kind: "town", apart: 0 },
  { kind: "harbour", apart: 80 },
  { kind: "crossing", apart: 70 },
  { kind: "outpost", apart: 70 },
  { kind: "fishing", apart: 90 },
  { kind: "farm", apart: 80 },
]

/** Box-blurred field (separable, radius in cells). */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]!
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1)
      acc += src[y * w + Math.min(w - 1, x + r + 1)]! - src[y * w + Math.max(0, x - r)]!
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1)
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
    }
  }
  return out
}

export function terraPlan(t: Terra): TerraPlan {
  const t0 = performance.now()
  const { w, h, cell, origin, water, height, slope, coastDist, terraceLevel } = t
  const N = w * h
  const px = (i: number): number => origin[0] + ((i % w) + 0.5) * cell
  const pz = (i: number): number => origin[1] + (Math.floor(i / w) + 0.5) * cell
  const land = new Float32Array(N)
  const isRiver = new Float32Array(N)
  const steep = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const k = water[i]
    land[i] = k === TERRA_WATER.land ? 1 : 0
    isRiver[i] = k === TERRA_WATER.river || k === TERRA_WATER.lake ? 1 : 0
    steep[i] = Math.min(1, slope[i]! * 3)
  }
  // neighbourhood fields: flat ground (≈20 m), how much land surrounds a spot (≈70 m: a cove's shelter),
  // water near (≈14 m)
  const flatNear = blur(steep, w, h, Math.round(10 / cell))
  const landNear = blur(land, w, h, Math.round(70 / cell))
  const riverNear = blur(isRiver, w, h, Math.round(14 / cell))
  let cx = 0
  let cz = 0
  let n = 0
  for (let i = 0; i < N; i++)
    if (land[i]) {
      cx += px(i)
      cz += pz(i)
      n++
    }
  cx /= n || 1
  cz /= n || 1
  const R = t.spec.size / 2
  let levels = 1
  for (let i = 0; i < N; i++) if (terraceLevel[i] !== TERRA_CRAG) levels = Math.max(levels, terraceLevel[i]!)

  const score = (kind: AnchorKind, i: number): number => {
    if (!land[i] || terraceLevel[i] === TERRA_CRAG) return -1
    const flat = 1 - smoothstep(0.08, 0.45, flatNear[i]!)
    const D = coastDist[i]!
    const centre = 1 - Math.min(1, Math.hypot(px(i) - cx, pz(i) - cz) / R)
    const lvl = terraceLevel[i]!
    switch (kind) {
      case "town":
        return lvl === 0 && D > 30
          ? flat * flat * (0.35 + centre) * (0.7 + 0.6 * Math.min(1, riverNear[i]! * 6))
          : -1
      case "harbour":
      case "fishing": {
        if (D < 6 || D > 22 || height[i]! > 3.2) return -1
        const shelter = landNear[i]! // a cove: land all round the bay
        return flat * shelter * shelter * (kind === "harbour" ? 1 : 0.8)
      }
      case "crossing":
        return lvl === 0 && riverNear[i]! > 0.02 && riverNear[i]! < 0.25 && isRiver[i] === 0
          ? flat * (0.4 + centre) * (1 - riverNear[i]! * 2)
          : -1
      case "outpost":
        return lvl >= Math.max(2, levels - 2) ? flat * (0.5 + lvl / levels) : -1
      case "farm":
        return lvl === 0 && D > 25 ? flat * (1 - centre * 0.6) : -1
    }
  }

  const anchors: TerraAnchor[] = []
  for (const { kind, apart } of ORDER) {
    let best = -1
    let bestS = 0
    for (let i = 0; i < N; i += 1) {
      if ((i % w) % 2 || Math.floor(i / w) % 2) continue
      const s = score(kind, i)
      if (s <= bestS) continue
      const x = px(i)
      const z = pz(i)
      if (anchors.some((a) => Math.hypot(a.at[0] - x, a.at[1] - z) < Math.max(apart, 60))) continue
      best = i
      bestS = s
    }
    if (best >= 0) anchors.push({ kind, at: [px(best), pz(best)], level: terraceLevel[best]!, score: bestS })
  }

  // ---- the cost of crossing each cell ----
  const cost = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const k = water[i]
    if (k === TERRA_WATER.sea || k === TERRA_WATER.stack || terraceLevel[i] === TERRA_CRAG) cost[i] = Infinity
    else if (k === TERRA_WATER.river || k === TERRA_WATER.lake)
      cost[i] = k === TERRA_WATER.lake ? Infinity : 14
    else {
      const s = slope[i]!
      cost[i] = s > 1.3 ? Infinity : 1 + 30 * Math.max(0, s - 0.1) ** 1.3 + (coastDist[i]! < 5 ? 2 : 0)
    }
  }
  const grid: CostGrid = {
    w,
    h,
    cost,
    cell,
    origin: [origin[0], origin[1]],
    step: (a, b) => {
      const dh = Math.abs(height[b]! - height[a]!)
      const run = (a % w === b % w || Math.floor(a / w) === Math.floor(b / w) ? 1 : Math.SQRT2) * cell
      const g = dh / run
      return g > 0.9 ? Infinity : 40 * Math.max(0, g - 0.12) ** 2
    },
  }
  const cellOf = (p: Vec2): number =>
    Math.floor((p[1] - origin[1]) / cell) * w + Math.floor((p[0] - origin[0]) / cell)

  // ---- which anchors a road joins: a spanning tree, then the shortest edge that makes a loop ----
  const m = anchors.length
  const pairs: [number, number, number][] = []
  for (let a = 0; a < m; a++)
    for (let b = a + 1; b < m; b++)
      pairs.push([
        a,
        b,
        Math.hypot(anchors[a]!.at[0] - anchors[b]!.at[0], anchors[a]!.at[1] - anchors[b]!.at[1]),
      ])
  pairs.sort((p, q) => p[2] - q[2])
  const parent = anchors.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const edges: [number, number, "main" | "track"][] = []
  const spare: [number, number][] = []
  for (const [a, b] of pairs) {
    if (find(a) !== find(b)) {
      parent[find(a)] = find(b)
      edges.push([a, b, "main"])
    } else spare.push([a, b])
  }
  const loop = spare.find(([a, b]) => !edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a)))
  if (loop) edges.push([loop[0], loop[1], "track"])
  // the town's roads first, so the rest join them
  edges.sort((p, q) => Number(anchors[q[0]]!.kind === "town") - Number(anchors[p[0]]!.kind === "town"))

  const roads: TerraRoad[] = []
  for (const [a, b, kind] of edges) {
    const from = cellOf(anchors[a]!.at)
    const to = cellOf(anchors[b]!.at)
    const cells = gridAStar(grid, from, to)
    if (!cells) continue
    const bridges: Vec2[] = []
    let onWater = false
    for (const c of cells) {
      const wet = water[c] === TERRA_WATER.river
      if (wet && !onWater) bridges.push([px(c), pz(c)])
      onWater = wet
    }
    const pulled = stringPull(cells, grid)
    const line = smoothRoute(pulled, grid, { radius: 24, step: 4, snap: 0.5 })
    roads.push({ a, b, line, bridges, kind })
    // built road is cheap to follow
    for (const c of cells) if (Number.isFinite(cost[c]!)) cost[c] = Math.min(cost[c]!, 0.45)
  }
  return { anchors, roads, ms: Math.round(performance.now() - t0) }
}
