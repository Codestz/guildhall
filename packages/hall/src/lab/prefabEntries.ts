import type { KitColour } from "../world/gen/biomes.ts"
import { turn } from "../world/gen/tiles.ts"
import { cellToWorld, type LandPlacement } from "../world/lands.ts"
import { COMPOSITES, type Composed, type Composite, composed } from "../world/prefabs/composite/index.ts"
import { PREFABS, type Prefab } from "../world/prefabs/index.ts"

/**
 * What the prefab lab (prefabLab.ts) lays out: the catalogue's prefabs, then the composite landmarks
 * in a section of their own (a composite is flattened to a plain prefab for the seed it shows), and
 * where each one stands on the grid.
 */

export interface Entry {
  id: string
  label: string
  rings: number
  section: "prefabs" | "composites"
  /** The prefab as the catalogue has it (a composite's plain one, seed 0). */
  prefab: Prefab
  composite?: Composite
}

export const ENTRIES: readonly Entry[] = [
  ...PREFABS.map(
    (prefab): Entry => ({
      id: prefab.id,
      label: prefab.label,
      rings: prefab.rings,
      section: "prefabs",
      prefab,
    }),
  ),
  ...COMPOSITES.map(
    (item): Entry => ({
      id: item.id,
      label: item.label,
      rings: item.rings,
      section: "composites",
      prefab: composed(item),
      composite: item,
    }),
  ),
]

/** Whether a seed changes this entry. */
export const varies = (entry: Entry): boolean =>
  entry.composite !== undefined || entry.prefab.variation !== undefined

/** The prefab to draw for a seed: a composite flattened, a prefab as is (the lab passes its seed on to `instantiate`). */
export const made = (entry: Entry, seed: number, kit: KitColour): Prefab | Composed =>
  entry.composite ? composed(entry.composite, seed, kit) : entry.prefab

/** What to draw for a seed, and the seed to hand `instantiate` with it (a composite has made its choices already). */
export const drawing = (entry: Entry, seed: number, kit: KitColour): [Prefab | Composed, number] => [
  made(entry, seed, kit),
  entry.composite ? 0 : seed,
]

/** World units between anchors: ring-1 prefabs need 46, a composite's two rings 66. */
const SPACING = { prefabs: 46, composites: 66 }
const PER_ROW = { prefabs: 5, composites: 4 }

/** Each entry's anchor on the grid, a section a block of rows, and a heading where a section starts. */
export function layout(shown: readonly Entry[]): {
  anchors: Map<string, [number, number]>
  headings: { text: string; x: number; z: number }[]
} {
  const anchors = new Map<string, [number, number]>()
  const headings: { text: string; x: number; z: number }[] = []
  let z = 0
  for (const section of ["prefabs", "composites"] as const) {
    const here = shown.filter((entry) => entry.section === section)
    if (here.length === 0) continue
    if (shown.some((entry) => entry.section !== section))
      headings.push({ text: section.toUpperCase(), x: -30, z: z - 24 })
    here.forEach((entry, n) => {
      anchors.set(entry.id, [
        (n % PER_ROW[section]) * SPACING[section],
        z + Math.floor(n / PER_ROW[section]) * SPACING[section],
      ])
    })
    z += Math.ceil(here.length / PER_ROW[section]) * SPACING[section] + 30
  }
  return { anchors, headings }
}

/** A patch of ground under an entry at `(x, z)`, wide enough for its rings and a cell or two round; a coastal composite stands with the sea behind it. */
export function patch(entry: Entry, x: number, z: number): LandPlacement[] {
  const tiles: LandPlacement[] = []
  const radius = entry.rings + 1
  for (let dq = -radius; dq <= radius; dq++)
    for (let dl = -2 * radius; dl <= 2 * radius; dl++) {
      if ((dq - dl) % 2 !== 0) continue
      const [tx, tz] = cellToWorld([dq, dl])
      if (Math.hypot(tx, tz) > radius * 10 + 6) continue
      const sea = entry.composite?.coastal && tz < -(entry.rings * 10 - 3)
      tiles.push({ piece: sea ? "hex_water" : "hex_grass", x: x + tx, z: z + tz, rot: turn(0) })
    }
  return tiles
}
