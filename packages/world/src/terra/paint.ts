/**
 * The terrain as a map image: one RGBA pixel per cell, hillshaded from the north-west, with sand on
 * the gentle shore, rock on cliffs and terrace risers, grass toned by height and terrace level, and
 * water by depth. Pure (no DOM), so the Studio paints it into a canvas and scripts into a PNG.
 */
import { TERRA_CRAG, TERRA_WATER, type Terra } from "./island.ts"

type RGB = [number, number, number]
const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.max(0, Math.min(1, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

const SEA_SHALLOW: RGB = [124, 196, 228]
const SEA_DEEP: RGB = [38, 102, 152]
const FOAM: RGB = [214, 238, 246]
const LAKE: RGB = [79, 151, 214]
const RIVER: RGB = [88, 162, 220]
const SAND: RGB = [236, 217, 160]
const ROCK: RGB = [150, 128, 104]
const STACK: RGB = [156, 143, 128]
const LOW: RGB = [156, 204, 106]
const MID: RGB = [122, 178, 88]
/** Treads grow a touch drier and lighter going up. */
const treadOf = (lvl: number): RGB => mix([132, 184, 92], [170, 184, 112], (lvl - 1) / 5)
const PEAK: RGB = [184, 168, 140]

export interface PaintOptions {
  /** Hillshade on (default true). */
  shade?: boolean
  /** Darken terrace edges (default true). */
  contours?: boolean
  /** Tint by flow accumulation instead (debug). */
  flow?: boolean
}

/** RGBA, `t.w × t.h`, row-major. */
export function paintTerra(t: Terra, opts: PaintOptions = {}): Uint8ClampedArray {
  const { w, h, cell, height, water, coastDist, slope, terraceLevel, acc } = t
  const shade = opts.shade ?? true
  const contours = opts.contours ?? true
  const out = new Uint8ClampedArray(w * h * 4)
  const L = [-0.55, -0.62, 0.56]
  const ln = Math.hypot(L[0]!, L[1]!, L[2]!)
  let maxAcc = 1
  if (opts.flow) for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]!)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const wk = water[i]!
      const ht = height[i]!
      let c: RGB
      if (wk === TERRA_WATER.sea) {
        const nearLand = coastDistToLand(t, i)
        c = nearLand ? FOAM : mix(SEA_SHALLOW, SEA_DEEP, (-ht - 0.6) / 9)
      } else if (wk === TERRA_WATER.lake) c = LAKE
      else if (wk === TERRA_WATER.river) c = RIVER
      else if (wk === TERRA_WATER.stack) c = STACK
      else {
        const D = coastDist[i]!
        const sl = slope[i]!
        const lvl = terraceLevel[i]!
        if (sl > 0.85) c = ROCK
        else if (D < 16 && ht < 1.5 && sl < 0.45) c = mix(SAND, LOW, (D - 8) / 8)
        else if (lvl === TERRA_CRAG) c = PEAK
        else if (lvl > 0) c = treadOf(lvl)
        else c = mix(LOW, MID, (ht - 1) / 4)
        if (opts.flow) {
          const f = Math.log(1 + acc[i]!) / Math.log(1 + maxAcc)
          c = mix(c, [30, 60, 200], f * f * 1.4)
        }
      }
      let k = 1
      if (shade && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const ex = 1.6
        const gx = ((Math.max(height[i + 1]!, -1) - Math.max(height[i - 1]!, -1)) / (2 * cell)) * ex
        const gz = ((Math.max(height[i + w]!, -1) - Math.max(height[i - w]!, -1)) / (2 * cell)) * ex
        const nl = Math.hypot(gx, gz, 1)
        const d = (-gx * L[0]! - gz * L[1]! + L[2]!) / (nl * ln)
        k = 0.55 + 0.62 * Math.max(0, d)
        if (wk === TERRA_WATER.sea) k = 0.85 + 0.15 * k
      }
      if (contours && wk === TERRA_WATER.land && x < w - 1 && y < h - 1) {
        const lv = terraceLevel[i]!
        if (lv !== terraceLevel[i + 1] || lv !== terraceLevel[i + w]) k *= 0.8
      }
      const o = i * 4
      out[o] = c[0] * k
      out[o + 1] = c[1] * k
      out[o + 2] = c[2] * k
      out[o + 3] = 255
    }
  return out
}

/** A sea cell touching land (surf line). */
function coastDistToLand(t: Terra, i: number): boolean {
  const { w, water } = t
  const x = i % w
  for (const j of [i - 1, i + 1, i - w, i + w]) {
    if (j < 0 || j >= water.length) continue
    if (Math.abs((j % w) - x) > 1) continue
    const k = water[j]
    if (k === TERRA_WATER.land || k === TERRA_WATER.river || k === TERRA_WATER.lake) return true
  }
  return false
}
