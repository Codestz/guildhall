import { type Cell, cellToWorld } from "../../lands.ts"
import { TERRACE } from "../../waterways.ts"
import { key } from "../hex.ts"
import { HUB } from "../plan/keep.ts"
import type { IslandPlan } from "../plan.ts"
import { type Massif, massifOf, SEA_RIM } from "./field.ts"
import { CAP, footprintsOf, type Tier, tierOf } from "./massifs.ts"
import { PEAK_BOOST } from "./shape.ts"

export { type Massif, SEA_RIM } from "./field.ts"
export { RES } from "./lattice.ts"
export { CAP, SITE_REACH, type Tier, tierOf } from "./massifs.ts"
export { type MeshArrays, reliefMesh } from "./mesh.ts"

/**
 * The island's mountains (terrain v2, slice 2a): pure and deterministic. Massifs are grown from the
 * plan's raised ground, each a low-poly height field on the hex-corner lattice (lattice.ts) whose
 * rim meets its neighbours' tops exactly. `heightAt` is the ground's height for walkers, O(1).
 */

export interface ReliefInput {
  plan: IslandPlan
  /** The terrace level of a hex outside the massifs (the dresser's `levels`). */
  level(cell: Cell): number
  /** Years of history (the chronicle's), when known: older repos stand taller. */
  years?: number
}

export interface Relief {
  tier: Tier
  /** The main range first. */
  massifs: readonly Massif[]
  /** Every hex a massif holds, by key. */
  keys: ReadonlySet<string>
  massifAt(cell: Cell): Massif | undefined
  /** The ground's height at a world point, or undefined off every massif (the hex terrace holds it there). */
  heightAt(x: number, z: number): number | undefined
}

/** A massif's main peak: grows with its files and its years, capped by the island's tier. */
export function peakHeight(tier: Tier, files: number, years = 0): number {
  return Math.min(CAP[tier], 10 + 6 * Math.log2(1 + files / 50) + 2 * Math.sqrt(Math.max(0, years)))
}

export function reliefOf({ plan, level, years = 0 }: ReliefInput): Relief {
  const tier = tierOf(plan.districts.reduce((sum, d) => sum + d.folder.files, 0))
  const topOf = (cell: Cell): number => (plan.land.has(key(cell)) ? level(cell) * TERRACE : SEA_RIM)
  const footprints = footprintsOf(plan, tier)
  const hub = cellToWorld(HUB)
  const mainAsk = peakHeight(
    tier,
    plan.districts.reduce((sum, d) => sum + d.folder.files, 0),
    years,
  )
  const massifs = footprints.map((footprint, id) => {
    // The main range is the island's backbone and counts the whole repo; the others count their
    // districts' own files (the ones holding a tenth or more of the massif).
    let files = 0
    if (footprint.range === 0) files = plan.districts.reduce((sum, d) => sum + d.folder.files, 0)
    else
      for (const [district, held] of footprint.held)
        if (held * 10 >= footprint.cells.length) files += plan.districts[district]?.folder.files ?? 0
    // A second range stands a little lower, and a piece a pass cut off lower still.
    const size = Math.min(1, 0.5 + footprint.cells.length / 120)
    const asked = peakHeight(tier, files, years)
    const height = (footprint.range === 0 ? asked : Math.min(asked, 0.85 * mainAsk)) * size
    return massifOf({
      id,
      cells: footprint.cells,
      height: Math.max(TERRACE * 2, height) * PEAK_BOOST,
      hub,
      seed: plan.seed ^ (0x9e3779b1 * (id + 1)),
      topOf,
    })
  })
  const keys = new Set(massifs.flatMap((m) => [...m.keys]))
  return {
    tier,
    massifs,
    keys,
    massifAt: (cell) => massifs.find((m) => m.keys.has(key(cell))),
    heightAt: (x, z) => {
      for (const m of massifs) {
        const h = m.grid.heightAt(x, z)
        if (h !== undefined) return h
      }
      return undefined
    },
  }
}

/** The snowline of a relief's main peak: its top fifth, lowered towards the foothills in winter (0 summer, 1 deep winter). */
export function snowlineOf(relief: Relief, winter = 0): number {
  const peak = relief.massifs[0]?.height ?? 0
  return peak * (0.8 - 0.4 * Math.min(1, Math.max(0, winter)))
}
