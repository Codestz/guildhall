/**
 * Where a story's folders go on the home island, which is no repo's: its own zones, by what each is for.
 * A path's district (its first two folders) goes to the first zone of the kind its name says (tests to the
 * camp, docs to the monastery, assets to the harbour, scripts to the mine, the app to the market), else
 * the next kind round; two districts of one kind take the zone after. The first district to ask keeps its
 * zone for the story's whole telling, so a hero walking between two folders walks between two places.
 */
import type { SessionPlaces } from "../hall/feeds/places.ts"
import { HALL } from "../hall/feeds/view.ts"

/** The kinds a district falls to when its name says nothing, in turn. */
const ROUND = [
  "market",
  "monastery",
  "camp",
  "harbour",
  "mine",
  "town",
  "farm",
  "lumber",
  "fishing",
  "hamlet",
]

const BY_NAME: readonly (readonly [RegExp, string])[] = [
  [/test|spec|drill|arena|e2e/, "camp"],
  [/doc|guide|readme|wiki|notes/, "monastery"],
  [/asset|public|static|image|media|data|fixture/, "harbour"],
  [/script|tool|bin|infra|config|build|ci|deploy/, "mine"],
  [/app|web|ui|site|studio|client|view|page/, "market"],
]

/** The words a zone is called by in the Guild's lines ("at the market"). */
const NAMES: Record<string, string> = {
  market: "the market",
  monastery: "the monastery",
  camp: "the camp",
  harbour: "the harbour",
  mine: "the mine",
  town: "the town",
  farm: "the farm",
  lumber: "the lumber camp",
  fishing: "the fishing village",
  hamlet: "the hamlet",
  castle: "the keep",
}

const DEMO_ROOT = /^\/demo\/guildhall\//

/** The district a path is in: its first two folders (a last part with a dot is a file). */
export function districtOf(path: string): string {
  const parts = path
    .replace(DEMO_ROOT, "")
    .split(/[\\/]+/)
    .filter(Boolean)
  if (parts.length > 0 && /\./.test(parts[parts.length - 1] as string)) parts.pop()
  return parts.slice(0, 2).join("/")
}

export interface HomePlaces extends SessionPlaces {
  /** A new story: the districts are dealt again. */
  reset(): void
}

/** The places of an island's own zones (`HudParts.zoneKinds`). */
export function homePlaces(kinds: readonly string[]): HomePlaces {
  const zonesOf = (kind: string) => kinds.flatMap((k, zone) => (k === kind ? [zone] : []))
  let dealt = new Map<string, number | null>()
  let used = new Map<string, number>()
  let turn = 0
  const zoneFor = (district: string): number | undefined => {
    const hit = dealt.get(district)
    if (hit !== undefined) return hit ?? undefined
    const named = BY_NAME.find(([re]) => re.test(district.toLowerCase()))?.[1]
    let kind = named
    // a name that says nothing, or whose kind this island has not got: the next kind in turn that it has
    for (let k = 0; k < ROUND.length && (!kind || zonesOf(kind).length === 0); k++)
      kind = ROUND[turn++ % ROUND.length]
    const zones = kind ? zonesOf(kind) : []
    if (!kind || zones.length === 0) {
      dealt.set(district, null)
      return undefined
    }
    const n = used.get(kind) ?? 0
    used.set(kind, n + 1)
    const zone = zones[n % zones.length] as number
    dealt.set(district, zone)
    return zone
  }
  return {
    placeOf: (path) => {
      const district = districtOf(path)
      return district ? zoneFor(district) : undefined
    },
    name: (zone) => (zone === undefined ? HALL : (NAMES[kinds[zone] ?? ""] ?? HALL)),
    placeAt: () => undefined,
    folderAt(zone) {
      for (const [district, at] of dealt) if (at === zone) return district
      return undefined
    },
    reset() {
      dealt = new Map()
      used = new Map()
      turn = 0
    },
  }
}
