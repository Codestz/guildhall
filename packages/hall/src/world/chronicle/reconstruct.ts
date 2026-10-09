import type { Folder, RepoShape } from "../gen/repo.ts"
import type { Chronicle, Day, Unit } from "./format.ts"

/**
 * A chronicle read at a day: which units exist and how big, and how that lands on today's island
 * (the RepoShape summarize made of today's tree). Sizes are interpolated linearly between samples;
 * a unit exists from its `born` day until its `died` day (exact in a deep chronicle).
 */

export interface UnitAt {
  name: string
  group?: string
  born: Day
  language: string
  files: number
  bytes: number
}

/** The units alive on `day`, with their interpolated size (at least one file once born). */
export function unitsAt(c: Chronicle, day: Day): UnitAt[] {
  const days = c.snapshots.day
  const out: UnitAt[] = []
  for (const unit of c.units) {
    if (day < unit.born || (unit.died !== undefined && day >= unit.died)) continue
    const files = sample(days, unit.files, unit.born, day)
    const bytes = sample(days, unit.bytes, unit.born, day)
    out.push({
      name: unit.name,
      ...(unit.group ? { group: unit.group } : {}),
      born: unit.born,
      language: unit.language,
      files: Math.max(1, Math.round(files)),
      bytes: Math.max(0, Math.round(bytes)),
    })
  }
  return out
}

/**
 * A column's value on `day`: linear between the samples around it. A unit grows from nothing on its
 * `born` day to the first sample that holds it; after the last sample it holds.
 */
function sample(days: readonly Day[], column: readonly number[], born: Day, day: Day): number {
  const points: [Day, number][] = []
  days.forEach((d, i) => {
    const value = column[i] ?? 0
    if (d >= born || value > 0) points.push([d, value])
  })
  const first = points[0]
  if (!first || first[0] > born) points.unshift([born, 0])
  const after = points.findIndex(([d]) => d >= day)
  if (after === -1) return points[points.length - 1]?.[1] ?? 0
  const [toDay, to] = points[after] as [Day, number]
  const before = points[after - 1]
  if (!before || toDay === day) return to
  const [fromDay, from] = before
  return from + ((to - from) * (day - fromDay)) / (toDay - fromDay)
}

export interface DistrictAt {
  files: number
  bytes: number
  /** The earliest birth of the units it is made of (undefined: none of them is in the chronicle). */
  born?: Day
}

export interface DistrictsAt {
  /** Every district of today's island (shape.root's "/" included), sized on `day` (0 before it exists). */
  districts: Map<string, DistrictAt>
  /** Units alive on `day` that are not on today's island (gone since, or renamed away). */
  ghosts: UnitAt[]
}

/**
 * Today's districts as they were on `day`. On or after the chronicle's end it is exactly today's
 * island (the shape's own sizes), so a timelapse always ends on the island the hall draws.
 */
export function districtsAt(c: Chronicle, shape: RepoShape, day: Day): DistrictsAt {
  const map = districtOf(c, shape)
  const districts = new Map<string, DistrictAt>()
  for (const folder of [shape.root, ...shape.folders]) {
    const born = c.units.filter((unit) => map.get(unit.name) === folder.name).map((unit) => unit.born)
    districts.set(folder.name, {
      files: day >= c.end ? folder.files : 0,
      bytes: day >= c.end ? folder.bytes : 0,
      ...(born.length > 0 ? { born: Math.min(...born) } : {}),
    })
  }
  if (day >= c.end) return { districts, ghosts: [] }
  const ghosts: UnitAt[] = []
  for (const unit of unitsAt(c, day)) {
    const district = districts.get(map.get(unit.name) ?? "")
    if (!district) {
      ghosts.push(unit)
      continue
    }
    district.files += unit.files
    district.bytes += unit.bytes
  }
  return { districts, ghosts }
}

/**
 * Which of today's districts each unit becomes, by summarize's rules: a package to its village (or
 * its workspace's pool), a container's loose files to the pool or its biggest village, a folder to
 * its district, the rest to the "+N more" wilds. A unit with no district is left out (a ghost).
 */
export function districtOf(c: Chronicle, shape: { folders: readonly Folder[] }): Map<string, string> {
  const map = new Map<string, string>()
  const named = new Set(shape.folders.map((folder) => folder.name))
  const wilds = shape.folders.find((folder) => folder.pooled && !folder.group)?.name
  const villages = new Map<string, { pool?: string; biggest?: string }>()
  for (const folder of shape.folders) {
    if (!folder.group) continue
    const known = villages.get(folder.group) ?? {}
    if (folder.pooled) known.pool = folder.name
    else known.biggest ??= folder.name
    villages.set(folder.group, known)
  }
  map.set("/", "/")
  for (const unit of c.units) {
    if (unit.name === "/") continue
    const target = targetOf(unit)
    if (target) map.set(unit.name, target)
  }
  return map

  function targetOf(unit: Unit): string | undefined {
    if (named.has(unit.name) && !unit.pooled) return unit.name
    // Gone by the end: not on today's island.
    if (unit.died !== undefined) return undefined
    const container = unit.group ?? unit.name
    const split = villages.get(container)
    if (split) return split.pool ?? (unit.group ? undefined : split.biggest)
    // The container is one district (not split), or it was too small and went to the wilds.
    return named.has(container) ? container : wilds
  }
}
