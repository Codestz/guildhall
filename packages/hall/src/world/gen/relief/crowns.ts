import LANDS from "../../lands.json"
import { cellToWorld, HEX_SCALE, type LandPlacement } from "../../lands.ts"
import { hash, key, neighbours, rings, unkey } from "../hex.ts"
import { COLUMN_STEP } from "./columns.ts"
import type { Massif } from "./field.ts"

/**
 * Summit crowns (relief style e): the kit's own `mountain_*` rock, scaled up to stand on the
 * highest columns so the peaks read from across the island. A crown goes on every massif's main
 * peaks and on any column that tops all its neighbours near the massif's height. Its foot is wider
 * than its hex, so hexRelief.ts raises the ring round it to within a tile of its column and the crown
 * sinks a tile into that column: it grows out of the stepped ground, with no lip over lower ground.
 * Pure and deterministic.
 */

const PIECES = ["mountain_A", "mountain_B", "mountain_C"] as const
/** A crown's scale, in the hex pack's own (a hand-map mountain is 1): from a crag to a peak, its foot no wider than the ring round its hex. */
const SCALE = [1.8, 3] as const
/** A crown stands this far over the field's height at its hex: the peak rises out of the range. */
const OVER = 1.3
/** A column crowns a ridge top when its field height is this share of the massif's, or more. */
const HIGH = 0.42
/** Crowns stand at least this many rings apart. */
const APART = 2

/** Where a crown goes: a hex (by key), the field's height there, and whether it is a massif's own peak. */
export interface CrownSite {
  id: string
  peak: number
  main: boolean
}

export interface Crown {
  id: string
  placement: LandPlacement
  /** Half the crown's width at its foot, world units: what it covers. */
  reach: number
}

const sizeOf = (piece: (typeof PIECES)[number]): readonly number[] => LANDS[piece].size

/** The massifs' crown sites, highest first within each. `tops`: every massif hex's column top. */
export function crownSites(massifs: readonly Massif[], tops: ReadonlyMap<string, number>): CrownSite[] {
  const out: CrownSite[] = []
  for (const massif of massifs) {
    const field = (id: string): number => {
      const [x, z] = cellToWorld(unkey(id))
      return massif.grid.heightAt(x, z) ?? 0
    }
    const peaks = new Set(massif.peaks.map((p) => key(p.cell)))
    const higher = (id: string): boolean =>
      neighbours(unkey(id)).some((n) => {
        const top = tops.get(key(n))
        const mine = tops.get(id) as number
        return top !== undefined && (top > mine || (top === mine && key(n) < id))
      })
    const wanted = [...massif.keys]
      .filter((id) => peaks.has(id) || (field(id) >= HIGH * massif.height && !higher(id)))
      .sort((a, b) => field(b) - field(a) || (a < b ? -1 : 1))
    const taken: string[] = []
    for (const id of wanted) {
      if (taken.some((other) => rings(offset(id, other)) < APART)) continue
      taken.push(id)
      out.push({ id, peak: field(id), main: peaks.has(id) })
    }
  }
  return out
}

/** The cell-space difference of two hexes (rings of it is their distance). */
const offset = (a: string, b: string): [number, number] => {
  const [aq, al] = unkey(a)
  const [bq, bl] = unkey(b)
  return [aq - bq, al - bl]
}

/** The crown for a site, standing on its column (`tops` as hexRelief.ts has raised them). */
export function crownAt({ id, peak }: Pick<CrownSite, "id" | "peak">, top: number, seed: number): Crown {
  const piece = PIECES[hash(`${seed}:${id}`) % PIECES.length] as (typeof PIECES)[number]
  const [width, height] = sizeOf(piece) as [number, number]
  const [x, z] = cellToWorld(unkey(id))
  const foot = top - COLUMN_STEP - 0.4
  const scale = Math.min(SCALE[1], Math.max(SCALE[0], (OVER * peak - foot) / (height * HEX_SCALE)))
  return {
    id,
    placement: {
      piece,
      x,
      z,
      y: Math.round(foot * 100) / 100,
      rot: (hash(`${id}:${seed}`) % 628) / 100,
      scale: Math.round(scale * 100) / 100,
    },
    reach: (width * HEX_SCALE * scale) / 2,
  }
}
