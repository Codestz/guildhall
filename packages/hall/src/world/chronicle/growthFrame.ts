import { dayAt, type GrowthPlan, RISE_S, SINK_S } from "./growth.ts"
import { heldAt, STEP_S } from "./growthSpans.ts"

/** The growth timelapse read at one film time (growth.ts' plan → a frame the scene draws). */

export interface GrowthFrame {
  t: number
  day: number
  /** Per hex: −1 sunk out of sight … 0 in place (a little above while it overshoots). */
  rise: Float32Array
  /** Per hex: how far up it is, 0 under the sea … 1 risen. */
  up: Float32Array
  /** Per hex: film seconds since it finished rising (negative while it rises or before). */
  since: Float32Array
  /**
   * Per hex: film seconds since its own district took it (risen), for what is built on it; −1 while
   * the hex is not its district's (under the sea, or only a ghost's borrowed land).
   */
  built: Float32Array
  /** Per hex: 1 while only a ghost holds it. */
  ghost: Uint8Array
  /** Per plan district: heat 0–1, and how much of its land is up 0–1. */
  heat: Float32Array
  alpha: Float32Array
  /** Where the land up now is centred, and how far it reaches (world units). */
  center: [number, number]
  radius: number
}

export function emptyFrame(g: GrowthPlan): GrowthFrame {
  const n = g.cells.length
  return {
    t: 0,
    day: g.start,
    rise: new Float32Array(n),
    up: new Float32Array(n),
    since: new Float32Array(n),
    built: new Float32Array(n),
    ghost: new Uint8Array(n),
    heat: new Float32Array(g.districts.length),
    alpha: new Float32Array(g.districts.length),
    center: [0, 0],
    radius: 0,
  }
}

const BACK = 1.70158
/** 0 → 1 past 1 and back (the pop's small overshoot). */
const easeOutBack = (p: number): number => 1 + (BACK + 1) * (p - 1) ** 3 + BACK * (p - 1) ** 2

/** The island at film time `t` (clamped to the film), written into `out`. */
export function growthAt(g: GrowthPlan, t: number, out: GrowthFrame = emptyFrame(g)): GrowthFrame {
  const time = Math.min(g.duration, Math.max(0, t))
  out.t = time
  out.day = dayAt(g, time)
  for (let h = 0; h < g.cells.length; h++) {
    const spans = g.any[h] as number[]
    let last = -1
    for (let i = 0; i < spans.length; i += 2) {
      if ((spans[i] as number) > time) break
      last = i
    }
    let rise = -1
    let up = 0
    let since = -1
    if (last >= 0) {
      const on = spans[last] as number
      const off = spans[last + 1] as number
      since = time - on - RISE_S
      if (time < off) {
        const p = Math.min(1, (time - on) / RISE_S)
        rise = p >= 1 ? 0 : easeOutBack(p) - 1
        up = p
      } else {
        const q = (time - off) / SINK_S
        if (q < 1) {
          rise = -(q * q)
          up = 1 - q
        }
      }
    }
    out.rise[h] = rise
    out.up[h] = up
    out.since[h] = up > 0 ? since : -1
    const ghost = up > 0 && heldAt(g.ghostHeld[h] as number[], time) && !heldAt(g.own[h] as number[], time)
    out.ghost[h] = ghost ? 1 : 0
    const own = lastOn(g.own[h] as number[], time)
    out.built[h] = up > 0 && !ghost && own !== undefined ? time - own - RISE_S : -1
  }
  const at = Math.min(g.steps - 1, time / STEP_S)
  const i0 = Math.floor(at)
  const i1 = Math.min(g.steps - 1, i0 + 1)
  const f = at - i0
  const lerp = (a: number, b: number) => a + (b - a) * f
  g.districts.forEach((d, di) => {
    out.heat[di] = lerp(g.heat[di * g.steps + i0] as number, g.heat[di * g.steps + i1] as number)
    let risen = 0
    for (const h of d.hexes) risen += out.up[h] as number
    out.alpha[di] = d.hexes.length > 0 ? risen / d.hexes.length : 1
  })
  out.center[0] = lerp(g.frame[i0 * 3] as number, g.frame[i1 * 3] as number)
  out.center[1] = lerp(g.frame[i0 * 3 + 1] as number, g.frame[i1 * 3 + 1] as number)
  out.radius = lerp(g.frame[i0 * 3 + 2] as number, g.frame[i1 * 3 + 2] as number)
  return out
}

/** The start of the latest interval begun by `time`, if any. */
function lastOn(spans: readonly number[], time: number): number | undefined {
  let on: number | undefined
  for (let i = 0; i < spans.length; i += 2) {
    if ((spans[i] as number) > time) break
    on = spans[i] as number
  }
  return on
}

/** The hex index a world spot belongs to: its own cell's, else the nearest land hex's. */
export function hexOf(g: GrowthPlan, x: number, z: number): number {
  let best = 0
  let distance = Number.POSITIVE_INFINITY
  for (let h = 0; h < g.cells.length; h++) {
    const d = Math.hypot((g.spots[h * 2] as number) - x, (g.spots[h * 2 + 1] as number) - z)
    if (d < distance) {
      distance = d
      best = h
    }
  }
  return best
}
