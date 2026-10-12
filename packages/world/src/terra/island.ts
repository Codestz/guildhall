/**
 * Terrain and water first (decisions.md "Target island + terrain-first pipeline"): one height map for
 * the whole island, and the water read from it, before anything is planned on it.
 *
 * 1. Land: a radial falloff, domain-warped so the coast grows lobes, coves and headlands, plus a hill
 *    massif off to one side that pushes its own headland out. Holes fill in; the largest piece is the
 *    island, specks become sea stacks.
 * 2. Height: a gentle beach ramp, or a bluff where the coast is cliffed (more of it near the hills);
 *    rolling lowland inland that tilts up toward the hills; the massif in flat treads with steep
 *    risers (the terraces), smooth peaks above the top tread.
 * 3. Water: a priority flood from the sea gives every land cell a way down and fills the hollows
 *    (big ones become lakes); rain, heavier on the hills, is summed downstream; where enough land
 *    drains through a cell it is a river. Rivers are traced as lines, carved into the ground, and a
 *    drop over a riser is a waterfall.
 *
 * Pure and deterministic: every draw is a hash of the seed.
 */
import { fbm, hash2, ridged, smoothstep } from "./noise.ts"

export interface TerraSpec {
  seed: number
  /** Metres across the island, roughly. */
  size?: number
  /** Raster cell, metres. */
  cell?: number
  /** Hill height scale (1: three terraces and a peak). */
  hills?: number
  /** Share of the coast that is bluff or cliff, 0..1. */
  cliffs?: number
  /** Coast irregularity: lobes, coves, headlands. */
  coast?: number
  /** River density: more rain, more and longer streams. */
  rain?: number
  /** Terrace step, metres. */
  step?: number
  /** Terraces up to the hill top; 0 rolls 5 or 6 by seed. */
  levels?: number
}

export type TerraSpecFull = Required<TerraSpec>

export const TERRA_DEFAULTS: Omit<TerraSpecFull, "seed"> = {
  size: 400,
  cell: 2,
  hills: 1,
  cliffs: 0.5,
  coast: 1,
  rain: 1,
  step: 2.4,
  levels: 0,
}

/** `terraceLevel` of the rocky crag above the hill top. */
export const TERRA_CRAG = 15

/** Water kind per cell. */
export const TERRA_WATER = { land: 0, sea: 1, lake: 2, river: 3, stack: 4 } as const

export interface TerraRiver {
  /** Centreline, world metres [x, z], source to mouth (or to the river it joins). */
  line: [number, number][]
  /** Width at each point, metres. */
  width: number[]
  /** Upstream area at the end, m². */
  flow: number
}

export interface Terra {
  spec: TerraSpecFull
  w: number
  h: number
  cell: number
  /** World position of cell (0, 0)'s corner. */
  origin: [number, number]
  /** Ground height, metres (sea floor below 0, channels carved). */
  height: Float32Array
  /** Water surface where there is water (lakes, rivers), else NaN. */
  surface: Float32Array
  /** TERRA_WATER kind per cell. */
  water: Uint8Array
  /** Metres to the sea from each land cell; 0 on the sea. */
  coastDist: Float32Array
  /** Upstream area draining through each cell, m². */
  acc: Float32Array
  /** Rise over run. */
  slope: Float32Array
  /** The terrace a cell stands on (0 lowland, 1.. up the hill), `TERRA_CRAG` on the crag. */
  terraceLevel: Uint8Array
  rivers: TerraRiver[]
  falls: [number, number][]
  massif: { at: [number, number]; r: number }[]
  stats: { landM2: number; cliffShare: number; lakes: number; riverM: number; ms: number }
}

const SQ2 = Math.SQRT2

