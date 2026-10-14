import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  guildhallZone,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  NATURE_CHOSEN,
  type PlaceSpec,
  parseTilePrefabs,
  workTiles,
} from "@guildhall/world"
import {
  bindPlaces,
  type EventLog,
  type Itinerary,
  type ItineraryOptions,
  itineraries,
  type LifeKit,
  poseAt,
  story,
} from "../src/index.ts"
import { played } from "./stories-fixtures.ts"

/**
 * The saga on Guildhall's island as the hall plays it (the hall's pace: hexworld/lifePlan.ts
 * `AGENT_OPTS`, three hero spots a place), for the choreography's measures and tests.
 */

const DIR = join(import.meta.dir, "../../../data/tiles")
export function installTiles(): void {
  installTilePrefabs(
    parseTilePrefabs(
      Object.fromEntries(
        readdirSync(DIR)
          .filter((f) => f.endsWith(".json"))
          .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
      ),
    ).prefabs,
  )
}

/** The hall's heroes' pace (studio hexworld/lifePlan.ts `AGENT_OPTS`: LIFE_MPS × AGENT_PACE, run past 10 s at up to 7 m/s). */
export const HALL_OPTS: ItineraryOptions = { mps: 0.8 * 1.15, hurry: { within: 10, mps: 7 } }

export interface SagaIsland {
  kit: LifeKit
  log: EventLog
  places: ReturnType<typeof lifePlaces>
  world: ReturnType<typeof hexWorld>
  /** Where a path lives on the island (sim `bindPlaces`). */
  placeOf: (path: string) => number | undefined
}

/** Guildhall's island from its chronicle, built as the hall builds it, and the saga told on it. */
/**
 * The hall /hall/codestz/guildhall as the Studio builds it (fixtures/hall-guildhall.json: its chronicle's
 * size and places; the island's seed from its slug, site routes.ts `hallSeed`; the chosen nature) and the
 * saga told on it as the hall tells it (its places as the story's units).
 */
export async function sagaIsland(): Promise<SagaIsland> {
  const hall = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "hall-guildhall.json"), "utf8")) as {
    name: string
    files: number
    places: PlaceSpec[]
  }
  const specs = hall.places
  const h = hexIsland({ seed: hallSeed("codestz/guildhall"), files: hall.files })
  const z = hexZones(h, { wild: NATURE_CHOSEN.wild, places: specs })
  const w = hexWorld(h, z, { nature: NATURE_CHOSEN })
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
  const binding = bindPlaces(specs, z)
  const kit: LifeKit = {
    walk,
    spots: (zi) => places.heroSpots(zi),
    home: guildhallZone(walk, z),
    near: places.walkNear,
    island: h,
    board: places.heroSpots.board(),
  }
  const units = specs.map((p) => ({ name: p.id, files: p.files }))
  const told = story("saga", { repo: { name: hall.name, units }, seed: 1 })
  return { kit, log: played(told, binding.placeOf), places, world: w, placeOf: binding.placeOf }
}

/** The seed a repo's hall grows its island from (site routes.ts `hallSeed`: FNV-1a over the slug). */
function hallSeed(slug: string): number {
  let x = 0x811c9dc5
  for (const ch of slug.toLowerCase()) {
    x ^= ch.codePointAt(0) ?? 0
    x = Math.imul(x, 0x01000193) >>> 0
  }
  return (x % 9000) + 1
}

/** How a hero's time on the island is spent: walking, at its craft's work, and the rest (ms). */
export interface Share {
  walk: number
  craft: number
  other: number
  total: number
}

/** A hero's time sampled every `step` ms while it is on the island (to the log's last event). */
export function shareOf(its: ReadonlyMap<string, Itinerary>, end: number, step = 100): Share {
  const out: Share = { walk: 0, craft: 0, other: 0, total: 0 }
  for (const it of its.values()) {
    const first = it.steps[0]?.from ?? end
    for (let t = first; t < end; t += step) {
      const p = poseAt(it, t)
      if (!p) continue
      out.total += step
      if (p.act === "walk") out.walk += step
      else if (p.sample && isCraft(it, t)) out.craft += step
      else out.other += step
    }
  }
  return out
}

/** Whether a hero plays its call's craft at `t` (its act is a craft at a work stay). */
function isCraft(it: Itinerary, t: number): boolean {
  const act = [...it.acts].reverse().find((a) => a.from <= t)
  const step = [...it.steps].reverse().find((s) => s.from <= t)
  return !!act && act.to > t && act.play === "craft" && step?.kind === "stay" && step.act === "work"
}

export { itineraries }
