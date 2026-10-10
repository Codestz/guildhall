import { DMath } from "../../dmath.ts"
import { cellToWorld, type LandPlacement } from "../../lands.ts"
import { cellAt, key, rng } from "../hex.ts"
import { groundOf } from "./ground.ts"
import type { Relief } from "./index.ts"
import { onShelf } from "./trailCarve.ts"

/**
 * The massifs' dressing (relief/shape.ts): the mountain is its terraces and nothing else, so the only
 * pieces on it are the hex pack's conifers, standing in clumps with open meadow between on the flat
 * grass ledges of the lower floors; the bare rock and snow above carry none. Pure and seeded, set on
 * the ground by `heightAt`.
 */

/** The conifer band, as shares of a massif's height: clumps start above the foot and end here. */
const BAND = [0.04, 0.46] as const
/** Steeper than this (rise over run) takes no trees. */
const WOODED = 0.75
/** Clump centres a hex draws at most, and a clump's reach (world units). */
const CLUMPS = 5
const REACH = 3.2

export function dressingOf(
  relief: Relief,
  seed: number,
  river: ReadonlySet<string> = new Set(),
): LandPlacement[] {
  const random = rng(seed ^ 0x51ce7)
  const out: LandPlacement[] = []
  for (const massif of relief.massifs) {
    const { height } = massif
    const ground = groundOf(massif)
    const band = BAND[1]
    const put = (piece: LandPlacement["piece"], x: number, z: number, y: number, scale: number): void => {
      if (onShelf(massif, x, z)) return
      out.push({
        piece,
        x: Math.round(x * 100) / 100,
        z: Math.round(z * 100) / 100,
        y: Math.round(y * 100) / 100,
        rot: random() * Math.PI * 2,
        scale,
      })
    }
    for (const cell of massif.cells) {
      if (river.has(key(cell))) continue
      const [cx, cz] = cellToWorld(cell)
      const on = (x: number, z: number): number | undefined =>
        key(cellAt([x, z])) === key(cell) ? ground.heightAt(x, z) : undefined
      // Conifer clumps: a few centres a hex, each a ring of trees round it, so the meadow shows between.
      for (let c = 0; c < CLUMPS; c++) {
        const [mx, mz] = [cx + (random() - 0.5) * 7, cz + (random() - 0.5) * 7]
        const keep = random() < 0.65
        const mh = on(mx, mz)
        if (!keep || mh === undefined || mh / height < BAND[0] || mh / height > band) continue
        const trees = 3 + Math.floor(random() * 4)
        for (let t = 0; t < trees; t++) {
          const a = random() * Math.PI * 2
          const d = REACH * Math.sqrt(random())
          const [x, z] = [mx + DMath.cos(a) * d, mz + DMath.sin(a) * d]
          const h = on(x, z)
          if (
            h === undefined ||
            h / height > band ||
            ground.grade(x, z, h) > WOODED ||
            !ground.flatAt(x, z, h)
          )
            continue
          put(random() < 0.35 ? "trees_A_small" : "tree_single_A", x, z, h - 0.15, 0.85 + 0.35 * random())
        }
      }
    }
  }
  return out
}
