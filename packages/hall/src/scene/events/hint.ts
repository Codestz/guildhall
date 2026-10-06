import type { HintOptions, Place, ShotKind } from "../../guild/director.ts"
import type { GuildStore } from "../../guild/store.ts"

/**
 * The camera's side of a world event: a focus hint for Director v2 (guild/director.ts,
 * `store.director.hint(subject, weight, ttl)`). The events never touch CameraRig.tsx; the Director
 * decides whether a hint wins against what the adventurers are doing. Weights use its scale
 * (10 a plea, 8 a rise, 6 loot, 1 a routine deed).
 */
export interface EventLook {
  /** The ground point to film, and how much of it (world units). */
  x: number
  z: number
  radius: number
  weight: number
  ttl: number
  shot: ShotKind
}

export function hintCamera(store: Pick<GuildStore, "director">, look: EventLook, label: string): void {
  const place: Place = { key: `event:${label}`, label, x: look.x, z: look.z, radius: look.radius }
  const options: HintOptions = { shot: look.shot }
  store.director.hint(place, look.weight, look.ttl, options)
}
