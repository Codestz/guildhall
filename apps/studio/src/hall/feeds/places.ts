/**
 * The session's places: a file path bound to the zone the island built for its unit (sim `bindPlaces`,
 * by the zone index each built place carries), and a zone named as the HUD names it. The world's events
 * speak in zones (what L1's hero spots are kept by); the HUD speaks in the hall's built places.
 */
import { bindPlaces } from "@guildhall/sim"
import type { HexZones } from "@guildhall/world"
import type { HallRepo } from "../../hexworld/hall.ts"
import type { BuiltPlace } from "../../hexworld/job.ts"
import { HALL, type PlaceName } from "./view.ts"

export interface SessionPlaces {
  /** The zone a path leads to (undefined on a sketch: no places, every hero stays in the hall). */
  placeOf: ((path: string) => number | undefined) | undefined
  name: PlaceName
  /** The built place standing on a zone (the hall: the capital's). */
  placeAt(zone: number | undefined): BuiltPlace | undefined
  /** The folder a zone stands for, when it is not a built place's (the home: a story's district dealt to it). */
  folderAt?(zone: number): string | undefined
}

export function sessionPlaces(repo: HallRepo | null, places: readonly BuiltPlace[]): SessionPlaces {
  const byZone = new Map(places.map((p) => [p.zone, p]))
  const specs = repo?.kind === "chronicled" ? repo.places : []
  const capital = specs.find((s) => s.capital)?.id
  const hall = places.find((p) => p.id === capital) ?? places[0]
  let placeOf: SessionPlaces["placeOf"]
  if (specs.length && places.length) {
    // bindPlaces reads a zone's place (its id and pool) by the zone's index: the built places say both
    const spec = new Map(specs.map((s) => [s.id, s]))
    const zones: { place?: unknown }[] = []
    for (const p of places) zones[p.zone] = { place: spec.get(p.id) }
    for (let k = 0; k < zones.length; k++) zones[k] ??= {}
    placeOf = bindPlaces(specs, { zones } as unknown as Pick<HexZones, "zones">).placeOf
  }
  return {
    placeOf,
    name: (zone) => (zone === undefined ? HALL : (byZone.get(zone)?.label ?? HALL)),
    placeAt: (zone) => (zone === undefined ? hall : (byZone.get(zone) ?? hall)),
  }
}