/** A min-heap of cell indices keyed by a float. */
class Heap {
  private k: number[] = []
  private v: number[] = []
  get size(): number {
    return this.v.length
  }
  push(key: number, val: number): void {
    const { k, v } = this
    let i = v.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p]! < key || (k[p] === key && v[p]! <= val)) break
      k[i] = k[p]!
      v[i] = v[p]!
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): number {
    const { k, v } = this
    const top = v[0]!
    const lk = k.pop()!
    const lv = v.pop()!
    const n = v.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && (k[r]! < k[l]! || (k[r] === k[l] && v[r]! < v[l]!)) ? r : l
        if (lk < k[c]! || (lk === k[c] && lv <= v[c]!)) break
        k[i] = k[c]!
        v[i] = v[c]!
        i = c
      }
      k[i] = lk
      v[i] = lv
    }
    return top
  }
}

/** Two-pass chamfer distance (metres) from every cell where `src` is 1. */
function chamfer(w: number, h: number, cell: number, src: Uint8Array): Float32Array {
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : 1e9
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let m = d[i]!
      if (x > 0) m = Math.min(m, d[i - 1]! + 1)
      if (y > 0) {
        m = Math.min(m, d[i - w]! + 1)
        if (x > 0) m = Math.min(m, d[i - w - 1]! + SQ2)
        if (x < w - 1) m = Math.min(m, d[i - w + 1]! + SQ2)
      }
      d[i] = m
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let m = d[i]!
      if (x < w - 1) m = Math.min(m, d[i + 1]! + 1)
      if (y < h - 1) {
        m = Math.min(m, d[i + w]! + 1)
        if (x < w - 1) m = Math.min(m, d[i + w + 1]! + SQ2)
        if (x > 0) m = Math.min(m, d[i + w - 1]! + SQ2)
      }
      d[i] = m
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! * cell
  return d
}

/** 4-connected components of cells where `mask` is 1: labels (0 none) and sizes by label. */
function components(w: number, h: number, mask: Uint8Array): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(w * h)
  const sizes = [0]
  const stack: number[] = []
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue
    const id = sizes.length
    let n = 0
    label[s] = id
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      n++
      const x = i % w
      const y = (i - x) / w
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const j of nb)
        if (j >= 0 && mask[j] && !label[j]) {
          label[j] = id
          stack.push(j)
        }
    }
    sizes.push(n)
  }
  return { label, sizes }
}

/** Chaikin corner cutting, endpoints kept. */
function chaikin(line: [number, number][], width: number[], rounds: number): [[number, number][], number[]] {
  let l = line
  let wd = width
  for (let r = 0; r < rounds && l.length > 2; r++) {
    const nl: [number, number][] = [l[0]!]
    const nw: number[] = [wd[0]!]
    for (let i = 0; i < l.length - 1; i++) {
      const a = l[i]!
      const b = l[i + 1]!
      nl.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      )
      nw.push(wd[i]! * 0.75 + wd[i + 1]! * 0.25, wd[i]! * 0.25 + wd[i + 1]! * 0.75)
    }
    nl.push(l[l.length - 1]!)
    nw.push(wd[wd.length - 1]!)
    l = nl
    wd = nw
  }
  return [l, wd]
}

