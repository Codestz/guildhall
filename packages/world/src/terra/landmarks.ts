/**
 * The island's landmarks: the buildings that make it feel lived in beyond its towns, each where the
 * land says it belongs. A castle keep on the highest defensible tread near the town; windmills on the
 * rises among the fields; a watermill on the river bank by the crossing; a lighthouse on the high
 * coast furthest out; ruins deep in the country; a campsite by the lake. Each stands wholly on one
 * terrace, on dry, open ground nothing else uses, facing the town; the parcels and trails come after
 * and route round and to them.
 */
import type { PrefabMeta } from "@guildhall/assets"
import type { Vec2 } from "../geom/vec.ts"
import { TERRA_CRAG, TERRA_WATER, type Terra, terraHeightAt } from "./island.ts"
import type { TerraPlan } from "./plan.ts"

export type LandmarkKind = "castle" | "windmill" | "watermill" | "lighthouse" | "ruins" | "campsite"

export interface TerraLandmark {
  kind: LandmarkKind
  prefab: string
  at: Vec2
  rot: number
  y: number
}

/** The recipe each landmark is built from, and how many the island gets. */
const LANDMARKS: { kind: LandmarkKind; prefab: string; count: number }[] = [
  { kind: "castle", prefab: "castle-keep", count: 1 },
  { kind: "watermill", prefab: "watermill", count: 1 },
  { kind: "windmill", prefab: "windmill", count: 2 },
  { kind: "lighthouse", prefab: "lighthouse", count: 1 },
  { kind: "ruins", prefab: "ruins", count: 1 },
  { kind: "campsite", prefab: "campsite", count: 1 },
]

/**
 * Landmarks on the land `used` leaves free (the districts' ground; landmarks mark theirs in it as they
 * go). A recipe the library lacks is skipped.
 */
