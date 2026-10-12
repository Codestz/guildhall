/** The crowd bench's deep link: `?n=60&path=crowd&cam=wide&hour=17.5&t=12&play=1&seed=1&layout=town`. */

export const CROWD_PATHS = ["crowd", "bake", "merged", "both", "none"] as const
export type CrowdPath = (typeof CROWD_PATHS)[number]

export interface CrowdQuery {
  /** People per group, 1–1000. */
  n: number
  path: CrowdPath
  cam: "wide" | "close"
  /** Hour of day; golden hour by default. */
  hour: number
  /** The sim clock to start at (seconds). */
  t: number
  /** Run the clock (0 freezes it at `t`, for still shots). */
  play: boolean
  seed: number
  /** `town`: the plaza; `line`: everyone in a row, idle, facing the camera (bake and merged one behind the other). */
  layout: "town" | "line"
}

const DEFAULT: CrowdQuery = { n: 60, path: "crowd", cam: "wide", hour: 17.5, t: 12, play: true, seed: 1, layout: "town" }

const num = (text: string | null, fallback: number, min: number, max: number): number => {
  const value = text === null || text.trim() === "" ? Number.NaN : Number(text)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function parseCrowdQuery(q: URLSearchParams): CrowdQuery {
  const path = q.get("path")
  return {
    n: Math.round(num(q.get("n"), DEFAULT.n, 1, 1000)),
    path: CROWD_PATHS.includes(path as CrowdPath) ? (path as CrowdPath) : DEFAULT.path,
    cam: q.get("cam") === "close" ? "close" : "wide",
    hour: num(q.get("hour"), DEFAULT.hour, 0, 24),
    t: num(q.get("t"), DEFAULT.t, 0, 1e6),
    play: q.get("play") !== "0",
    seed: Math.round(num(q.get("seed"), DEFAULT.seed, 0, 1e9)),
    layout: q.get("layout") === "line" ? "line" : "town",
  }
}
