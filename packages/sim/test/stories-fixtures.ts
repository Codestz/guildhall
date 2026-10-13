import { join } from "node:path"
import { hexIsland, hexZones, landTiles } from "@guildhall/world"
import {
  bindPlaces,
  EventLog,
  filesAt,
  flush,
  type GuildWorld,
  normalize,
  normalizer,
  type PlaceBinding,
  placeSpecs,
  type Story,
  type StoryUnit,
  type UnitAt,
  unitsAt,
  type WireInput,
} from "../src/index.ts"
import { chronicle } from "./repo-fixtures.ts"

/** V1's own outputs for the ported DSL and stories (fixtures/stories/README.md). */
export const STORIES_DIR = join(import.meta.dir, "fixtures", "stories")

export async function v1(name: string): Promise<unknown> {
  return Bun.file(join(STORIES_DIR, `${name}.json`)).json()
}

/** A repo's island as the hall builds it: its units, the places they ask for, the zones and the binding. */
export interface Hall {
  name: string
  units: UnitAt[]
  binding: PlaceBinding
  /** The unit a zone index is the place of (`hall` for the castle, undefined). */
  unitOf(zone: number | undefined): string
}

function hallOf(name: string, units: UnitAt[], files: number, seed = 7): Hall {
  const specs = placeSpecs(units, landTiles(files), undefined, name)
  const zones = hexZones(hexIsland({ seed, files }), { places: specs })
  const binding = bindPlaces(specs, zones)
  return {
    name,
    units,
    binding,
    unitOf: (zone) => (zone === undefined ? "hall" : (zones.zones[zone]?.place?.id ?? `zone ${zone}`)),
  }
}

/** Guildhall's island from its bundled chronicle (V1's layout: packages/hall, core, roster, herald…). */
export async function guildhallHall(): Promise<Hall> {
  const c = await chronicle("guildhall")
  return hallOf(c.repo.name, unitsAt(c, c.end), Math.max(1, filesAt(c, c.end)))
}

const unit = (name: string, files: number, group?: string): UnitAt => ({
  name,
  ...(group ? { group } : {}),
  born: 20_700,
  language: "TypeScript",
  files,
  bytes: files * 4000,
})

/** This repo's own layout today (V2: `git ls-files` per unit, legacy/ left out), for the saga's own paths. */
export const V2_UNITS: UnitAt[] = [
  unit("apps/studio", 204, "apps"),
  unit("packages/render", 103, "packages"),
  unit("data", 99),
  unit("packages/sim", 95, "packages"),
  unit("tools/import", 88, "tools"),
  unit("packages/ui", 64, "packages"),
  unit("packages/world", 60, "packages"),
  unit("packages/assets", 38, "packages"),
  unit("test", 31),
  unit("packages/core", 28, "packages"),
  unit("tools/shots", 23, "tools"),
  unit("/", 10),
]

export function v2Hall(): Hall {
  return hallOf("Codestz/guildhall", V2_UNITS, 1000)
}

export const unitsOf = (hall: Hall): StoryUnit[] => hall.units.map((u) => ({ name: u.name, files: u.files }))

/** A story's wire, guild events and sea merged by time (guild first on a tie), as a feed plays it. */
export function wireOf(story: Pick<Story, "events" | "seas">): WireInput[] {
  const all: { at: number; order: number; input: WireInput }[] = [
    ...story.events.map((e, i) => ({ at: e.change.at, order: i, input: e as WireInput })),
    ...story.seas.map((e, i) => ({ at: e.at, order: story.events.length + i, input: e as WireInput })),
  ]
  return all.sort((a, b) => a.at - b.at || a.order - b.order).map((x) => x.input)
}

/** A story normalised (with `placeOf`) into a log, the leaves flushed to `until` (default its end + 60 s). */
export function played(
  story: Pick<Story, "events" | "seas" | "duration">,
  placeOf?: (path: string) => number | undefined,
  until = story.duration + 60_000,
): EventLog {
  const ctx = normalizer(placeOf ? { placeOf } : {})
  const log = new EventLog()
  for (const input of wireOf(story)) log.append(...normalize(input, ctx))
  log.append(...flush(ctx, until))
  return log
}

export type { GuildWorld }