export function terraLandmarks(
  t: Terra,
  plan: TerraPlan,
  used: Uint8Array,
  prefabs: readonly PrefabMeta[],
): TerraLandmark[] {
  const { w, h, cell, origin, water, slope, terraceLevel, coastDist, height } = t
  const N = w * h
  const meta = new Map(prefabs.map((p) => [p.id, p]))
  const px = (i: number): number => origin[0] + ((i % w) + 0.5) * cell
  const pz = (i: number): number => origin[1] + (Math.floor(i / w) + 0.5) * cell
  const cellAt = (p: Vec2): number => {
    const ix = Math.floor((p[0] - origin[0]) / cell)
    const iz = Math.floor((p[1] - origin[1]) / cell)
    return ix < 0 || iz < 0 || ix >= w || iz >= h ? -1 : iz * w + ix
  }
  const town = plan.anchors.find((a) => a.kind === "town")
  const crossing = plan.anchors.find((a) => a.kind === "crossing")
  const dist = (p: Vec2, q: Vec2 | undefined) => (q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : 0)
  const roadNear = (p: Vec2, r: number) =>
    plan.roads.some((road) => road.line.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < r))
  // distance to the nearest river or lake cell, and the main lake's cells
  const wet = new Float32Array(N).fill(1e9)
  {
    const src = new Uint8Array(N)
    for (let i = 0; i < N; i++)
      if (water[i] === TERRA_WATER.river || water[i] === TERRA_WATER.lake) src[i] = 1
    for (let i = 0; i < N; i++) if (src[i]) wet[i] = 0
    for (let pass = 0; pass < 2; pass++)
      for (let k = 0; k < N; k++) {
        const i = pass ? N - 1 - k : k
        const x = i % w
        for (const j of pass ? [i + 1, i + w] : [i - 1, i - w]) {
          if (j < 0 || j >= N || Math.abs((j % w) - x) > 1) continue
          wet[i] = Math.min(wet[i]!, wet[j]! + cell)
        }
      }
  }
  let lakeArea = 0
  for (let i = 0; i < N; i++) if (water[i] === TERRA_WATER.lake) lakeArea++

  const out: TerraLandmark[] = []
  /** Whether the footprint of `m` centred at c, turned by rot, fits on one terrace of free, dry, gentle land. */
  const fits = (m: PrefabMeta, c: Vec2, rot: number, flat: number): number | null => {
    const lvl = terraceLevel[Math.max(0, cellAt(c))]!
    const s = Math.sin(rot)
    const co = Math.cos(rot)
    const hu = m.frontage / 2 + 1.5
    const hv = m.depth / 2 + 1.5
    let y = Infinity
    for (let a = -1; a <= 1; a += 0.5)
      for (let b = -1; b <= 1; b += 0.5) {
        const p: Vec2 = [c[0] + co * hu * a + s * hv * b, c[1] - s * hu * a + co * hv * b]
        const i = cellAt(p)
        if (i < 0 || used[i] || water[i] !== TERRA_WATER.land || terraceLevel[i] !== lvl || slope[i]! > flat)
          return null
        if (terraceLevel[i] === TERRA_CRAG) return null
        y = Math.min(y, terraHeightAt(t, p[0], p[1]))
      }
    if (out.some((o) => Math.hypot(o.at[0] - c[0], o.at[1] - c[1]) < 30)) return null
    if (roadNear(c, Math.max(m.frontage, m.depth) / 2 + 2.5)) return null
    return y
  }
  const mark = (m: PrefabMeta, c: Vec2) => {
    const r = Math.max(m.frontage, m.depth) / 2 + 3
    const rc = Math.ceil(r / cell)
    const i0 = cellAt(c)
    const x0 = i0 % w
    const z0 = Math.floor(i0 / w)
    for (let dz = -rc; dz <= rc; dz++)
      for (let dx = -rc; dx <= rc; dx++) {
        const xx = x0 + dx
        const zz = z0 + dz
        if (xx >= 0 && zz >= 0 && xx < w && zz < h && (dx * dx + dz * dz) * cell * cell <= r * r)
          used[zz * w + xx] = 1
      }
  }
  const score = (kind: LandmarkKind, i: number): number => {
    if (water[i] !== TERRA_WATER.land || used[i] || terraceLevel[i] === TERRA_CRAG) return -1
    const p: Vec2 = [px(i), pz(i)]
    const lvl = terraceLevel[i]!
    switch (kind) {
      case "castle": {
        const d = dist(p, town?.at)
        return lvl >= 1 && d > 45 && d < 180 ? lvl * 2 - d / 70 : -1
      }
      case "windmill": {
        const d = dist(p, town?.at)
        if (d < 60 || lvl > 1 || coastDist[i]! < 20) return -1
        // a rise: higher than the ground round it
        const ring = [0, 1, 2, 3, 4, 5].map((k) =>
          terraHeightAt(t, p[0] + Math.cos(k) * 18, p[1] + Math.sin(k) * 18),
        )
        return height[i]! - Math.max(...ring)
      }
      case "watermill":
        return crossing && wet[i]! > 4 && wet[i]! < 9 && lvl === 0 ? 100 - dist(p, crossing.at) : -1
      case "lighthouse":
        return coastDist[i]! < 9 && coastDist[i]! > 3 && height[i]! > 2.5
          ? dist(p, town?.at) + height[i]! * 3
          : -1
      case "ruins": {
        const far = Math.min(...plan.anchors.map((a) => dist(p, a.at)))
        return coastDist[i]! > 20 ? far : -1
      }
      case "campsite":
        return lakeArea > 40 && wet[i]! > 6 && wet[i]! < 14 && lvl === 0 ? 100 - dist(p, town?.at) / 10 : -1
    }
  }
  for (const L of LANDMARKS) {
    const m = meta.get(L.prefab)
    if (!m) continue
    const ranked: [number, number][] = []
    for (let i = 0; i < N; i += 2) {
      const sc = score(L.kind, i)
      if (sc > -1) ranked.push([sc, i])
    }
    ranked.sort((a, b) => b[0] - a[0])
    let placed = 0
    for (const [, i] of ranked) {
      if (placed >= L.count) break
      const c: Vec2 = [px(i), pz(i)]
      const face = town ?? plan.anchors[0]
      const rot = face ? Math.atan2(face.at[0] - c[0], face.at[1] - c[1]) : 0
      const y = fits(m, c, rot, L.kind === "lighthouse" ? 0.5 : 0.3)
      if (y === null) continue
      out.push({ kind: L.kind, prefab: L.prefab, at: c, rot, y })
      mark(m, c)
      placed++
    }
  }
  return out
}
