/**
 * A repository's units as places on its island (plan-hud-events.md E3, decisions.md "Hex plan go:
 * packages → places (hybrid)"): the biggest unit is the capital (the town on the square, by the
 * Guildhall); every other unit is a place of its own, named after it, sized by its files and built as what
 * it holds (tests a camp, docs a monastery, build and scripts a mine, assets a fishing village, the
 * repo's root files the harbour, where the ships come in) or, for code, a settlement whose tier climbs
 * with its files (hamlet, village, town). Units come in the order they were born, so a repo that grows
 * only adds places; a spec list is deterministic for a unit list. Pure.
 */
import type { HexZones, PlaceSpec, ZoneKind } from "@guildhall/world"
import type { UnitAt } from "./chronicle.ts"

/** Land tiles one place needs on the island, on average, before small units pool into one hamlet. */
export const TILES_PER_PLACE = 55
/** However small the island, this many places fit on it. */
export const MIN_PLACES = 6

/** Files from which a settlement is a village (tier 2) and a market town (tier 3), or its share of the repo. */
const VILLAGE = { files: 60, share: 0.01 }
const TOWN = { files: 1000, share: 0.08 }

/** What a unit's name says it holds, by its last segment (the folder's own name), tier 2 and up. */
const CONTENT: [RegExp, ZoneKind][] = [
  [/^(tests?|__tests?__|e2e|spec|specs|fixtures?|test-?utils?|testing)$/i, "camp"],
  [/^(docs?|documentation|website|site|guide|guides|wiki|book|examples?|samples?)$/i, "monastery"],
  [/^(build|scripts?|tools?|tooling|ci|infra|infrastructure|deploy|config|configs?|\.[\w-]+)$/i, "mine"],
  [/^(assets?|data|public|static|resources?|media|images?|fonts?|icons?)$/i, "fishing"],
  [/^(vendor|vendors|third[-_]party|deps|dependencies|node_modules|external)$/i, "lumber"],
]

/**
 * The name on a place's plate: the folder's own name; the root is the repo's own name (`repo`,
 * "facebook/react" or "react", gives "react"; "root" without one), and the pools say what they are.
 */
export function placeLabel(name: string, pooled?: boolean, repo?: string): string {
  if (name === "/") return repo?.split("/").filter(Boolean).pop() || "root"
  if (name === "*") return "other folders"
  if (pooled || name.endsWith("/*")) return `other ${name.slice(0, -2).split("/").pop() || "folders"}`
  return name.split("/").pop() || name
}

/** The settlement's tier for a unit of `files` files in a repo of `total`. */
export function tierOf(files: number, total: number): 1 | 2 | 3 {
  const share = total > 0 ? files / total : 0
  if (files >= TOWN.files || share >= TOWN.share) return 3
  if (files >= VILLAGE.files || share >= VILLAGE.share) return 2
  return 1
}

/** What a unit is built as: its content's kind from tier 2 up, else a settlement of its tier. */
export function placeKind(name: string, tier: 1 | 2 | 3): PlaceSpec["kind"] {
  if (name === "/") return "harbour"
  if (tier === 1 || name.endsWith("*")) return "settlement"
  const own = name.split("/").pop() ?? name
  for (const [rule, kind] of CONTENT) if (rule.test(own)) return kind
  return "settlement"
}

/** How many places an island of `land` tiles has room for. */
export const placeCapacity = (land: number): number =>
  Math.max(MIN_PLACES, Math.floor(land / TILES_PER_PLACE))

const byBorn = (a: UnitAt, b: UnitAt) => a.born - b.born || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const byFiles = (a: UnitAt, b: UnitAt) =>
  b.files - a.files || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/**
 * The places a repo's units ask for on an island of `land` tiles: the capital first (the biggest unit),
 * then the rest oldest first. Beyond what the land has room for, the smallest units pool into one hamlet
 * per group ("other packages", "other folders") with their files added up. `landAt(born)`, the land
 * tiles the island had on a day (`landTiles(filesAt(c, day))`), ranks each place under its unit's birth
 * so a history replay shows it from then. `repo` ("facebook/react") names the root's place.
 */