export function terraIsland(input: TerraSpec): Terra {
  const t0 = performance.now()
  const s: TerraSpecFull = { ...TERRA_DEFAULTS, ...input }
  const { seed, cell } = s
  const R = s.size / 2
  const span = s.size * 1.75
  const w = Math.ceil(span / cell)
  const h = w
  const ox = -(w * cell) / 2
  const oz = -(h * cell) / 2
  const N = w * h
  const rnd = (k: number): number => hash2(seed, k, 9173)
  const levels = s.levels > 0 ? Math.round(s.levels) : 5 + (rnd(10) < 0.5 ? 1 : 0)
  const px = (i: number): number => ox + ((i % w) + 0.5) * cell
  const pz = (i: number): number => oz + (Math.floor(i / w) + 0.5) * cell

  // ---- the plan of the land: shape, hills ----
  const aspect = 1 + 0.55 * rnd(1)
  const rot = rnd(2) * Math.PI * 2
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  const a0 = rnd(3) * Math.PI * 2
  const md: [number, number] = [Math.cos(a0), Math.sin(a0)]
  const massif: { at: [number, number]; r: number }[] = [
    {
      at: [md[0] * R * (0.45 + 0.12 * rnd(4)), md[1] * R * (0.45 + 0.12 * rnd(4))],
      r: R * (0.62 + 0.14 * rnd(5)),
    },
  ]
  if (rnd(6) < 0.7) {
    const a1 = a0 + (rnd(7) < 0.5 ? -1 : 1) * (0.65 + 0.4 * rnd(8))
    massif.push({ at: [Math.cos(a1) * R * 0.55, Math.sin(a1) * R * 0.55], r: R * (0.36 + 0.1 * rnd(9)) })
  }
  const lump = (x: number, z: number): number => {
    let m = 0
    for (let k = 0; k < massif.length; k++) {
      const c = massif[k]!
      const wx = fbm(seed + 301 + k, x / 70, z / 70, 3) * 0.28
      const d = Math.hypot(x - c.at[0], z - c.at[1]) / c.r + wx
      m = Math.max(m, (1 - smoothstep(0.3, 1, d)) * (k === 0 ? 1 : 0.75))
    }
    return m
  }
  const kw = 1 / (R * 0.7)
  // 2–3 peninsulas pushed out and 1–2 coves bitten in, at rolled bearings
  const lobes: [number, number, number][] = []
  const nl = 2 + Math.floor(rnd(20) * 2)
  for (let k = 0; k < nl; k++)
    lobes.push([rnd(21 + k) * Math.PI * 2, 0.22 + 0.15 * rnd(31 + k), (0.35 + 0.3 * rnd(41 + k)) * s.coast])
  const nc = 1 + Math.floor(rnd(50) * 2)
  for (let k = 0; k < nc; k++)
    lobes.push([rnd(51 + k) * Math.PI * 2, 0.12 + 0.08 * rnd(61 + k), -(0.35 + 0.25 * rnd(71 + k)) * s.coast])
  const landness = (x: number, z: number): number => {
    const qx = x + fbm(seed + 11, x * kw, z * kw, 3) * R * 0.42 * s.coast
    const qz = z + fbm(seed + 23, x * kw, z * kw, 3) * R * 0.42 * s.coast
    const u = (qx * cr + qz * sr) / (R * Math.sqrt(aspect))
    const v = (-qx * sr + qz * cr) / (R / Math.sqrt(aspect))
    let L = 1 - (u * u + v * v)
    L += 0.2 * s.coast * fbm(seed + 37, qx * kw * 1.8, qz * kw * 1.8, 4)
    L += 0.3 * lump(x, z)
    const ang = Math.atan2(z, x)
    for (const [la, lw, lh] of lobes) {
      const d = Math.atan2(Math.sin(ang - la), Math.cos(ang - la))
      L += lh * Math.exp(-(d * d) / (2 * lw * lw)) * Math.min(1, Math.hypot(x, z) / (R * 0.5))
    }
    return L
  }

  // ---- land mask: fill holes, keep the island and its stacks ----
  let land = new Uint8Array(N)
  for (let i = 0; i < N; i++) land[i] = landness(px(i), pz(i)) > 0 ? 1 : 0
  const seaMask = new Uint8Array(N)
  for (let i = 0; i < N; i++) seaMask[i] = land[i] ? 0 : 1
  {
    const { label } = components(w, h, seaMask)
    const outer = label[0]!
    for (let i = 0; i < N; i++) if (!land[i] && label[i] !== outer) land[i] = 1
  }
  const water = new Uint8Array(N)
  {
    const { label, sizes } = components(w, h, land)
    let big = 1
    for (let k = 1; k < sizes.length; k++) if (sizes[k]! > sizes[big]!) big = k
    const stackMax = 900 / (cell * cell)
    const next = new Uint8Array(N)
    for (let i = 0; i < N; i++) {
      const l = label[i]!
      if (!l) water[i] = TERRA_WATER.sea
      else if (l === big) next[i] = 1
      else if (sizes[l]! <= stackMax) water[i] = TERRA_WATER.stack
      else water[i] = TERRA_WATER.sea
    }
    land = next
  }
  const seaSrc = new Uint8Array(N)
  for (let i = 0; i < N; i++) seaSrc[i] = land[i] ? 0 : 1
  const coastDist = chamfer(w, h, cell, seaSrc)
  const landDist = chamfer(w, h, cell, land)

  // ---- height ----
  const height = new Float32Array(N)
  const terraceLevel = new Uint8Array(N)
  const th = (0.5 - s.cliffs) * 0.9
  for (let i = 0; i < N; i++) {
    const x = px(i)
    const z = pz(i)
    if (water[i] === TERRA_WATER.stack) {
      height[i] = 3 + 5 * hash2(seed, Math.floor(x / 6), Math.floor(z / 6))
      continue
    }
    if (!land[i]) {
      height[i] = -(0.6 + Math.min(landDist[i]! * 0.1, 12))
      continue
    }
    const D = coastDist[i]!
    const toward = (x * md[0] + z * md[1]) / R
    const n = fbm(seed + 51, x / 110, z / 110, 2) + 0.45 * Math.max(0, toward)
    const cliffAmt = smoothstep(th - 0.1, th + 0.1, n)
    const bluffH = cliffAmt * (3 + 3.5 * (fbm(seed + 53, x / 60, z / 60, 2) * 0.5 + 0.5))
    const beach = 0.3 + Math.min(D, 32) * 0.045
    const bluff = bluffH * smoothstep(0, 3, D)
    const inland = smoothstep(8, 70, D) * (1.6 + 2 * (fbm(seed + 61, x / 110, z / 110, 2) * 0.5 + 0.5))
    const tilt = 2.2 * (((x * md[0] + z * md[1]) / R) * 0.5 + 0.5) * smoothstep(6, 70, D)
    // the bluff fades into the lowland inland, so cliff and beach stretches never leave a scarp behind
    const lowland = beach + Math.max(0, bluff - beach) * (1 - smoothstep(18, 60, D)) + inland + tilt
    // 5–6 treads of one step each up to the plateau top, a rocky crag rising above its heart
    const m0 = lump(x, z)
    const m = m0 * (0.85 + 0.3 * ridged(seed + 71, x / 55, z / 55, 3))
    const c0 = massif[0]!
    const dPeak =
      Math.hypot(x - c0.at[0], z - c0.at[1]) / (c0.r * 0.28 * (1 + 0.3 * fbm(seed + 81, x / 45, z / 45, 2)))
    const crag = 5 * Math.max(0, 1 - dPeak) ** 1.3 * s.hills
    const hillH = Math.min(m, 1) * levels * s.step * s.hills * smoothstep(0, 10, D)
    let terr = 0
    if (hillH > 0.3) {
      const q = hillH / s.step
      const fl = Math.floor(q)
      terr = (fl + smoothstep(0.72, 1, q - fl)) * s.step
      terraceLevel[i] = Math.min(levels, Math.round(terr / s.step))
    }
    if (crag > 0.4 && terraceLevel[i]! >= levels - 1) {
      terr += crag
      terraceLevel[i] = TERRA_CRAG
    }
    height[i] = lowland + terr
  }

  // ---- water: priority flood from the coast ----
  const hf = new Float32Array(N)
  const down = new Int32Array(N).fill(-1)
  const seen = new Uint8Array(N)
  const order: number[] = []
  const heap = new Heap()
  const nb8 = (i: number, f: (j: number, d: number) => void): void => {
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        f(yy * w + xx, dx && dy ? SQ2 : 1)
      }
  }
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue
    let sea = -1
    nb8(i, (j) => {
      if (!land[j] && water[j] === TERRA_WATER.sea) sea = j
    })
    if (sea >= 0) {
      hf[i] = height[i]!
      down[i] = sea
      seen[i] = 1
      heap.push(hf[i]!, i)
    }
  }
  while (heap.size) {
    const c = heap.pop()
    order.push(c)
    nb8(c, (j) => {
      if (seen[j] || !land[j]) return
      seen[j] = 1
      hf[j] = Math.max(height[j]!, hf[c]! + 1e-4)
      down[j] = c
      heap.push(hf[j]!, j)
    })
  }
  // rain, heavier on the hills, summed downstream
  const acc = new Float32Array(N)
  const a = cell * cell
  for (let k = order.length - 1; k >= 0; k--) {
    const c = order[k]!
    acc[c] = acc[c]! + a * (0.35 + 3 * smoothstep(3, 9, height[c]!))
    const d = down[c]!
    if (d >= 0 && land[d]) acc[d] = acc[d]! + acc[c]!
  }
  let landCells = 0
  for (let i = 0; i < N; i++) landCells += land[i]!
  const landM2 = landCells * a

  // lakes: filled hollows big enough
  const surface = new Float32Array(N).fill(Number.NaN)
  const hollow = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (land[i] && hf[i]! - height[i]! > 0.3) hollow[i] = 1
  let lakes = 0
  {
    const { label, sizes } = components(w, h, hollow)
    const keep = new Set(
      sizes
        .map((n, k) => [n, k] as const)
        .filter(([n, k]) => k > 0 && n * a >= 700)
        .sort((p, q) => q[0] - p[0])
        .slice(0, 2)
        .map(([, k]) => k),
    )
    for (let i = 0; i < N; i++) {
      const l = label[i]!
      if (keep.has(l)) {
        water[i] = TERRA_WATER.lake
        surface[i] = hf[i]!
      }
    }
    lakes = keep.size
  }

  // rivers: enough land drains through
  const thr = (landM2 * 0.07) / s.rain
  const isRiver = (i: number): boolean => land[i] === 1 && acc[i]! > thr
  const hasUp = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (isRiver(i) && down[i]! >= 0) hasUp[down[i]!] = 1
  const heads: number[] = []
  for (let i = 0; i < N; i++) if (isRiver(i) && !hasUp[i]) heads.push(i)
  heads.sort((p, q) => hf[q]! - hf[p]! || p - q)
  const taken = new Uint8Array(N)
  const rivers: TerraRiver[] = []
  const falls: [number, number][] = []
  const widthAt = (i: number): number => Math.min(9, 0.9 + 2.2 * Math.sqrt(acc[i]! / thr))
  // each river is followed back up its biggest feeder to where the water starts: a spring in the hills
  const upMax = new Int32Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    const d = down[i]!
    if (!land[i] || d < 0 || !land[d]) continue
    if (upMax[d]! < 0 || acc[i]! > acc[upMax[d]!]!) upMax[d] = i
  }
  const springs: number[] = []
  for (const head of heads) {
    const line: [number, number][] = []
    const width: number[] = []
    const upstream: number[] = []
    let src = head
    while (upMax[src]! >= 0 && acc[upMax[src]!]! > thr * 0.05) {
      src = upMax[src]!
      upstream.push(src)
    }
    for (let k = upstream.length - 1; k >= 0; k--) {
      const u = upstream[k]!
      line.push([px(u), pz(u)])
      width.push(widthAt(u))
    }
    let c = head
    let last = c
    while (c >= 0 && land[c]) {
      line.push([px(c), pz(c)])
      width.push(widthAt(c))
      last = c
      if (taken[c] && c !== head) break
      taken[c] = 1
      c = down[c]!
    }
    if (c >= 0 && !land[c]) {
      line.push([px(c), pz(c)])
      width.push(widthAt(last))
    }
    if (line.length * cell < 30) continue
    springs.push(src)
    const [sl, sw] = chaikin(line, width, 2)
    rivers.push({ line: sl, width: sw, flow: acc[last]! })
  }
  // carve the channels and mark river water; waterfalls where the bed drops a riser
  let riverM = 0
  for (const rv of rivers) {
    for (let k = 0; k < rv.line.length; k++) {
      const [x, z] = rv.line[k]!
      if (k > 0) riverM += Math.hypot(x - rv.line[k - 1]![0], z - rv.line[k - 1]![1])
      const half = rv.width[k]! / 2
      const reach = half + 4
      const gx = Math.floor((x - ox) / cell)
      const gz = Math.floor((z - oz) / cell)
      const rc = Math.ceil(reach / cell)
      const ci = Math.max(0, Math.min(N - 1, gz * w + gx))
      const surf = hf[ci]!
      for (let dz = -rc; dz <= rc; dz++)
        for (let dx = -rc; dx <= rc; dx++) {
          const xx = gx + dx
          const zz = gz + dz
          if (xx < 0 || zz < 0 || xx >= w || zz >= h) continue
          const j = zz * w + xx
          if (!land[j]) continue
          const d = Math.hypot(px(j) - x, pz(j) - z)
          if (d <= half) {
            if (water[j] !== TERRA_WATER.lake) {
              water[j] = TERRA_WATER.river
              surface[j] = Number.isNaN(surface[j]!) ? surf : Math.min(surface[j]!, surf)
            }
            height[j] = Math.min(height[j]!, surf - 0.7)
          } else if (d <= reach) {
            height[j] = Math.min(height[j]!, surf + (d - half) * 0.45)
          }
        }
    }
    for (let k = 4; k < rv.line.length; k += 4) {
      const p = rv.line[k - 4]!
      const q = rv.line[k]!
      const i0 = Math.floor((p[1] - oz) / cell) * w + Math.floor((p[0] - ox) / cell)
      const i1 = Math.floor((q[1] - oz) / cell) * w + Math.floor((q[0] - ox) / cell)
      if (hf[i0]! - hf[i1]! > 1.3) falls.push(q)
    }
  }

  // still water: a spring pond where each river starts, and a lake the main river runs through
  const pond = (
    cx: number,
    cz: number,
    rx: number,
    rz: number,
    ang: number,
    surf: number,
    depth: number,
  ): void => {
    const gx = Math.floor((cx - ox) / cell)
    const gz = Math.floor((cz - oz) / cell)
    const rc = Math.ceil((Math.max(rx, rz) * 1.4) / cell)
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    for (let dz = -rc; dz <= rc; dz++)
      for (let dx = -rc; dx <= rc; dx++) {
        const xx = gx + dx
        const zz = gz + dz
        if (xx < 0 || zz < 0 || xx >= w || zz >= h) continue
        const j = zz * w + xx
        if (!land[j]) continue
        const ex = px(j) - cx
        const ez = pz(j) - cz
        const a = (ex * ca + ez * sa) / rx
        const b = (-ex * sa + ez * ca) / rz
        const wob = 1 + 0.18 * fbm(seed + 991, px(j) / 14, pz(j) / 14, 2)
        const r = Math.hypot(a, b) / wob
        if (r <= 1) {
          water[j] = TERRA_WATER.lake
          surface[j] = surf
          height[j] = Math.min(height[j]!, surf - depth * (1.2 - r))
        } else if (r <= 1.4) height[j] = Math.min(height[j]!, surf + (r - 1) * 2.5)
      }
  }
  for (const sp of springs) {
    pond(px(sp), pz(sp), 4.5, 3.5, rnd(500 + (sp % 97)) * Math.PI, hf[sp]!, 0.8)
    lakes++
  }
  let main: TerraRiver | null = null
  for (const r of rivers) if (!main || r.flow > main.flow) main = r
  if (main && main.line.length > 12) {
    const line = main.line
    const n = line.length
    for (let k = Math.floor(n * 0.35); k < Math.floor(n * 0.75); k++) {
      const p0 = line[k]!
      const i = Math.floor((p0[1] - oz) / cell) * w + Math.floor((p0[0] - ox) / cell)
      if (!land[i] || terraceLevel[i] !== 0 || coastDist[i]! < 40) continue
      const p1 = line[Math.min(n - 1, k + 3)]!
      pond(
        p0[0],
        p0[1],
        16 + 8 * rnd(510),
        10 + 5 * rnd(511),
        Math.atan2(p1[1] - p0[1], p1[0] - p0[0]),
        hf[i]!,
        1.8,
      )
      lakes++
      break
    }
  }

  // slope
  const slope = new Float32Array(N)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = (height[i + 1]! - height[i - 1]!) / (2 * cell)
      const gz = (height[i + w]! - height[i - w]!) / (2 * cell)
      slope[i] = Math.hypot(gx, gz)
    }
  // cliff share: coast cells whose land rises > 2 m within 6 m
  let coastCells = 0
  let cliffCells = 0
  for (let i = 0; i < N; i++) {
    if (!land[i] || coastDist[i]! > cell * 1.5) continue
    coastCells++
    if (height[i]! > 2.2) cliffCells++
  }

  return {
    spec: s,
    w,
    h,
    cell,
    origin: [ox, oz],
    height,
    surface,
    water,
    coastDist,
    acc,
    slope,
    terraceLevel,
    rivers,
    falls,
    massif,
    stats: {
      landM2,
      cliffShare: coastCells ? cliffCells / coastCells : 0,
      lakes,
      riverM: Math.round(riverM),
      ms: Math.round(performance.now() - t0),
    },
  }
}

