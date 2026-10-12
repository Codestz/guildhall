/**
 * Kit profiles (ADR 005): the one place that encodes a modular kit's conventions. A second kit is a
 * second profile here, not a new code path in the compiler.
 *
 * Kenney Fantasy Town 2.0, measured from the GLBs (raw pack and library/, x3 import, pivot kept):
 * - every module's origin is its cell's centre at floor level; a cell is 3 m, a storey 3 m;
 * - a wall panel lies on the cell's +x edge (x 1.2..1.5 m, z -1.5..1.5 m) and its dressed face is +x,
 *   so turning it to a side puts its outer face on that side's edge;
 * - `wall-corner-detail` is a post on the cell's (+x, +z) corner, centred in the wall's thickness;
 * - `roof` / `roof-high` is one slope over the cell, low on -x, its ridge on the +x edge (along z);
 * - `roof-gable*` has its ridge along x through the centre; `-end` hips the -x end, ridge running +x;
 * - `roof-corner` / `roof-high-corner` is a hip corner, peak on the (+x, -z) corner;
 * - `roof-flat`, `roof-point` are centred; `chimney` stands off-centre toward +x (0.64..1.28 m), 3 m tall.
 */
import type { FAMILIES, ROOF_STYLES } from "./blueprint.ts"

type Family = (typeof FAMILIES)[number]
type RoofStyle = (typeof ROOF_STYLES)[number]

/** Wall panels of one family: a blind panel, windows by style, doors by style. */
export interface WallSet {
  blind: string
  windows: Record<string, string>
  /** The window style a seed uses when the blueprint gives no `vary.openings`. */
  window: string
  /** The large window a shop front uses. */
  shop: string
  doors: { round: string; square: string; wide: string }
}

/** The pieces one roof style draws with (see the header for their native orientation). */
export interface RoofSet {
  /** One cell across the ridge: the whole gable, ridge along x. */
  gable?: string
  /** The hipped cap at either end of a one-across ridge run. */
  gableEnd?: string
  /** Two cells across the ridge: one slope per cell, ridge on its +x edge. */
  slope?: string
  /** The hipped corner at either end of a two-across ridge run. */
  corner?: string
  /** Any footprint: one piece per cell. */
  flat?: string
  /** 1×1 only. */
  point?: string
}

export interface KitProfile {
  id: string
  /** Metres per cell, and per storey. */
  module: number
  storey: number
  walls: Record<Family, WallSet>
  /** Corner post for the four outer corners of every storey. */
  corner: string
  roofs: Record<RoofStyle, RoofSet>
  chimney: string
}

const P = "kenney-town/"

/** Window styles shared by the plain (`wall-`) and wood (`wall-wood-`) panels. */
const windows = (prefix: string): Record<string, string> => ({
  glass: `${P}${prefix}window-glass`,
  round: `${P}${prefix}window-round`,
  shutters: `${P}${prefix}window-shutters`,
  small: `${P}${prefix}window-small`,
  stone: `${P}${prefix}window-stone`,
})

const doors = (prefix: string): WallSet["doors"] => ({
  round: `${P}${prefix}door`,
  square: `${P}${prefix}doorway-square`,
  wide: `${P}${prefix}doorway-square-wide`,
})

/**
 * The kit has two panel families (plain and wood). Stone and plaster share the plain panels and part
 * on their default window (stone frames) and blind face (timber cross); ramps re-tint the rest.
 */
export const KIT_PROFILES: Readonly<Record<"kenney-town", KitProfile>> = {
  "kenney-town": {
    id: "kenney-town",
    module: 3,
    storey: 3,
    walls: {
      stone: {
        blind: `${P}wall`,
        windows: windows("wall-"),
        window: "stone",
        shop: `${P}wall-window-glass`,
        doors: doors("wall-"),
      },
      plaster: {
        blind: `${P}wall-detail-cross`,
        windows: windows("wall-"),
        window: "shutters",
        shop: `${P}wall-window-glass`,
        doors: doors("wall-"),
      },
      wood: {
        blind: `${P}wall-wood`,
        windows: windows("wall-wood-"),
        window: "shutters",
        shop: `${P}wall-wood-window-glass`,
        doors: doors("wall-wood-"),
      },
    },
    corner: `${P}wall-corner-detail`,
    roofs: {
      gable: {
        gable: `${P}roof-gable`,
        gableEnd: `${P}roof-gable-end`,
        slope: `${P}roof`,
        corner: `${P}roof-corner`,
      },
      "high-gable": {
        gable: `${P}roof-high-gable`,
        gableEnd: `${P}roof-high-gable-end`,
        slope: `${P}roof-high`,
        corner: `${P}roof-high-corner`,
      },
      flat: { flat: `${P}roof-flat` },
      point: { point: `${P}roof-point` },
    },
    chimney: `${P}chimney`,
  },
}
