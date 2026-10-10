import { DMath } from "../../dmath.ts"
import { cellToWorld, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { cellAt, key, rng } from "../hex.ts"
import { groundOf } from "./ground.ts"
import type { Relief } from "./index.ts"
import { onShelf } from "./trailCarve.ts"
import { distance } from "./trailGround.ts"

/**
 * The massifs' dressing (relief/shape.ts): the mountain is its terraces and nothing else, so the only
 * pieces on it are the hex pack's conifers, standing in clumps with open meadow between on the flat
 * grass ledges, fewer with every floor up; the bare rock and snow above carry none. Each peak tall
 * enough stands a lone flag on its top ledge. Pure and seeded, set on the ground by `heightAt`.
 */

/**
 * The conifer band, as shares of a massif's height: clumps start above the foot and end where the
 * ledges turn to bare stone (paint.ts: the rock zone starts at half the peak, its edge wandering by
 * 0.12), so no tree stands on rock.
 */
const BAND = [0.04, 0.38] as const
/** The share of the foot's clumps and trees that stands at the band's top. */
const SPARSE = 0.25
/** A peak at least this tall (world units) stands a flag on its top, whether or not a trail ends there. */
const FLAG_AT = 20
/** A flag stands clear of a lookout's own by this far (units). */
const APART = 8
/** Steeper than this (rise over run) takes no trees. */
const WOODED = 0.75
/** Clump centres a hex draws at most, and a clump's reach (world units). */
const CLUMPS = 5
const REACH = 3.2

export function dressingOf(
  relief: Relief,
  seed: number,
  river: ReadonlySet<string> = new Set(),
  lookouts: readonly { at: Spot }[] = [],
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
        const keep = random()
        const mh = on(mx, mz)
        if (mh === undefined || mh / height < BAND[0] || mh / height > band) continue
        // Fewer clumps, and fewer trees in each, with every floor up.
        const thin = 1 - (1 - SPARSE) * ((mh / height - BAND[0]) / (band - BAND[0]))
        if (keep >= 0.65 * thin) continue
        const trees = Math.max(1, Math.round((3 + Math.floor(random() * 4)) * thin))
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
    // The lone flag on each tall peak's top ledge (a trail's lookout has its own), at the middle of that ledge's top.
    for (const peak of massif.peaks) {
      if (peak.height < FLAG_AT || lookouts.some((l) => distance(l.at, peak.at) < APART)) continue
      const top = ground.heightAt(peak.at[0], peak.at[1])
      if (top === undefined) continue
      const level = [peak.at]
      for (let r = 0.72; r <= 3; r += 0.72)
        for (let k = 0; k < 12; k++) {
          const spot: Spot = [
            peak.at[0] + r * DMath.cos((k * Math.PI) / 6),
            peak.at[1] + r * DMath.sin((k * Math.PI) / 6),
          ]
          if ((ground.heightAt(spot[0], spot[1]) ?? Number.NEGATIVE_INFINITY) > top - 0.01) level.push(spot)
        }
      const x = level.reduce((sum, s) => sum + s[0], 0) / level.length
      const z = level.reduce((sum, s) => sum + s[1], 0) / level.length
      const y = ground.heightAt(x, z)
      if (y === undefined) continue
      out.push({
        piece: "flag_yellow",
        x: Math.round(x * 100) / 100,
        z: Math.round(z * 100) / 100,
        y: Math.round(y * 100) / 100,
        rot: 0.3,
        scale: 3.2,
      })
    }
  }
  return out
}