/** World height at (x, z), bilinear between cell centres; open sea outside the raster. */
export function terraHeightAt(t: Terra, x: number, z: number): number {
  const fx = (x - t.origin[0]) / t.cell - 0.5
  const fz = (z - t.origin[1]) / t.cell - 0.5
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  if (ix < 0 || iz < 0 || ix >= t.w - 1 || iz >= t.h - 1) return -10
  const u = fx - ix
  const v = fz - iz
  const i = iz * t.w + ix
  const a = t.height[i]!
  const b = t.height[i + 1]!
  const c = t.height[i + t.w]!
  const d = t.height[i + t.w + 1]!
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * The coast as polylines: the cell edges between land (or stacks) and sea, chained end to end, in world
 * metres. What the water reads its shore distance from (foam, shallows).
 */
export function terraShore(t: Terra): [number, number][][] {
  return terraOutline(t, (i) => t.water[i] !== TERRA_WATER.sea).map((r) => [...r, r[0]!])
}

/**
 * The outline of the cells `inside` accepts, as closed rings of cell edges in world metres, chained
 * so the inside lies to the left (counter-clockwise round an area in x-right, z-down terms of the
 * raster). Out of the raster counts as outside.
 */
export function terraOutline(t: Terra, inside: (i: number) => boolean): [number, number][][] {
  const { w, h, cell, origin } = t
  const out = (x: number, z: number): boolean => x < 0 || z < 0 || x >= w || z >= h || !inside(z * w + x)
  const next = new Map<number, number>()
  const key = (x: number, z: number) => x * (h + 1) + z
  const edge = (ax: number, az: number, bx: number, bz: number) => next.set(key(ax, az), key(bx, bz))
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      if (out(x, z)) continue
      if (out(x, z - 1)) edge(x, z, x + 1, z)
      if (out(x + 1, z)) edge(x + 1, z, x + 1, z + 1)
      if (out(x, z + 1)) edge(x + 1, z + 1, x, z + 1)
      if (out(x - 1, z)) edge(x, z + 1, x, z)
    }
  const lines: [number, number][][] = []
  const toWorld = (k: number): [number, number] => [
    origin[0] + Math.floor(k / (h + 1)) * cell,
    origin[1] + (k % (h + 1)) * cell,
  ]
  while (next.size) {
    const start = next.keys().next().value as number
    const line: [number, number][] = [toWorld(start)]
    let k = start
    for (;;) {
      const n = next.get(k)
      if (n === undefined) break
      next.delete(k)
      k = n
      if (k === start) break
      line.push(toWorld(n))
    }
    if (line.length > 3) lines.push(line)
  }
  return lines
}
