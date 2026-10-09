import { cellToWorld, type LandPlacement } from "../../lands.ts"
import { cellAt, key, rng } from "../hex.ts"
import { dressingOf } from "./dressing.ts"
import type { Relief } from "./index.ts"
import { isSculpted } from "./style.ts"

/**
 * The forest on the mountains (terrain 2c): trees stand thick on the lower slopes, thin out with
 * height and are gone at the treeline, and keep off steep ground (rock) and off the rivers' hexes.
 * Pure and seeded; the trees are the hex pack's own, set on the relief's ground by `heightAt`, so the
 * island's layers batch them with the rest of the decor.
 */

/** The treeline as a share of a massif's height (the snowline is at 0.8: rock lies between). */
export const TREELINE = 0.58
/** Candidate spacing, world units: the densest the forest gets is about one tree a step. */
const STEP = 3.1
/** Steeper than this (rise over run) is rock: no trees (at a grade of 0.7 they thin, by 1.1 none). */
const SOFT = 0.7
const HARD = 1.1

/** Trees for a relief: `river` says whether a hex key is water (nothing grows in it). */
export function forestOf(
  relief: Relief,
  seed: number,
  river: ReadonlySet<string> = new Set(),
): LandPlacement[] {
  // Sculpted peaks (style c) dress their flanks with the kit's clumps and rocks, not a carpet.
  if (isSculpted(relief.style)) return dressingOf(relief, seed, river)
  const random = rng(seed ^ 0x7f0e57)
  const out: LandPlacement[] = []
  for (const massif of relief.massifs) {
    const line = massif.height * TREELINE
    const { grid } = massif
    for (const cell of massif.cells) {
      if (river.has(key(cell))) continue
      const [cx, cz] = cellToWorld(cell)
      for (let dz = -6; dz <= 6; dz += STEP)
        for (let dx = -9; dx <= 9; dx += STEP) {
          const x = cx + dx + (random() - 0.5) * STEP
          const z = cz + dz + (random() - 0.5) * STEP
          const roll = random()
          const pick = random()
          const turn = random() * Math.PI * 2
          const at = cellAt([x, z])
          if (key(at) !== key(cell)) continue
          const h = grid.heightAt(x, z)
          if (h === undefined || h < 0.3) continue
          const grade =
            Math.max(
              Math.abs((grid.heightAt(x + 1.2, z) ?? h) - h),
              Math.abs((grid.heightAt(x, z + 1.2) ?? h) - h),
            ) / 1.2
          const up = 1 - h / line
          const flat = 1 - Math.min(1, Math.max(0, (grade - SOFT) / (HARD - SOFT)))
          if (up <= 0 || roll > Math.sqrt(up) * flat) continue
          // Stands near the treeline are smaller and sparser: single trees, then clumps lower down.
          const clump = up > 0.45 && pick < 0.55
          out.push({
            piece: clump
              ? pick < 0.3
                ? "trees_A_small"
                : "trees_B_small"
              : pick < 0.8
                ? "tree_single_A"
                : "tree_single_B",
            x: Math.round(x * 100) / 100,
            z: Math.round(z * 100) / 100,
            y: Math.round((h - 0.15) * 100) / 100,
            rot: turn,
            scale: 0.8 + 0.5 * Math.min(1, up + 0.2) * random(),
          })
        }
    }
  }
  return out
}
