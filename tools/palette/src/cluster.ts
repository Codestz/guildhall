/**
 * Area-weighted k-means in OKLab, seeded k-means++ from a fixed seed (no Math.random), so one input
 * always yields the same clusters; then each cluster split into dark/base/light by lightness.
 */
import { type ColourWeights, type Lab, labDistance2, oklabToSrgb, type Tone } from "@guildhall/assets"
import { roll } from "@guildhall/core"

export interface Point {
  lab: Lab
  weight: number
}

export interface Cluster {
  centre: Lab
  /** Summed weight of the members. */
  weight: number
  /** Indices into the input points. */
  members: number[]
}

export interface KMeansOptions {
  seed: number
  /** The distance the clusters are formed under. */
  weights: ColourWeights
  iterations?: number
}

/**
 * Lightness counts for little when grouping colours into ramps: a ramp spans it, and `_SHADE` carries
 * ±0.2 of it. Hue and chroma decide which ramp a colour belongs to.
 */
export const RAMP_WEIGHTS: ColourWeights = { l: 0.1, chroma: 1, hue: 1 }

function weightedMean(points: readonly Point[], members: readonly number[]): Lab {
  let w = 0
  const sum = [0, 0, 0]
  for (const i of members) {
    const p = points[i] as Point
    w += p.weight
    for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (p.lab[c] ?? 0) * p.weight
  }
  return w > 0 ? [(sum[0] ?? 0) / w, (sum[1] ?? 0) / w, (sum[2] ?? 0) / w] : [0, 0, 0]
}

/** k-means++ seeding: the heaviest point first, then each next centre drawn ∝ weight × D². */
function seedCentres(points: readonly Point[], k: number, opts: KMeansOptions): Lab[] {
  let heaviest = 0
  for (const [i, p] of points.entries()) if (p.weight > (points[heaviest]?.weight ?? 0)) heaviest = i
  const centres: Lab[] = [(points[heaviest] as Point).lab]
  const d2 = points.map((p) => labDistance2(p.lab, centres[0] as Lab, opts.weights))
  while (centres.length < Math.min(k, points.length)) {
    const total = points.reduce((s, p, i) => s + p.weight * (d2[i] ?? 0), 0)
    if (total === 0) break
    let target = roll(opts.seed, `${centres.length}:centre`) * total
    let pick = points.length - 1
    for (const [i, p] of points.entries()) {
      target -= p.weight * (d2[i] ?? 0)
      if (target <= 0) {
        pick = i
        break
      }
    }
    const centre = (points[pick] as Point).lab
    centres.push(centre)
    for (const [i, p] of points.entries())
      d2[i] = Math.min(d2[i] ?? 0, labDistance2(p.lab, centre, opts.weights))
  }
  return centres
}

/** At most `k` clusters (fewer when there are fewer distinct points), heaviest first. */
export function kmeans(points: readonly Point[], k: number, opts: KMeansOptions): Cluster[] {
  if (points.length === 0 || k < 1) return []
  let centres = seedCentres(points, k, opts)
  let assign = new Int32Array(points.length).fill(-1)
  for (let it = 0; it < (opts.iterations ?? 50); it++) {
    const next = new Int32Array(points.length)
    for (const [i, p] of points.entries()) {
      let best = 0
      let bestD = Number.POSITIVE_INFINITY
      for (const [c, centre] of centres.entries()) {
        const d = labDistance2(p.lab, centre, opts.weights)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      next[i] = best
    }
    const settled = next.every((c, i) => c === assign[i])
    assign = next
    const members = centres.map((): number[] => [])
    for (const [i, c] of assign.entries()) members[c]?.push(i)
    centres = centres.map((centre, c) =>
      (members[c]?.length ?? 0) > 0 ? weightedMean(points, members[c] ?? []) : centre,
    )
    if (settled) break
  }
  const clusters = centres.map((centre): Cluster => ({ centre, weight: 0, members: [] }))
  for (const [i, c] of assign.entries()) {
    const cluster = clusters[c] as Cluster
    cluster.members.push(i)
    cluster.weight += (points[i] as Point).weight
  }
  return clusters.filter((c) => c.members.length > 0).sort((a, b) => b.weight - a.weight)
}

/**
 * A cluster as a ramp: its members sorted by lightness and cut into three bands of equal weight; each
 * tone is its band's weighted mean. A band that gets no member (a one-colour cluster) takes the base.
 */
export function rampTones(points: readonly Point[], cluster: Cluster): Record<Tone, Lab> {
  const sorted = [...cluster.members].sort(
    (a, b) => ((points[a] as Point).lab[0] ?? 0) - ((points[b] as Point).lab[0] ?? 0),
  )
  const bands: number[][] = [[], [], []]
  let seen = 0
  for (const i of sorted) {
    const w = (points[i] as Point).weight
    // A member goes to the band its weight's midpoint falls in.
    const band = Math.min(2, Math.floor(((seen + w / 2) / cluster.weight) * 3))
    bands[band]?.push(i)
    seen += w
  }
  const base = bands[1]?.length ? weightedMean(points, bands[1]) : cluster.centre
  const tone = (band: number[] | undefined): Lab => (band?.length ? weightedMean(points, band) : base)
  return { dark: tone(bands[0]), base, light: tone(bands[2]) }
}

/** OKLab → "#rrggbb" (clamped into sRGB). */
export function labHex(lab: Lab): string {
  const [r, g, b] = oklabToSrgb(lab).map((c) => Math.round(c * 255))
  return `#${(((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0)).toString(16).padStart(6, "0")}`
}
