/** The atmosphere lab's deep link (pure): the town's seed and harbour, the hour, the camera, each feature. */
import type { AtmosphereParams } from "@guildhall/render"

export const CAMS = ["hero", "coast", "wide"] as const
export type Cam = (typeof CAMS)[number]

export interface AtmosphereQuery {
  seed: number
  /** The harbour's bearing, radians. */
  harbour: number
  hour: number
  cam: Cam
  /** Only what the link sets: the rest keep the atmosphere's defaults. */
  params: Partial<AtmosphereParams>
  wake: boolean
}

/** `?seed=&harbour=&hour=&cam=&coverage=&wind=&speed=&clouds=0|1&shadows=0|1&reflections=0|1&wake=0|1`. */
export function parseAtmosphereQuery(q: URLSearchParams): AtmosphereQuery {
  const num = (key: string, fallback: number) => {
    const v = Number(q.get(key))
    return q.has(key) && q.get(key) !== "" && Number.isFinite(v) ? v : fallback
  }
  const params: Partial<AtmosphereParams> = {}
  for (const key of ["clouds", "shadows", "reflections"] as const)
    if (q.has(key)) params[key] = q.get(key) !== "0"
  if (q.has("coverage")) params.coverage = Math.min(1, Math.max(0, num("coverage", 0.45)))
  if (q.has("wind")) params.windHeading = num("wind", 30)
  if (q.has("speed")) params.windSpeed = Math.max(0, num("speed", 4))
  const cam = q.get("cam") as Cam | null
  return {
    seed: Math.max(0, Math.floor(num("seed", 1))),
    harbour: num("harbour", 0.6),
    hour: num("hour", 17.5),
    cam: cam && CAMS.includes(cam) ? cam : "hero",
    params,
    wake: q.get("wake") === "1",
  }
}
