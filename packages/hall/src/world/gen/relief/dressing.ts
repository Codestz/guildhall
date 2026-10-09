import { cellToWorld, type LandPlacement } from "../../lands.ts"
import { cellAt, key, rng } from "../hex.ts"
import type { Relief } from "./index.ts"
import { onShelf } from "./trailCarve.ts"

/**
 * Sculpted peaks' dressing (styles c and d, relief/style.ts): the detail on the mountain comes from the
 * hex pack's own pieces, not from noisy colour. Conifers stand in clumps with open meadow between,
 * in a band on the lower flanks; the kit's rocks and boulders lie on the steeper ground above it,
 * bigger and more of them the higher it is. Pure and seeded, set on the ground by `heightAt`.
 */

/** The conifer band, as shares of a massif's height: clumps start above the foot and end here. */
const BAND = [0.04, 0.46] as const
/** Steeper than this (rise over run) takes no trees; rocks lie on ground at least ROCKY steep. */
const WOODED = 0.75
const ROCKY = 0.45
/** Clump centres a hex draws at most, a clump's reach (world units) and its trees. */
const CLUMPS = 2
const REACH = 3.2
/** The hybrid's ledge tops are flat to within this grade, and a riser stands at least this far above its foot. */
const FLAT = 0.06
const RISER = 4
const ROCKS = ["rock_single_A", "rock_single_B", "rock_single_C", "rock_single_D", "rock_single_E"] as const

export function dressingOf(
  relief: Relief,
  seed: number,
  river: ReadonlySet<string> = new Set(),
): LandPlacement[] {
  const random = rng(seed ^ 0x51ce7)
  const out: LandPlacement[] = []
  for (const massif of relief.massifs) {
    const { grid, height, ledgeTop } = massif
    // The hybrid's stairs: below the top ledge only flat ground matches the mesh (a ramp between two
    // ledges is a riser in the mesh), so trees and rocks stand on ledge tops, rocks at the foot of a riser.
    const stairs = relief.style === "d"
    const band = stairs ? Math.max(BAND[1], ledgeTop / height + 0.01) : BAND[1]
    const grade = (x: number, z: number, h: number): number =>
      Math.max(
        Math.abs((grid.heightAt(x + 1.2, z) ?? h) - h),
        Math.abs((grid.heightAt(x, z + 1.2) ?? h) - h),
      ) / 1.2
    const flatAt = (x: number, z: number, h: number): boolean =>
      !stairs ||
      h > ledgeTop + 0.01 ||
      [
        [1.2, 0],
        [-1.2, 0],
        [0, 1.2],
        [0, -1.2],
      ].every(([dx, dz]) => Math.abs((grid.heightAt(x + (dx as number), z + (dz as number)) ?? h) - h) < FLAT)
    // A riser close by, to the side: the ground two units off is a ledge higher.
    const footAt = (x: number, z: number, h: number): boolean =>
      [0, 1, 2, 3].some(
        (k) => (grid.heightAt(x + 2 * Math.cos(k * 1.57), z + 2 * Math.sin(k * 1.57)) ?? h) - h >= RISER,
      )
    const put = (piece: LandPlacement["piece"], x: number, z: number, h: number, scale: number): void => {
      if (onShelf(massif, x, z)) return
      out.push({
        piece,
        x: Math.round(x * 100) / 100,
        z: Math.round(z * 100) / 100,
        y: Math.round((h - 0.15) * 100) / 100,
        rot: random() * Math.PI * 2,
        scale,
      })
    }
    for (const cell of massif.cells) {
      if (river.has(key(cell))) continue
      const [cx, cz] = cellToWorld(cell)
      const on = (x: number, z: number): number | undefined =>
        key(cellAt([x, z])) === key(cell) ? grid.heightAt(x, z) : undefined
      // Conifer clumps: a few centres a hex, each a ring of trees round it, so the meadow shows between.
      for (let c = 0; c < (stairs ? CLUMPS + 3 : CLUMPS); c++) {
        const [mx, mz] = [cx + (random() - 0.5) * 7, cz + (random() - 0.5) * 7]
        const keep = random() < 0.65
        const mh = on(mx, mz)
        if (!keep || mh === undefined || mh / height < BAND[0] || mh / height > band) continue
        const trees = 3 + Math.floor(random() * 4)
        for (let t = 0; t < trees; t++) {
          const a = random() * Math.PI * 2
          const d = REACH * Math.sqrt(random())
          const [x, z] = [mx + Math.cos(a) * d, mz + Math.sin(a) * d]
          const h = on(x, z)
          if (h === undefined || h / height > band || grade(x, z, h) > WOODED || !flatAt(x, z, h)) continue
          put(random() < 0.35 ? "trees_A_small" : "tree_single_A", x, z, h, 0.85 + 0.35 * random())
        }
      }
      // Rocks and boulders on the steep ground above the foot: more, and larger, the higher up.
      for (let r = 0; r < (stairs ? 4 : 2); r++) {
        const [x, z] = [cx + (random() - 0.5) * 8, cz + (random() - 0.5) * 8]
        const h = on(x, z)
        const pick = ROCKS[Math.floor(random() * ROCKS.length)] as (typeof ROCKS)[number]
        const luck = random()
        if (h === undefined || h / height < 0.12 || luck > 0.15 + 0.5 * (h / height)) continue
        // Summit flanks (and everywhere in the other styles): steep ground. On the stairs: at a riser's foot.
        if (stairs && h <= ledgeTop + 0.01 ? !(flatAt(x, z, h) && footAt(x, z, h)) : grade(x, z, h) < ROCKY)
          continue
        put(pick, x, z, h, 0.9 + 1.2 * (h / height) + 0.5 * random())
      }
    }
  }
  return out
}
