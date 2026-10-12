/**
 * The island as V1-style hex tiles (decisions.md "V1 look, V2 bones"): the terrain-first relief, read
 * onto a pointy-top hex grid. Each tile takes the height and the kind of the ground under its centre:
 * land snapped to low steps (the terraces keep their own), river and lake tiles sunk to a bed under
 * their water, shore tiles kept low; the sea has no tiles. Every tile is a prism down to a base below
 * the sea, so the island reads as a thick slab with stepped sides.
 */
import type { Vec2 } from "../geom/vec.ts"
import { TERRA_CRAG, TERRA_WATER, type Terra, terraHeightAt } from "./island.ts"

export type HexKind = "land" | "river" | "lake" | "shore" | "rock" | "crag"

export interface HexTile {
  /** Axial coordinates. */
  q: number
  r: number
  /** Centre, world metres. */
  at: Vec2
  /** The tile's top, metres. */
  top: number
  /** Water surface over it (river, lake), else NaN. */
  water: number
  kind: HexKind
  /** Terrace level (0 lowland). */
  level: number
}

export interface TerraHexes {
  /** Centre to corner, metres. */
  size: number
  tiles: HexTile[]
  /** The ground at (x, z): the top of the tile it falls in (the sea floor off the island). */
  heightAt(x: number, z: number): number
  /** The tile at (x, z), if any. */
  tileAt(x: number, z: number): HexTile | undefined
  /** Lowest base the prisms go down to. */
  base: number
}

const SQ3 = Math.sqrt(3)

/** Land is snapped to steps this tall (the terraces are multiples of it already). */
const STEP = 0.6

export function terraHexes(t: Terra, size = 4): TerraHexes {
  const { w, h, cell, origin, water, terraceLevel, slope, surface } = t
  const x0 = origin[0]
  const z0 = origin[1]
  const x1 = origin[0] + w * cell
  const z1 = origin[1] + h * cell
  const cellAt = (x: number, z: number): number => {
    const ix = Math.floor((x - x0) / cell)
    const iz = Math.floor((z - z0) / cell)
    return ix < 0 || iz < 0 || ix >= w || iz >= h ? -1 : iz * w + ix
  }
  const centre = (q: number, r: number): Vec2 => [size * SQ3 * (q + r / 2), size * 1.5 * r]
  const tiles: HexTile[] = []
  const byKey = new Map<string, HexTile>()
  const rMin = Math.floor(z0 / (size * 1.5)) - 1
  const rMax = Math.ceil(z1 / (size * 1.5)) + 1
  for (let r = rMin; r <= rMax; r++) {
    const qMin = Math.floor(x0 / (size * SQ3) - r / 2) - 1
    const qMax = Math.ceil(x1 / (size * SQ3) - r / 2) + 1
    for (let q = qMin; q <= qMax; q++) {
      const at = centre(q, r)
      const i = cellAt(at[0], at[1])
      if (i < 0) continue
      const k = water[i]!
      if (k === TERRA_WATER.sea) continue
      const lvl = terraceLevel[i]!
      const g = terraHeightAt(t, at[0], at[1])
      let kind: HexKind = "land"
      let top = Math.max(0.6, Math.round(g / STEP) * STEP)
      let wl = Number.NaN
      if (k === TERRA_WATER.river || k === TERRA_WATER.lake) {
        kind = k === TERRA_WATER.river ? "river" : "lake"
        wl = Math.max(0.3, Math.round(surface[i]! / STEP) * STEP)
        top = wl - 0.8
      } else if (k === TERRA_WATER.stack) {
        kind = "rock"
        top = Math.round(g / STEP) * STEP
      } else if (lvl === TERRA_CRAG) kind = "crag"
      else if (slope[i]! > 0.85) kind = "rock"
      else if (t.coastDist[i]! < 9 && g < 1.6) kind = "shore"
      const tile: HexTile = { q, r, at, top, water: wl, kind, level: lvl === TERRA_CRAG ? 99 : lvl }
      tiles.push(tile)
      byKey.set(`${q},${r}`, tile)
    }
  }
  const tileAt = (x: number, z: number): HexTile | undefined => {
    // pixel → axial (pointy top), then cube rounding
    const qf = ((SQ3 / 3) * x - z / 3) / size
    const rf = ((2 / 3) * z) / size
    const sf = -qf - rf
    let q = Math.round(qf)
    let r = Math.round(rf)
    const s = Math.round(sf)
    const dq = Math.abs(q - qf)
    const dr = Math.abs(r - rf)
    const ds = Math.abs(s - sf)
    if (dq > dr && dq > ds) q = -r - s
    else if (dr > ds) r = -q - s
    return byKey.get(`${q},${r}`)
  }
  // rivers as unbroken chains: every tile a river's line runs through is a river tile, its water at the
  // line's level there (never rising downstream)
  for (const rv of t.rivers) {
    let level = Number.POSITIVE_INFINITY
    for (let k = 1; k < rv.line.length; k++) {
      const a = rv.line[k - 1]!
      const b = rv.line[k]!
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (size * 0.4)))
      for (let j = 0; j <= n; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / n
        const z = a[1] + ((b[1] - a[1]) * j) / n
        const tile = tileAt(x, z)
        if (!tile) continue
        const g = terraHeightAt(t, x, z)
        level = Math.min(level, Math.max(0.3, Math.round((g + 0.2) / STEP) * STEP))
        if (tile.kind === "lake") continue
        tile.kind = "river"
        tile.water = Number.isNaN(tile.water) ? level : Math.min(tile.water, level)
        tile.top = tile.water - 0.8
      }
    }
  }
  const heightAt = (x: number, z: number): number => {
    const tile = tileAt(x, z)
    if (!tile) return terraHeightAt(t, x, z)
    return Number.isNaN(tile.water) ? tile.top : tile.water
  }
  return { size, tiles, heightAt, tileAt, base: -4 }
}
