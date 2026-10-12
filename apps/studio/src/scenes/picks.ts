/**
 * The scale scene's cast (AC1.5), chosen from the catalog by rule rather than by id, so it follows the
 * library as packs are re-imported: a hero, a door, one house per vendor and one tree per vendor.
 */
import {
  type Catalog,
  type CatalogEntry,
  type Category,
  DOOR_TOP,
  SCALE_TARGETS,
  type ScaleTarget,
  STOREY,
} from "@guildhall/assets"

/** The vendors the Look bar compares, left to right. */
export const VENDORS = [
  { id: "kaykit", name: "KayKit" },
  { id: "kenney", name: "Kenney" },
  { id: "quaternius", name: "Quaternius" },
] as const

export interface Pick {
  /** What the slot stands for: "hero", "door", "KayKit house", … */
  label: string
  /** Null when the library has nothing that fits. */
  entry: CatalogEntry | null
}

const REF = "scale-ref"

const middle = ([min, max]: ScaleTarget): number => (max === null ? min : (min + max) / 2)
const isRef = (e: CatalogEntry) => e.tags.includes(REF)

/** The entry whose height is nearest `metres`; ties keep catalog (id) order. */
function nearest(entries: readonly CatalogEntry[], metres: number): CatalogEntry | null {
  let best: CatalogEntry | null = null
  for (const e of entries)
    if (!best || Math.abs(e.size[1] - metres) < Math.abs(best.size[1] - metres)) best = e
  return best
}

/** A scale reference among `entries` if there is one, else the one nearest `metres` tall. */
function preferRef(entries: readonly CatalogEntry[], metres: number): CatalogEntry | null {
  return nearest(entries.filter(isRef), metres) ?? nearest(entries, metres)
}

function vendorEntries(catalog: Catalog, vendor: string): CatalogEntry[] {
  const packs = new Set(catalog.index.packs.filter((p) => p.vendor === vendor).map((p) => p.id))
  return catalog.all().filter((e) => packs.has(e.pack))
}

const ofCategory = (entries: readonly CatalogEntry[], category: Category) =>
  entries.filter((e) => e.category === category)

/**
 * A vendor's house: a piece tagged `house` (its scale reference first). A kit that ships no whole
 * house (Kenney builds them from walls) stands in with its doored storey: the `door`-tagged scale
 * reference nearest one storey tall.
 */
function house(entries: readonly CatalogEntry[]): CatalogEntry | null {
  const houses = entries.filter((e) => e.tags.includes("house"))
  if (houses.length > 0) return preferRef(houses, middle(SCALE_TARGETS.building ?? STOREY))
  return nearest(
    entries.filter((e) => isRef(e) && e.tags.includes("door")),
    middle(STOREY),
  )
}

/** The cast, left to right: hero (when the library has a character), door, houses, trees. */
export function scalePicks(catalog: Catalog): Pick[] {
  const all = catalog.all()
  const picks: Pick[] = []
  const hero = preferRef(ofCategory(all, "character"), 2.2)
  if (hero) picks.push({ label: "hero", entry: hero })
  // A door leaf whose top is in the band; else the door nearest it.
  const doors = ofCategory(all, "door")
  const [low, high] = DOOR_TOP
  const inBand = doors.filter((e) => e.size[1] >= low && e.size[1] <= (high ?? low))
  picks.push({ label: "door", entry: nearest(inBand, middle(DOOR_TOP)) ?? nearest(doors, middle(DOOR_TOP)) })
  const byVendor = VENDORS.map((v) => ({ ...v, entries: vendorEntries(catalog, v.id) }))
  for (const v of byVendor) picks.push({ label: `${v.name} house`, entry: house(v.entries) })
  const tree = middle(SCALE_TARGETS.tree ?? [4, 9])
  // A leafy tree: a bare or dead one reads as dead wood, not as the vendor's tree.
  const leafy = (entries: readonly CatalogEntry[]) =>
    ofCategory(entries, "tree").filter((e) => !e.tags.includes("bare") && !/dead/i.test(e.name))
  for (const v of byVendor) picks.push({ label: `${v.name} tree`, entry: preferRef(leafy(v.entries), tree) })
  return picks
}