export function placeSpecs(
  units: readonly UnitAt[],
  land: number,
  landAt?: (born: number) => number,
  repo?: string,
): PlaceSpec[] {
  if (units.length === 0) return []
  const total = units.reduce((n, u) => n + u.files, 0)
  const bySize = [...units].sort(byFiles)
  const capital = bySize[0] as UnitAt
  const room = placeCapacity(land)
  // the units beyond the land's room pool into one unit per group: the chronicle's own pooled unit of
  // that group ("packages/*") when there is one, else a new one, its files added up
  const pools = new Map<string, { unit: UnitAt; names: string[] }>()
  const single: UnitAt[] = []
  for (const u of bySize.slice(0, room))
    if (u.name.endsWith("*")) pools.set(u.group ?? "", { unit: u, names: [] })
    else single.push(u)
  for (const u of bySize.slice(room)) {
    const key = u.group ?? ""
    const pool = pools.get(key) ?? {
      unit: {
        name: key ? `${key}/*` : "*",
        ...(key ? { group: key } : {}),
        born: u.born,
        language: u.language,
        files: 0,
        bytes: 0,
      },
      names: [],
    }
    pool.unit = { ...pool.unit, files: pool.unit.files + u.files, born: Math.min(pool.unit.born, u.born) }
    pool.names.push(u.name)
    pools.set(key, pool)
  }
  const spec = (u: UnitAt): PlaceSpec => {
    const tier = tierOf(u.files, total)
    const pool = u.name.endsWith("*") ? pools.get(u.group ?? "") : undefined
    return {
      id: u.name,
      label: placeLabel(u.name, pool !== undefined, repo),
      kind: u === capital ? "settlement" : placeKind(u.name, tier),
      tier,
      files: u.files,
      ...(u === capital ? { capital: true as const } : {}),
      ...(pool?.names.length ? { pooled: pool.names } : {}),
      ...(landAt ? { rankMax: Math.max(1, landAt(u.born)) } : {}),
    }
  }
  const rest = [...single.filter((u) => u !== capital), ...[...pools.values()].map((p) => p.unit)].sort(
    byBorn,
  )
  return [spec(capital), ...rest.map(spec)]
}

/** A repo's places bound to the island's zones: which zone a unit, or a file's path, belongs to. */
export interface PlaceBinding {
  /** The zone index of a unit by name (a pooled unit's members included), or undefined. */
  zoneOfUnit(name: string): number | undefined
  /** The zone a file path leads to: its deepest unit's place, else the capital's (the town). */
  placeOf(path: string): number
  /** The zone index of the capital (the town). */
  capital: number
}

/**
 * Binds the units to the zones `hexZones(h, {places})` made from them. A path is matched by its segments:
 * the unit "packages/world" owns "…/guildhall/packages/world/src/hex/life.ts" (suffix-contained, so
 * absolute paths bind with no repo root on the wire); the deepest unit wins; no match goes to the capital.
 */
export function bindPlaces(specs: readonly PlaceSpec[], zones: Pick<HexZones, "zones">): PlaceBinding {
  const zoneOf = new Map<string, number>()
  zones.zones.forEach((z, zi) => {
    if (!z.place) return
    zoneOf.set(z.place.id, zi)
    for (const name of z.place.pooled ?? []) zoneOf.set(name, zi)
  })
  const capitalId = specs.find((s) => s.capital)?.id
  const capital = (capitalId !== undefined ? zoneOf.get(capitalId) : undefined) ?? 0
  // the units' names as segment lists, deepest first, so the first match is the deepest
  const units = [...zoneOf.keys()]
    .filter((name) => name !== "/" && !name.endsWith("*"))
    .map((name) => ({ name, parts: name.split("/").filter(Boolean) }))
    .sort((a, b) => b.parts.length - a.parts.length || (a.name < b.name ? -1 : 1))
  return {
    capital,
    zoneOfUnit: (name) => zoneOf.get(name),
    placeOf(path) {
      const parts = path.split(/[\\/]+/).filter(Boolean)
      for (const u of units) {
        for (let at = 0; at + u.parts.length < parts.length; at++) {
          let same = true
          for (let k = 0; k < u.parts.length && same; k++) same = parts[at + k] === u.parts[k]
          if (same) return zoneOf.get(u.name) ?? capital
        }
      }
      return capital
    },
  }
}
