/** The night bench's deep link, parsed (pure). */
import { TIERS, type Tier } from "@guildhall/world"

export interface NightQuery {
  seed: number
  tier: Tier
  /** The hour shown (0–24). */
  hour: number
  /** Hours per second the clock runs at when playing; 0 starts paused. */
  play: number
}

export function parseNightQuery(q: URLSearchParams): NightQuery {
  const num = (key: string, fallback: number) => {
    const v = Number(q.get(key))
    return q.has(key) && q.get(key) !== "" && Number.isFinite(v) ? v : fallback
  }
  const tier = q.get("tier") as Tier | null
  return {
    seed: Math.max(0, Math.floor(num("seed", 2))),
    tier: tier && TIERS.includes(tier) ? tier : "town",
    hour: ((num("hour", 21) % 24) + 24) % 24,
    play: Math.max(0, num("play", 0)),
  }
}

/** `h` as a clock, `21:30`. */
export function clock(h: number): string {
  const m = Math.round((((h % 24) + 24) % 24) * 60) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}
